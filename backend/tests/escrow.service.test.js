jest.mock('../src/configs/postgres', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../src/services/ledger.service', () => ({ postTransaction: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({ publishFundsReleased: jest.fn() }));

const pool = require('../src/configs/postgres');
const ledger = require('../src/services/ledger.service');
const escrowService = require('../src/services/escrow.service');

describe('escrow service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('completing delivery splits escrow between vendor and platform revenue', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM sub_orders s JOIN orders')) {
          return {
            rowCount: 1,
            rows: [{ id: '7', order_id: '3', status: 'SHIPPED', buyer_id: 'buyer-1', vendor_id: 'vendor-1' }]
          };
        }
        if (sql.includes('FROM disputes')) return { rowCount: 0, rows: [] };
        if (sql.includes('FROM order_items')) {
          return { rowCount: 1, rows: [{ gross: '10000', commission: '500' }] };
        }
        if (sql.includes('FROM accounts')) {
          return {
            rowCount: 3,
            rows: [
              { id: '10', owner_id: 'vendor-1' },
              { id: '20', owner_id: 'PLATFORM_ESCROW' },
              { id: '30', owner_id: 'PLATFORM_REVENUE' }
            ]
          };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);

    await expect(escrowService.confirmDelivery('7', 'buyer-1'))
      .resolves.toEqual({ subOrderId: '7', status: 'COMPLETED' });

    expect(ledger.postTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      type: 'escrow_release',
      entries: [
        { accountId: '20', direction: 'debit', amountMinor: '10000' },
        { accountId: '10', direction: 'credit', amountMinor: '9500' },
        { accountId: '30', direction: 'credit', amountMinor: '500' }
      ]
    }));
  });

  test('auto-completion query excludes sub-orders with an open dispute', async () => {
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(escrowService.autoCompleteDueSubOrders(72)).resolves.toBe(0);
    expect(pool.query.mock.calls[0][0]).toContain("d.status = 'OPEN'");
  });

  test('rejects confirmation from PAID instead of skipping an order state', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ id: '7', order_id: '3', status: 'PAID', buyer_id: 'buyer-1' }]
      }),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);

    await expect(escrowService.confirmDelivery('7', 'buyer-1'))
      .rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION', statusCode: 409 });
    expect(ledger.postTransaction).not.toHaveBeenCalled();
  });
});
