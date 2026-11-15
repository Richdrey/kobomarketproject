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

describe('checkout service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Cart.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        items: [{ productId: 'product-1', variantId: null, quantity: 1 }]
      })
    });
    Product.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{
        _id: 'product-1',
        vendorId: 'vendor-1',
        variants: []
      }])
    });
    pool.query.mockResolvedValue({ rowCount: 1, rows: [{ price_kobo: '4500' }] });
    ledger.claimIdempotency.mockResolvedValue({ replay: null, hash: 'request-hash' });
  });

  test('insufficient balance creates neither an order nor ledger entries', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('balance_minor::text')) {
          return { rowCount: 1, rows: [{ id: '10', balance_minor: '2000', status: 'active' }] };
        }
        if (sql.includes("owner_id = 'PLATFORM_ESCROW'")) {
          return { rowCount: 1, rows: [{ id: '20' }] };
        }
        if (sql.includes('setting_value')) return { rowCount: 1, rows: [{ value: '500' }] };
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);

    await expect(orderService.checkout('buyer-1', 'checkout-key', {}))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', statusCode: 409 });

    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO orders'))).toBe(false);
    expect(ledger.postTransaction).not.toHaveBeenCalled();
    expect(Product.updateOne).not.toHaveBeenCalled();
  });
});
