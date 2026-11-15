require('dotenv').config();
const pool = require('../src/configs/postgres');

async function main() {
  const [accounts, totals] = await Promise.all([
    pool.query(`
      SELECT a.id, a.owner_type, a.owner_id, a.currency, a.account_type,
             a.balance_minor::text AS cached_balance,
             COALESCE(SUM(
               CASE
                 WHEN a.account_type = 'processor' AND le.direction = 'debit' THEN le.amount_minor
                 WHEN a.account_type = 'processor' AND le.direction = 'credit' THEN -le.amount_minor
                 WHEN a.account_type <> 'processor' AND le.direction = 'credit' THEN le.amount_minor
                 ELSE -le.amount_minor
               END
             ), 0)::text AS ledger_balance
        FROM accounts a
        LEFT JOIN ledger_entries le ON le.account_id = a.id
       GROUP BY a.id
    `),
    pool.query(`
      WITH totals AS (
        SELECT
          COALESCE(SUM((metadata->>'amountMinor')::numeric)
            FILTER (WHERE type IN ('wallet_funding', 'seed_funding')
                      AND status = 'posted' AND metadata->>'currency' = 'NGN'), 0) AS funded
        FROM transactions
      ),
      paid AS (
        SELECT COALESCE(SUM(amount_kobo), 0) AS paid_out
          FROM payouts
         WHERE status = 'SUCCESS'
      ),
      internal AS (
        SELECT COALESCE(SUM(balance_minor), 0) AS internal_balance
          FROM accounts
         WHERE currency = 'NGN'
           AND (owner_type = 'user' OR
                (owner_type = 'system' AND owner_id IN
                  ('PLATFORM_ESCROW', 'PLATFORM_REVENUE', 'PLATFORM_PAYOUT_CLEARING')))
      )
      SELECT totals.funded::text, paid.paid_out::text, internal.internal_balance::text
        FROM totals CROSS JOIN paid CROSS JOIN internal
    `)
  ]);

  const mismatches = accounts.rows.filter((account) => account.cached_balance !== account.ledger_balance);
  const funded = BigInt(totals.rows[0].funded || '0');
  const paidOut = BigInt(totals.rows[0].paid_out || '0');
  const internalBalance = BigInt(totals.rows[0].internal_balance || '0');
  const conservationMatches = internalBalance === funded - paidOut;
  const passed = mismatches.length === 0 && conservationMatches;

  if (passed) {
    console.log('PASS');
  } else {
    console.error('FAIL');
    if (!conservationMatches) {
      console.error(JSON.stringify({
        check: 'funding-minus-payout-conservation',
        internalBalance: internalBalance.toString(),
        funded: funded.toString(),
        paidOut: paidOut.toString()
      }));
    }
    for (const mismatch of mismatches) {
      console.error(JSON.stringify({
        check: 'cached-balance',
        accountId: mismatch.id,
        currency: mismatch.currency,
        cached: mismatch.cached_balance,
        ledger: mismatch.ledger_balance
      }));
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('FAIL');
    console.error(JSON.stringify({ errorCode: error.code || 'LEDGER_AUDIT_FAILED' }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
