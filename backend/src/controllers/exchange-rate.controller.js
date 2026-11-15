const asyncHandler = require('../middleware/asyncHandler');
const pool = require('../configs/postgres');

const listRates = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT ON (base_currency, quote_currency)
            base_currency AS "baseCurrency", quote_currency AS "quoteCurrency",
            rate_scaled::text AS "rateScaled", rate_scale::text AS "rateScale",
            source, updated_by AS "updatedBy", effective_at AS "effectiveAt"
       FROM exchange_rates
      ORDER BY base_currency, quote_currency, effective_at DESC`
  );
  res.json({ success: true, data: { exchangeRates: result.rows } });
});

const setRate = asyncHandler(async (req, res) => {
  const { baseCurrency, quoteCurrency, rateScaled, rateScale = '1000000' } = req.body;
  const result = await pool.query(
    `INSERT INTO exchange_rates
       (base_currency, quote_currency, rate_scaled, rate_scale, source, updated_by)
     VALUES ($1, $2, $3, $4, 'admin', $5)
     RETURNING base_currency AS "baseCurrency", quote_currency AS "quoteCurrency",
               rate_scaled::text AS "rateScaled", rate_scale::text AS "rateScale",
               source, updated_by AS "updatedBy", effective_at AS "effectiveAt"`,
    [baseCurrency, quoteCurrency, rateScaled, rateScale, String(req.user._id)]
  );
  res.status(201).json({ success: true, data: { exchangeRate: result.rows[0] } });
});

module.exports = { listRates, setRate };
