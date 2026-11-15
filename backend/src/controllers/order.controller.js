const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const pool = require('../configs/postgres');
const ledger = require('../services/ledger.service');
const orderService = require('../services/order.service');
const escrowService = require('../services/escrow.service');
const notificationService = require('../services/notification.service');

const checkout = asyncHandler(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 200) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');

  const prior = await pool.query(
    `SELECT request_hash, response
       FROM idempotency_keys
      WHERE owner_id = $1 AND operation = 'checkout' AND key = $2`,
    [String(req.user._id), key]
  );
  const hash = ledger.requestHash(req.body || {});
  if (prior.rowCount) {
    if (prior.rows[0].request_hash !== hash) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request body');
    }
    if (!prior.rows[0].response) {
      throw new AppError(409, 'CHECKOUT_IN_PROGRESS', 'A request with this Idempotency-Key is still processing');
    }
    const response = prior.rows[0].response;
    if (response.orderId) {
      const current = await pool.query('SELECT status FROM orders WHERE id = $1', [response.orderId]);
      if (current.rowCount && current.rows[0].status === 'CANCELLED') {
        throw new AppError(409, 'INSUFFICIENT_STOCK', 'Stock changed during checkout; escrow was refunded and the order was cancelled');
      }
    }
    return res.status(200).json({ success: true, data: response });
  }

  const result = await orderService.checkout(req.user._id, key, req.body || {});
  notificationService.publishOrderPlaced(result.orderId, req.user._id);
  res.status(201).json({ success: true, data: result });
});

const list = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT o.id::text, o.status, o.currency, o.created_at,
            COALESCE(SUM(i.unit_price_kobo::numeric * i.quantity), 0)::text AS total_kobo,
            COALESCE(jsonb_agg(jsonb_build_object(
              'subOrderId', s.id::text, 'vendorId', s.vendor_id, 'status', s.status, 'shippedAt', s.shipped_at
            )) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS sub_orders
       FROM orders o
       LEFT JOIN sub_orders s ON s.order_id = o.id
       LEFT JOIN order_items i ON i.sub_order_id = s.id
      WHERE o.buyer_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100`,
    [String(req.user._id)]
  );
  res.json({ success: true, data: { orders: result.rows } });
});

const vendorList = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT s.id::text AS sub_order_id, s.order_id::text, s.status, s.shipped_at, s.created_at,
            o.buyer_id, COALESCE(SUM(i.unit_price_kobo::numeric * i.quantity), 0)::text AS total_kobo,
            COALESCE(jsonb_agg(jsonb_build_object(
              'productId', i.product_id, 'variantId', i.variant_id, 'quantity', i.quantity,
              'unitPriceKobo', i.unit_price_kobo::text
            )) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       LEFT JOIN order_items i ON i.sub_order_id = s.id
      WHERE s.vendor_id = $1 AND ($2::text IS NULL OR s.status = $2)
      GROUP BY s.id, o.id
      ORDER BY s.created_at DESC
      LIMIT $3`,
    [String(req.user._id), req.query.status || null, req.query.limit]
  );
  res.json({ success: true, data: { subOrders: result.rows } });
});

const getById = asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT o.id::text, o.status, o.currency, o.created_at,
            COALESCE(SUM(i.unit_price_kobo::numeric * i.quantity), 0)::text AS total_kobo,
            COALESCE(jsonb_agg(jsonb_build_object(
              'subOrderId', s.id::text, 'vendorId', s.vendor_id, 'status', s.status,
              'shippedAt', s.shipped_at, 'productId', i.product_id, 'variantId', i.variant_id,
              'quantity', i.quantity, 'unitPriceKobo', i.unit_price_kobo::text,
              'commissionRateBps', i.commission_rate_bps
            )) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS items
       FROM orders o
       LEFT JOIN sub_orders s ON s.order_id = o.id
       LEFT JOIN order_items i ON i.sub_order_id = s.id
      WHERE o.id = $1 AND o.buyer_id = $2
      GROUP BY o.id`,
    [req.params.id, String(req.user._id)]
  );
  if (!result.rowCount) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  res.json({ success: true, data: { order: result.rows[0] } });
});

const cancel = asyncHandler(async (req, res) => {
  const result = await escrowService.cancelOrder(req.params.id, req.user._id);
  res.json({ success: true, data: result });
});

const ship = asyncHandler(async (req, res) => {
  const result = await escrowService.shipSubOrder(req.params.id, req.user._id);
  notificationService.publishOrderShipped(req.params.id);
  res.json({ success: true, data: result });
});

const confirmDelivery = asyncHandler(async (req, res) => {
  const result = await escrowService.confirmDelivery(req.params.id, req.user._id);
  if (result.status === 'COMPLETED') notificationService.publishFundsReleased(req.params.id);
  res.json({ success: true, data: result });
});

module.exports = { checkout, list, vendorList, getById, cancel, ship, confirmDelivery };
