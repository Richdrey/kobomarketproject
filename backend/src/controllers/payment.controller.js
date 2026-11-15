const asyncHandler = require('../middleware/asyncHandler');
const paymentService = require('../services/payment.service');
const { AppError } = require('../middleware/errorHandler');
const pool = require('../configs/postgres');
const notificationService = require('../services/notification.service');

async function notifyFunding(reference, result) {
  if (result.alreadyProcessed || result.ignored) return;
  const intent = await pool.query(
    'SELECT user_id, amount_kobo::text FROM funding_intents WHERE reference = $1',
    [reference]
  );
  if (intent.rowCount) {
    notificationService.publish(intent.rows[0].user_id, 'WALLET_FUNDED', 'Your wallet funding was successful.', {
      reference,
      amountKobo: intent.rows[0].amount_kobo
    });
  }
}

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
    await notifyFunding(req.body.data.reference, result);
  }
  res.status(200).json({ success: true, data: result });
});

const mockPaymentSucceeded = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError(404, 'NOT_FOUND', 'Route not found');
  }
  const result = await paymentService.mockSuccessfulWebhook(req.params.reference);
  await notifyFunding(req.params.reference, result);
  res.json({ success: true, data: result });
});

module.exports = { fundWallet, paystackWebhook, mockPaymentSucceeded };
