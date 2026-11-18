jest.mock('../src/configs/postgres', () => ({ query: jest.fn() }));
jest.mock('../src/services/order.service', () => ({ checkout: jest.fn() }));
jest.mock('../src/services/ledger.service', () => ({ requestHash: jest.fn(() => 'request-hash') }));
jest.mock('../src/services/notification.service', () => ({ publishOrderPlaced: jest.fn() }));

const pool = require('../src/configs/postgres');
const orderService = require('../src/services/order.service');
const controller = require('../src/controllers/order.controller');

describe('checkout idempotency response handling', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the same key and body return the original order without a second checkout', async () => {
    const order = { orderId: '23', status: 'PAID', totalKobo: '4500' };
    pool.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ request_hash: 'request-hash', response: order }] });
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ status: 'PAID' }] });
    orderService.checkout.mockResolvedValue(order);

    const run = async () => {
      const req = {
        user: { _id: 'buyer-1' },
        body: {},
        get: jest.fn(() => 'same-key')
      };
      const res = {
        status: jest.fn(function setStatus(status) { this.statusCode = status; return this; }),
        json: jest.fn(function send(body) { this.body = body; return this; })
      };
      const next = jest.fn();
      await controller.checkout(req, res, next);
      if (next.mock.calls.length) throw next.mock.calls[0][0];
      return res;
    };

    const first = await run();
    const replay = await run();
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.body.data).toEqual(order);
    expect(orderService.checkout).toHaveBeenCalledTimes(1);
  });
});
