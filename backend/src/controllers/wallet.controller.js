const asyncHandler = require('../middleware/asyncHandler');
const pool = require('../configs/postgres');
const { AppError } = require('../middleware/errorHandler');

const getWallet = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT currency, balance_minor::text AS "balanceMinor", status
       FROM accounts
      WHERE owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet'
      ORDER BY currency`,
    [String(req.user._id)]
  );
  if (result.rowCount !== 2) {
    throw new AppError(409, 'WALLET_NOT_PROVISIONED', 'Wallet accounts are not ready yet');
  }
  res.json({ success: true, data: { wallets: result.rows } });
});

const getTransactions = asyncHandler(async (req, res) => {
  const { limit = 25, before } = req.query;
  const result = await pool.query(
    `SELECT le.id::text AS id, t.reference, t.type, le.direction,
            le.amount_minor::text AS "amountMinor", a.currency, le.created_at AS "createdAt"
       FROM accounts a
       JOIN ledger_entries le ON le.account_id = a.id
       JOIN transactions t ON t.id = le.transaction_id
      WHERE a.owner_type = 'user' AND a.owner_id = $1
        AND ($2::bigint IS NULL OR le.id < $2::bigint)
      ORDER BY le.id DESC
      LIMIT $3`,
    [String(req.user._id), before || null, Number(limit)]
  );
  res.json({ success: true, data: { transactions: result.rows } });
});

module.exports = { getWallet, getTransactions };
