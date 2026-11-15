const asyncHandler = require('../middleware/asyncHandler');
const payoutService = require('../services/payout.service');

const request = asyncHandler(async (req, res) => {
  const result = await payoutService.requestPayout(
    req.user._id,
    req.body.amountKobo,
    req.get('Idempotency-Key')
  );
  res.status(201).json({ success: true, data: result });
});

const list = asyncHandler(async (req, res) => {
  const payouts = await payoutService.listPayouts(req.user._id, req.query.limit);
  res.json({ success: true, data: { payouts } });
});

module.exports = { request, list };
