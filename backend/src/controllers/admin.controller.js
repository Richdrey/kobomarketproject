const User = require('../models/user.models');
const pool = require('../configs/postgres');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');

const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const escaped = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'i');
    filter.$or = [{ email: expression }, { firstName: expression }, { lastName: expression }];
  }
  if (req.query.status) filter.accountStatus = req.query.status;
  const users = await User.find(filter)
    .select('_id firstName lastName email roles accountStatus isVerified createdAt')
    .sort({ createdAt: -1 })
    .limit(req.query.limit)
    .lean();
  res.json({ success: true, data: { users } });
});

const freezeUser = asyncHandler(async (req, res) => {
  const status = req.body.frozen ? 'frozen' : 'active';
  const user = await User.findById(req.params.id).select('_id accountStatus');
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  await pool.query(
    "UPDATE accounts SET status = $2 WHERE owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet'",
    [String(user._id), status]
  );
  user.accountStatus = status;
  await user.save();
  res.json({ success: true, data: { userId: String(user._id), accountStatus: status } });
});

const getWalletLedger = asyncHandler(async (req, res) => {
  const account = await pool.query(
    `SELECT id::text, owner_id, currency, balance_minor::text AS balance, status
       FROM accounts WHERE id = $1 AND owner_type = 'user' AND account_type = 'wallet'`,
    [req.params.id]
  );
  if (!account.rowCount) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
  const entries = await pool.query(
    `SELECT le.id::text, le.transaction_id::text, le.direction, le.amount_minor::text,
            le.created_at, t.reference, t.type, t.status, t.metadata
       FROM ledger_entries le JOIN transactions t ON t.id = le.transaction_id
      WHERE le.account_id = $1 ORDER BY le.created_at DESC, le.id DESC`,
    [req.params.id]
  );
  res.json({ success: true, data: { wallet: account.rows[0], ledger: entries.rows } });
});

const setCommission = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES ('commission_rate_bps', $1::jsonb, $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING setting_value`,
    [JSON.stringify(req.body.rateBps), String(req.user._id)]
  );
  res.json({ success: true, data: { commissionRateBps: Number(result.rows[0].setting_value) } });
});

const revenueReport = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT date_trunc('day', le.created_at)::date AS day,
            SUM(le.amount_minor)::text AS revenue_kobo
       FROM ledger_entries le
       JOIN accounts a ON a.id = le.account_id
       JOIN transactions t ON t.id = le.transaction_id
      WHERE a.owner_type = 'system' AND a.owner_id = 'PLATFORM_REVENUE'
        AND le.direction = 'credit' AND t.status = 'posted'
        AND le.created_at >= $1::date AND le.created_at < ($2::date + INTERVAL '1 day')
      GROUP BY date_trunc('day', le.created_at)::date
      ORDER BY day`,
    [req.query.from, req.query.to]
  );
  res.json({ success: true, data: { revenueByDay: result.rows } });
});

const topVendorsReport = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT s.vendor_id,
            SUM(i.unit_price_kobo::numeric * i.quantity)::text AS completed_sales_kobo,
            COUNT(DISTINCT s.id)::text AS completed_sub_orders
       FROM sub_orders s
       JOIN order_items i ON i.sub_order_id = s.id
      WHERE s.status = 'COMPLETED'
        AND s.completed_at >= date_trunc('month', NOW())
      GROUP BY s.vendor_id
      ORDER BY SUM(i.unit_price_kobo::numeric * i.quantity) DESC
      LIMIT 10`
  );
  res.json({ success: true, data: { vendors: result.rows } });
});

const escrowReport = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT balance_minor::text AS escrow_kobo, currency
       FROM accounts
      WHERE owner_type = 'system' AND owner_id = 'PLATFORM_ESCROW'`
  );
  res.json({ success: true, data: { escrow: result.rows } });
});

const reconciliationReport = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT a.id::text AS wallet_id, a.owner_id, a.currency,
            a.balance_minor::text AS cached_balance_minor,
            COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_minor
                              ELSE -le.amount_minor END), 0)::text AS ledger_balance_minor
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.account_id = a.id
      WHERE a.owner_type = 'user' AND a.account_type = 'wallet'
      GROUP BY a.id
      HAVING a.balance_minor <> COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_minor
                                                 ELSE -le.amount_minor END), 0)
      ORDER BY a.id`
  );
  res.json({ success: true, data: { discrepancies: result.rows, passed: result.rowCount === 0 } });
});

module.exports = {
  listUsers,
  freezeUser,
  getWalletLedger,
  setCommission,
  revenueReport,
  topVendorsReport,
  escrowReport,
  reconciliationReport
};
