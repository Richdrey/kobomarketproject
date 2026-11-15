const asyncHandler = require('../middleware/asyncHandler');
const payoutService = require('../services/payout.service');
const pool = require('../configs/postgres');
const ledger = require('../services/ledger.service');
const { AppError } = require('../middleware/errorHandler');

const request = asyncHandler(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 200) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  const body = { amountKobo: req.body.amountKobo };
  const prior = await pool.query(
    `SELECT request_hash, response
       FROM idempotency_keys
      WHERE owner_id = $1 AND operation = 'payout' AND key = $2`,
    [String(req.user._id), key]
  );
  if (prior.rowCount) {
    if (prior.rows[0].request_hash !== ledger.requestHash(body)) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request body');
    }
    if (!prior.rows[0].response) throw new AppError(409, 'PAYOUT_IN_PROGRESS', 'A payout request with this key is still processing');
    return res.status(200).json({ success: true, data: prior.rows[0].response });
  }
  const result = await payoutService.requestPayout(
    req.user._id,
    body.amountKobo,
    key
  );
  res.status(201).json({ success: true, data: result });
});

const list = asyncHandler(async (req, res) => {
  const payouts = await payoutService.listPayouts(req.user._id, req.query.limit);
  res.json({ success: true, data: { payouts } });
});

module.exports = { request, list };
