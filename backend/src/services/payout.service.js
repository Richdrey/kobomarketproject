const crypto = require('crypto');
const pool = require('../configs/postgres');
const Store = require('../models/store.models');
const ledger = require('./ledger.service');
const { getPaymentProvider } = require('./payment-provider');
const { decryptBankDetails } = require('../utils/bank-details');
const notificationService = require('./notification.service');
const { AppError } = require('../middleware/errorHandler');

async function requestPayout(vendorId, amountKobo, idempotencyKey) {
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  }
  const minimum = process.env.PAYOUT_MINIMUM_KOBO || '100000';
  if (!/^[1-9]\d{0,17}$/.test(minimum)) throw new Error('PAYOUT_MINIMUM_KOBO must be a positive integer');
  if (!/^[1-9]\d{0,17}$/.test(amountKobo) || BigInt(amountKobo) < BigInt(minimum)) {
    throw new AppError(400, 'INVALID_PAYOUT_AMOUNT', `Minimum payout is ${minimum} kobo`);
  }
  const store = await Store.findOne({ vendorId, status: 'approved' }).select('+bankDetailsEncrypted').lean();
  if (!store?.bankDetailsEncrypted) {
    throw new AppError(403, 'VENDOR_NOT_APPROVED', 'An approved store with bank details is required for payouts');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payout:${vendorId}:${idempotencyKey}`]);
    const claim = await ledger.claimIdempotency(client, {
      ownerId: vendorId,
      operation: 'payout',
      key: idempotencyKey,
      body: { amountKobo }
    });
    if (claim.replay) {
      await client.query('COMMIT');
      return claim.replay;
    }

    const wallet = await client.query(
      `SELECT id, balance_minor::text AS balance, status FROM accounts
        WHERE owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet'
          AND currency = 'NGN' FOR UPDATE`,
      [String(vendorId)]
    );
    if (!wallet.rowCount || wallet.rows[0].status !== 'active') {
      throw new AppError(409, 'WALLET_UNAVAILABLE', 'Vendor NGN wallet is unavailable');
    }
    if (BigInt(wallet.rows[0].balance) < BigInt(amountKobo)) {
      throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Wallet balance is insufficient');
    }
    const pending = await client.query(
      "SELECT 1 FROM payouts WHERE vendor_id = $1 AND status IN ('PENDING', 'PROCESSING')",
      [String(vendorId)]
    );
    if (pending.rowCount) throw new AppError(409, 'PAYOUT_ALREADY_PENDING', 'A payout is already being processed');
    const clearing = await client.query(
      `SELECT id FROM accounts
        WHERE owner_type = 'system' AND owner_id = 'PLATFORM_PAYOUT_CLEARING' AND currency = 'NGN'
        FOR UPDATE`
    );
    if (!clearing.rowCount) throw new Error('Payout clearing account is missing');

    const reference = `KMP-${crypto.randomUUID()}`;
    const inserted = await client.query(
      `INSERT INTO payouts (vendor_id, account_id, amount_kobo, status, idempotency_key, provider_reference)
       VALUES ($1, $2, $3, 'PENDING', $4, $5)
       RETURNING id::text`,
      [String(vendorId), wallet.rows[0].id, amountKobo, idempotencyKey, reference]
    );
    await ledger.postTransaction(client, {
      reference: `payout-request:${inserted.rows[0].id}`,
      type: 'payout_request',
      idempotencyKey: `payout-request:${vendorId}:${idempotencyKey}`,
      metadata: { payoutId: inserted.rows[0].id, amountMinor: amountKobo, currency: 'NGN' },
      entries: [
        { accountId: wallet.rows[0].id, direction: 'debit', amountMinor: amountKobo },
        { accountId: clearing.rows[0].id, direction: 'credit', amountMinor: amountKobo }
      ]
    });
    const response = {
      payoutId: inserted.rows[0].id,
      amountKobo,
      currency: 'NGN',
      status: 'PENDING'
    };
    await ledger.completeIdempotency(client, {
      ownerId: vendorId,
      operation: 'payout',
      key: idempotencyKey,
      response
    });
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError(409, 'PAYOUT_ALREADY_PENDING', 'A payout is already being processed');
    }
    throw error;
  } finally {
    client.release();
  }
}

async function settlePayout(payoutId, success, providerReference) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payout = await client.query(
      `SELECT id, vendor_id, account_id, amount_kobo::text, status
         FROM payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    if (!payout.rowCount || payout.rows[0].status !== 'PROCESSING') {
      await client.query('COMMIT');
      return false;
    }
    const clearing = await client.query(
      `SELECT id FROM accounts
        WHERE owner_type = 'system' AND owner_id = 'PLATFORM_PAYOUT_CLEARING' AND currency = 'NGN'
        FOR UPDATE`
    );
    const settled = success ? await client.query(
      `SELECT id FROM accounts
        WHERE owner_type = 'processor' AND owner_id = 'PLATFORM_PAYOUT_SETTLED' AND currency = 'NGN'
        FOR UPDATE`
    ) : null;
    const creditAccount = success ? settled?.rows[0] : { id: payout.rows[0].account_id };
    if (!clearing.rowCount || !creditAccount) throw new Error('Payout settlement accounts are missing');
    await ledger.postTransaction(client, {
      reference: `payout-settlement:${payoutId}`,
      type: success ? 'payout_settlement' : 'payout_reversal',
      idempotencyKey: `payout-settlement:${payoutId}`,
      metadata: { payoutId: String(payoutId), amountMinor: payout.rows[0].amount_kobo, currency: 'NGN' },
      entries: [
        { accountId: clearing.rows[0].id, direction: 'debit', amountMinor: payout.rows[0].amount_kobo },
        { accountId: creditAccount.id, direction: success ? 'credit' : 'credit', amountMinor: payout.rows[0].amount_kobo }
      ]
    });
    await client.query(
      'UPDATE payouts SET status = $2, provider_reference = $3 WHERE id = $1',
      [payoutId, success ? 'SUCCESS' : 'FAILED', providerReference || null]
    );
    await client.query('COMMIT');
    notificationService.publish(
      payout.rows[0].vendor_id,
      success ? 'PAYOUT_SUCCESS' : 'PAYOUT_FAILURE',
      success ? 'Your payout was completed.' : 'Your payout failed and the funds were returned to your wallet.',
      { payoutId: String(payoutId), amountKobo: payout.rows[0].amount_kobo }
    );
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processPendingPayouts(limit = 20) {
  const client = await pool.connect();
  let payouts;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id::text FROM payouts
        WHERE status = 'PENDING'
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    payouts = result.rows;
    for (const payout of payouts) {
      await client.query("UPDATE payouts SET status = 'PROCESSING' WHERE id = $1", [payout.id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  let processed = 0;
  for (const { id } of payouts) {
    const details = await pool.query(
      `SELECT id::text, vendor_id, amount_kobo::text, provider_reference
         FROM payouts WHERE id = $1`,
      [id]
    );
    if (!details.rowCount) throw new Error(`Payout ${id} could not be loaded`);
    const payout = details.rows[0];
    const store = await Store.findOne({ vendorId: payout.vendor_id, status: 'approved' })
      .select('+bankDetailsEncrypted')
      .lean();
    if (!store?.bankDetailsEncrypted) {
      await settlePayout(id, false, payout.provider_reference);
      processed += 1;
      continue;
    }
    let success = false;
    let providerReference = payout.provider_reference;
    try {
      const transfer = await getPaymentProvider().transfer({
        amountKobo: payout.amount_kobo,
        reference: payout.provider_reference,
        bankDetails: decryptBankDetails(store.bankDetailsEncrypted)
      });
      success = transfer.status === 'success' || transfer.status === 'SUCCESS';
      providerReference = transfer.reference || providerReference;
    } catch (error) {
      if (process.env.NODE_ENV === 'production' && error.code !== 'MOCK_PAYOUT_FAILED') {
        await settlePayout(id, false, providerReference);
        processed += 1;
        continue;
      }
    }
    await settlePayout(id, success, providerReference);
    processed += 1;
  }
  return processed;
}

async function listPayouts(vendorId, limit = 50) {
  const result = await pool.query(
    `SELECT id::text, amount_kobo::text, status, provider_reference, created_at
       FROM payouts WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [String(vendorId), limit]
  );
  return result.rows;
}

module.exports = { requestPayout, processPendingPayouts, listPayouts };
