const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

async function claimIdempotency(client, { ownerId, operation, key, body }) {
  const hash = requestHash(body);
  await client.query(
    `INSERT INTO idempotency_keys (owner_id, operation, key, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_id, operation, key) DO NOTHING`,
    [String(ownerId), operation, key, hash]
  );
  const existing = await client.query(
    `SELECT request_hash, response
       FROM idempotency_keys
      WHERE owner_id = $1 AND operation = $2 AND key = $3
      FOR UPDATE`,
    [String(ownerId), operation, key]
  );
  if (!existing.rowCount) throw new Error('Idempotency record could not be created');
  if (existing.rows[0].request_hash !== hash) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request body');
  }
  return { replay: existing.rows[0].response, hash };
}

async function completeIdempotency(client, { ownerId, operation, key, response }) {
  await client.query(
    `UPDATE idempotency_keys
        SET response = $4::jsonb
      WHERE owner_id = $1 AND operation = $2 AND key = $3`,
    [String(ownerId), operation, key, JSON.stringify(response)]
  );
}

async function postTransaction(client, { reference, type, idempotencyKey, metadata, entries }) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new TypeError('A posted ledger transaction requires at least two entries');
  }

  let debits = 0n;
  let credits = 0n;
  const normalizedEntries = entries.map((entry) => {
    if (!/^(0|[1-9]\d*)$/.test(String(entry.amountMinor)) || BigInt(entry.amountMinor) <= 0n) {
      throw new TypeError('Ledger amounts must be positive integer minor units');
    }
    if (entry.direction === 'debit') debits += BigInt(entry.amountMinor);
    else if (entry.direction === 'credit') credits += BigInt(entry.amountMinor);
    else throw new TypeError('Ledger direction must be debit or credit');
    return { ...entry, amountMinor: BigInt(entry.amountMinor) };
  });
  if (debits !== credits) throw new AppError(400, 'UNBALANCED_LEDGER_TRANSACTION', 'Ledger debits and credits must balance');

  const accountIds = [...new Set(normalizedEntries.map((entry) => String(entry.accountId)))]
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  const accountResult = await client.query(
    `SELECT id, currency, account_type
       FROM accounts
      WHERE id = ANY($1::bigint[])
      ORDER BY id
      FOR UPDATE`,
    [accountIds]
  );
  if (accountResult.rowCount !== accountIds.length) {
    throw new AppError(409, 'LEDGER_ACCOUNT_NOT_FOUND', 'A ledger account does not exist');
  }
  const accounts = new Map(accountResult.rows.map((account) => [String(account.id), account]));
  const currencies = new Set(normalizedEntries.map((entry) => accounts.get(String(entry.accountId)).currency));
  if (currencies.size !== 1) {
    throw new AppError(400, 'CURRENCY_MISMATCH', 'A ledger transaction cannot mix currencies');
  }

  const result = await client.query(
    `INSERT INTO transactions (reference, type, status, idempotency_key, metadata)
     VALUES ($1, $2, 'pending', $3, $4::jsonb)
     RETURNING id`,
    [reference, type, idempotencyKey, JSON.stringify(metadata || {})]
  );
  const transactionId = result.rows[0].id;

  for (const entry of normalizedEntries) {
    const account = accounts.get(String(entry.accountId));
    const isProcessor = account.account_type === 'processor';
    const sign = (entry.direction === 'credit') !== isProcessor ? 1n : -1n;
    await client.query(
      'UPDATE accounts SET balance_minor = balance_minor + $1::bigint WHERE id = $2',
      [(entry.amountMinor * sign).toString(), entry.accountId]
    );
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_minor)
       VALUES ($1, $2, $3, $4)`,
      [transactionId, entry.accountId, entry.direction, entry.amountMinor.toString()]
    );
  }

  await client.query("UPDATE transactions SET status = 'posted' WHERE id = $1", [transactionId]);
  return { id: String(transactionId), amountMinor: debits.toString(), currency: [...currencies][0] };
}

module.exports = { stableStringify, requestHash, claimIdempotency, completeIdempotency, postTransaction };
