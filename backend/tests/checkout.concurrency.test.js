jest.mock('../src/models/cart.models', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));
jest.mock('../src/models/product.models', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../src/configs/postgres', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../src/services/ledger.service', () => ({
  claimIdempotency: jest.fn(),
  completeIdempotency: jest.fn(),
  postTransaction: jest.fn()
}));

const Cart = require('../src/models/cart.models');
const Product = require('../src/models/product.models');
const pool = require('../src/configs/postgres');
const ledger = require('../src/services/ledger.service');
const orderService = require('../src/services/order.service');

describe('concurrent checkout wallet locking', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ten concurrent checkouts spend a wallet that can afford exactly three orders', async () => {
    let balance = 300n;
    let nextOrderId = 0;
    let nextSubOrderId = 0;
    let lockQueue = Promise.resolve();

    Cart.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        items: [{ productId: 'product-1', variantId: null, quantity: 1 }]
      })
    });
    Cart.updateOne.mockResolvedValue({ modifiedCount: 1 });
    Product.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{
        _id: 'product-1',
        vendorId: 'vendor-1',
        variants: []
      }])
    });
    Product.updateOne.mockResolvedValue({ modifiedCount: 1 });
    pool.query.mockResolvedValue({ rowCount: 1, rows: [{ price_kobo: '100' }] });
    ledger.claimIdempotency.mockResolvedValue({ replay: null, hash: 'request-hash' });
    ledger.completeIdempotency.mockResolvedValue(undefined);
    ledger.postTransaction.mockImplementation(async (client, transaction) => {
      if (transaction.type === 'checkout') balance -= BigInt(transaction.metadata.amountMinor);
    });

    for (let index = 0; index < 10; index += 1) {
      let releaseWallet;
      const client = {
        query: jest.fn(async (sql) => {
          if (sql === 'BEGIN') return { rowCount: 0, rows: [] };
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (releaseWallet) {
              releaseWallet();
              releaseWallet = null;
            }
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('balance_minor::text')) {
            let unlock;
            const previous = lockQueue;
            lockQueue = new Promise((resolve) => { unlock = resolve; });
            await previous;
            releaseWallet = unlock;
            return { rowCount: 1, rows: [{ id: '10', balance_minor: balance.toString(), status: 'active' }] };
          }
          if (sql.includes("owner_id = 'PLATFORM_ESCROW'")) {
            return { rowCount: 1, rows: [{ id: '20' }] };
          }
          if (sql.includes('setting_value')) return { rowCount: 1, rows: [{ value: '0' }] };
          if (sql.includes('INSERT INTO orders')) {
            nextOrderId += 1;
            return { rowCount: 1, rows: [{ id: String(nextOrderId) }] };
          }
          if (sql.includes('INSERT INTO sub_orders')) {
            nextSubOrderId += 1;
            return { rowCount: 1, rows: [{ id: String(nextSubOrderId) }] };
          }
          return { rowCount: 1, rows: [] };
        }),
        release: jest.fn()
      };
      pool.connect.mockResolvedValueOnce(client);
    }

    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) =>
      orderService.checkout(`buyer-${index}`, `key-${index}`, {})
    ));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(7);
    expect(nextOrderId).toBe(3);
    expect(ledger.postTransaction).toHaveBeenCalledTimes(3);
  });

  test('two buyers racing for the last unit produce one successful checkout', async () => {
    let balance = 1000n;
    let stock = 1;
    let nextOrderId = 0;
    let nextSubOrderId = 0;
    let lockQueue = Promise.resolve();

    Cart.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        items: [{ productId: 'product-1', variantId: null, quantity: 1 }]
      })
    });
    Cart.updateOne.mockResolvedValue({ modifiedCount: 1 });
    Product.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{
        _id: 'product-1',
        vendorId: 'vendor-1',
        variants: []
      }])
    });
    Product.updateOne.mockImplementation(async (filter, update) => {
      const delta = update.$inc.stockQuantity;
      if (delta > 0) {
        stock += delta;
        return { modifiedCount: 1 };
      }
      if (stock < Math.abs(delta)) return { modifiedCount: 0 };
      stock += delta;
      return { modifiedCount: 1 };
    });
    pool.query.mockResolvedValue({ rowCount: 1, rows: [{ price_kobo: '100' }] });
    ledger.claimIdempotency.mockResolvedValue({ replay: null, hash: 'request-hash' });
    ledger.completeIdempotency.mockResolvedValue(undefined);
    ledger.postTransaction.mockImplementation(async (client, transaction) => {
      if (transaction.type === 'checkout') balance -= BigInt(transaction.metadata.amountMinor);
      if (transaction.type === 'checkout_compensation') balance += BigInt(transaction.metadata.amountMinor);
    });

    const makeClient = (buyerId) => {
      let releaseWallet;
      return {
        query: jest.fn(async (sql, args) => {
          if (sql === 'BEGIN') return { rowCount: 0, rows: [] };
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (releaseWallet) {
              releaseWallet();
              releaseWallet = null;
            }
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('balance_minor::text')) {
            let unlock;
            const previous = lockQueue;
            lockQueue = new Promise((resolve) => { unlock = resolve; });
            await previous;
            releaseWallet = unlock;
            return { rowCount: 1, rows: [{ id: '10', balance_minor: balance.toString(), status: 'active' }] };
          }
          if (sql.includes('SELECT id, status FROM orders')) {
            return { rowCount: 1, rows: [{ id: '1', status: 'PAID' }] };
          }
          if (sql.includes('SELECT id, owner_id FROM accounts')) {
            return {
              rowCount: 2,
              rows: [{ id: '10', owner_id: String(args[0]) }, { id: '20', owner_id: 'PLATFORM_ESCROW' }]
            };
          }
          if (sql.includes("owner_id = 'PLATFORM_ESCROW'")) {
            return { rowCount: 1, rows: [{ id: '20' }] };
          }
          if (sql.includes('setting_value')) return { rowCount: 1, rows: [{ value: '0' }] };
          if (sql.includes('INSERT INTO orders')) {
            nextOrderId += 1;
            return { rowCount: 1, rows: [{ id: String(nextOrderId) }] };
          }
          if (sql.includes('INSERT INTO sub_orders')) {
            nextSubOrderId += 1;
            return { rowCount: 1, rows: [{ id: String(nextSubOrderId) }] };
          }
          return { rowCount: 1, rows: [] };
        }),
        release: jest.fn()
      };
    };
    pool.connect
      .mockResolvedValueOnce(makeClient('buyer-1'))
      .mockResolvedValueOnce(makeClient('buyer-2'))
      .mockResolvedValueOnce(makeClient('buyer-2'));

    const results = await Promise.allSettled([
      orderService.checkout('buyer-1', 'buyer-one-key', {}),
      orderService.checkout('buyer-2', 'buyer-two-key', {})
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(stock).toBe(0);
    expect(ledger.postTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'checkout_compensation' })
    );
  });
});
