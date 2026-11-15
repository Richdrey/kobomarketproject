const asyncHandler = require('../middleware/asyncHandler');
const paymentService = require('../services/payment.service');
const { AppError } = require('../middleware/errorHandler');

const fundWallet = asyncHandler(async (req, res) => {
  const result = await paymentService.initiateFunding(
    req.user,
    req.body.amountKobo,
    req.get('Idempotency-Key')
  );
  res.status(200).json({ success: true, data: result });
});

const paystackWebhook = asyncHandler(async (req, res) => {
  if (!req.rawBody) throw new AppError(400, 'RAW_WEBHOOK_BODY_REQUIRED', 'Webhook raw body is unavailable');
  const result = await paymentService.handleWebhook(
    req.rawBody,
    req.get('x-paystack-signature'),
    req.body
  );
  res.status(200).json({ success: true, data: result });
});

const mockPaymentSucceeded = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError(404, 'NOT_FOUND', 'Route not found');
  }
  const result = await paymentService.mockSuccessfulWebhook(req.params.reference);
  res.json({ success: true, data: result });
});

module.exports = { fundWallet, paystackWebhook, mockPaymentSucceeded };
