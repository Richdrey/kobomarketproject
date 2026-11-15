const crypto = require('crypto');
const pool = require('../configs/postgres');
const { getPaymentProvider, mockProvider } = require('./payment-provider');
const ledger = require('./ledger.service');
const { AppError } = require('../middleware/errorHandler');

function providerAmount(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) return value;
  throw new AppError(400, 'INVALID_PROVIDER_AMOUNT', 'Payment provider returned an invalid amount');
}

async function initiateFunding(user, amountKobo, idempotencyKey) {
  if (!idempotencyKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (!/^[1-9]\d{0,17}$/.test(amountKobo)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive integer kobo');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`funding:${user._id}:${idempotencyKey}`]);
    const claimed = await ledger.claimIdempotency(client, {
      ownerId: user._id,
      operation: 'wallet-fund',
      key: idempotencyKey,
      body: { amountKobo }
    });
    if (claimed.replay) {
      await client.query('COMMIT');
      return claimed.replay;
    }

    const account = await client.query(
      `SELECT id FROM accounts
        WHERE owner_type = 'user' AND owner_id = $1 AND currency = 'NGN' AND account_type = 'wallet'
          AND status = 'active'
        FOR UPDATE`,
      [String(user._id)]
    );
    if (!account.rowCount) throw new AppError(409, 'WALLET_NOT_PROVISIONED', 'NGN wallet is not ready');

    const reference = `KMB-${crypto.createHash('sha256').update(`${user._id}:${idempotencyKey}`).digest('hex').slice(0, 32)}`;
    const provider = getPaymentProvider();
    const initialized = await provider.initialize({
      email: user.email,
      amountKobo,
      reference,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL
    });
    const response = { reference: initialized.reference, checkoutUrl: initialized.checkoutUrl, currency: 'NGN' };
    await client.query(
      `INSERT INTO funding_intents (reference, user_id, account_id, amount_kobo, idempotency_key, provider_reference)
       VALUES ($1, $2, $3, $4, $5, $1)`,
      [reference, String(user._id), account.rows[0].id, amountKobo, idempotencyKey]
    );
    await ledger.completeIdempotency(client, {
      ownerId: user._id,
      operation: 'wallet-fund',
      key: idempotencyKey,
      response
    });
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError(409, 'FUNDING_REFERENCE_CONFLICT', 'The funding request already exists');
    }
    throw error;
  } finally {
    client.release();
  }
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.PAYSTACK_SECRET_KEY || process.env.MOCK_PAYSTACK_SECRET;
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest();
  let received;
  try {
    received = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function processSuccessfulFunding(reference, verifiedPayment) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const intentResult = await client.query(
      `SELECT id, user_id, account_id, amount_kobo::text AS amount_kobo, status
         FROM funding_intents WHERE reference = $1 FOR UPDATE`,
      [reference]
    );
    if (!intentResult.rowCount) throw new AppError(404, 'FUNDING_NOT_FOUND', 'Funding intent not found');
    const intent = intentResult.rows[0];
    if (intent.status === 'SUCCESS') {
      await client.query('COMMIT');
      return { alreadyProcessed: true };
    }

    const verifiedAmount = providerAmount(verifiedPayment.amount);
    if (verifiedPayment.status !== 'success' || verifiedAmount !== intent.amount_kobo || verifiedPayment.currency !== 'NGN') {
      throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'Verified payment does not match the funding intent');
    }
    const clearing = await client.query(
      `SELECT id FROM accounts
        WHERE owner_type = 'processor' AND owner_id = 'PLATFORM_FUNDING_CLEARING' AND currency = 'NGN'
        FOR UPDATE`
    );
    if (!clearing.rowCount) throw new Error('Funding clearing account is missing; apply PostgreSQL migrations');

    await ledger.postTransaction(client, {
      reference: `funding-ledger:${reference}`,
      type: 'wallet_funding',
      idempotencyKey: `funding:${reference}`,
      metadata: { reference, amountMinor: intent.amount_kobo, currency: 'NGN' },
      entries: [
        { accountId: clearing.rows[0].id, direction: 'debit', amountMinor: intent.amount_kobo },
        { accountId: intent.account_id, direction: 'credit', amountMinor: intent.amount_kobo }
      ]
    });
    await client.query(
      `UPDATE funding_intents SET status = 'SUCCESS' WHERE id = $1`,
      [intent.id]
    );
    await client.query('COMMIT');
    return { alreadyProcessed: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function handleWebhook(rawBody, signature, event) {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Paystack webhook signature is invalid');
  }
  if (event.event !== 'charge.success') return { ignored: true };
  const reference = event.data?.reference;
  if (!reference) throw new AppError(400, 'INVALID_WEBHOOK', 'Webhook event is missing its reference');
  const verifiedPayment = await getPaymentProvider().verify(reference);
  return processSuccessfulFunding(reference, verifiedPayment);
}

async function mockSuccessfulWebhook(reference) {
  const verified = mockProvider.markSuccessful(reference);
  return processSuccessfulFunding(reference, verified);
}

module.exports = { initiateFunding, handleWebhook, mockSuccessfulWebhook, verifyWebhookSignature };
