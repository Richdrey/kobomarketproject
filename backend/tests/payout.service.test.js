jest.mock('../src/configs/postgres', () => ({ connect: jest.fn() }));
jest.mock('../src/services/ledger.service', () => ({ postTransaction: jest.fn() }));
jest.mock('../src/services/notification.service', () => ({ publish: jest.fn() }));

const pool = require('../src/configs/postgres');
const ledger = require('../src/services/ledger.service');
const payoutService = require('../src/services/payout.service');

describe('payout settlement', () => {
  test('a failed payout reverses clearing funds back to the vendor wallet', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM payouts')) {
          return {
            rowCount: 1,
            rows: [{
              id: '4',
              vendor_id: 'vendor-1',
              account_id: '10',
              amount_kobo: '250000',
              status: 'PROCESSING'
            }]
          };
        }
        if (sql.includes('PLATFORM_PAYOUT_CLEARING')) {
          return { rowCount: 1, rows: [{ id: '20' }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);

    await expect(payoutService.settlePayout('4', false, 'provider-ref')).resolves.toBe(true);

    expect(ledger.postTransaction).toHaveBeenCalledWith(client, expect.objectContaining({
      type: 'payout_reversal',
      entries: [
        { accountId: '20', direction: 'debit', amountMinor: '250000' },
        { accountId: '10', direction: 'credit', amountMinor: '250000' }
      ]
    }));
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE payouts SET status = $2, provider_reference = $3 WHERE id = $1',
      ['4', 'FAILED', 'provider-ref']
    );
  });
});
