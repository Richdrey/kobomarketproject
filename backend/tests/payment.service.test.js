jest.mock('../src/configs/postgres', () => ({ connect: jest.fn() }));
jest.mock('../src/services/ledger.service', () => ({ postTransaction: jest.fn() }));

const crypto = require('crypto');
const pool = require('../src/configs/postgres');
const ledger = require('../src/services/ledger.service');
const { mockProvider } = require('../src/services/payment-provider');
const paymentService = require('../src/services/payment.service');

describe('wallet funding webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.MOCK_PAYSTACK_SECRET = 'mock-secret';
  });

  test('credits a funding intent only once when success is processed twice', async () => {
    let status = 'PENDING';
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM funding_intents')) {
          return {
            rowCount: 1,
            rows: [{ id: '1', user_id: 'buyer-1', account_id: '2', amount_kobo: '4500', status }]
          };
        }
        if (sql.includes('FROM accounts')) return { rowCount: 1, rows: [{ id: '3' }] };
        if (sql.includes('UPDATE funding_intents')) status = 'SUCCESS';
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);
    ledger.postTransaction.mockResolvedValue({ id: 'tx-1' });
    await mockProvider.initialize({ email: 'buyer@example.com', amountKobo: '4500', reference: 'KMB-test' });

    await expect(paymentService.mockSuccessfulWebhook('KMB-test'))
      .resolves.toEqual({ alreadyProcessed: false });
    await expect(paymentService.mockSuccessfulWebhook('KMB-test'))
      .resolves.toEqual({ alreadyProcessed: true });

    expect(ledger.postTransaction).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  test('rejects a webhook with an invalid HMAC signature before database access', async () => {
    const rawBody = Buffer.from('{"event":"charge.success"}');
    const signature = crypto.createHmac('sha512', 'wrong-secret').update(rawBody).digest('hex');
    await expect(paymentService.handleWebhook(rawBody, signature, { event: 'charge.success' }))
      .rejects.toMatchObject({ code: 'INVALID_WEBHOOK_SIGNATURE', statusCode: 401 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
