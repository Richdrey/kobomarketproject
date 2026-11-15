jest.mock('../src/configs/postgres', () => ({ connect: jest.fn() }));
jest.mock('../src/services/ledger.service', () => ({ postTransaction: jest.fn() }));

const pool = require('../src/configs/postgres');
const ledger = require('../src/services/ledger.service');
const disputeService = require('../src/services/dispute.service');

describe('dispute resolution', () => {
  test('partial refund balances the ledger and charges commission only on the vendor share', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM disputes d')) {
          return {
            rowCount: 1,
            rows: [{
              id: '9',
              sub_order_id: '7',
              buyer_id: 'buyer-1',
              dispute_status: 'OPEN',
              order_id: '3',
              vendor_id: 'vendor-1',
              sub_order_status: 'DISPUTED'
            }]
          };
        }
        if (sql.includes('FROM order_items')) {
          return { rowCount: 1, rows: [{ gross: '10000', commission: '500' }] };
        }
        if (sql.includes('FROM accounts')) {
          return {
            rowCount: 4,
            rows: [
              { id: '10', owner_id: 'buyer-1' },
              { id: '11', owner_id: 'vendor-1' },
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

    await expect(disputeService.resolveDispute('9', 'admin-1', {
      resolution: 'PARTIAL_REFUND',
      note: 'Item arrived damaged',
      refundKobo: '2000'
    })).resolves.toMatchObject({
      refundKobo: '2000',
      vendorKobo: '7600',
      commissionKobo: '400'
    });

    const posted = ledger.postTransaction.mock.calls[0][1];
    const debits = posted.entries.filter((entry) => entry.direction === 'debit')
      .reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n);
    const credits = posted.entries.filter((entry) => entry.direction === 'credit')
      .reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n);
    expect(debits).toBe(10000n);
    expect(credits).toBe(debits);
  });
});
