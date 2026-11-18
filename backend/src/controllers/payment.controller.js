const asyncHandler = require('../middleware/asyncHandler');
const paymentService = require('../services/payment.service');
const { AppError } = require('../middleware/errorHandler');
const notificationService = require('../services/notification.service');

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
  if (req.body.event === 'charge.success' && req.body.data?.reference) {
    if (!result.alreadyProcessed && !result.ignored) {
      notificationService.publishWalletFunding(req.body.data.reference);
    }
  }
  res.status(200).json({ success: true, data: result });
});

const mockPaymentSucceeded = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError(404, 'NOT_FOUND', 'Route not found');
  }
  const result = await paymentService.mockSuccessfulWebhook(req.params.reference);
  if (!result.alreadyProcessed) notificationService.publishWalletFunding(req.params.reference);
  res.json({ success: true, data: result });
});

const mockPaymentPage = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError(404, 'NOT_FOUND', 'Route not found');
  }
  const action = `/api/v1/mock-payments/${encodeURIComponent(req.params.reference)}/succeed`;
  res.type('html').send(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock payment</title>` +
    `<body><h1>Development mock payment</h1><form method="post" action="${action}">` +
    '<button type="submit">Simulate successful payment</button></form></body></html>'
  );
});

module.exports = { fundWallet, paystackWebhook, mockPaymentSucceeded, mockPaymentPage };
