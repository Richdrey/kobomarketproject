const pool = require('../configs/postgres');
const ledger = require('./ledger.service');
const { AppError } = require('../middleware/errorHandler');

async function releaseLockedSubOrder(client, subOrder) {
  const dispute = await client.query(
    "SELECT 1 FROM disputes WHERE sub_order_id = $1 AND status = 'OPEN'",
    [subOrder.id]
  );
  if (dispute.rowCount) return false;

  const amounts = await client.query(
    `SELECT
       COALESCE(SUM(unit_price_kobo::numeric * quantity), 0)::text AS gross,
       COALESCE(SUM(FLOOR(unit_price_kobo::numeric * quantity * commission_rate_bps / 10000)), 0)::text AS commission
     FROM order_items WHERE sub_order_id = $1`,
    [subOrder.id]
  );
  const gross = BigInt(amounts.rows[0].gross);
  const commission = BigInt(amounts.rows[0].commission);
  if (gross <= 0n || commission > gross) throw new Error('Sub-order totals are invalid');

  const accounts = await client.query(
    `SELECT id, owner_id FROM accounts
      WHERE currency = 'NGN' AND (
        (owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet') OR
        (owner_type = 'system' AND owner_id IN ('PLATFORM_ESCROW', 'PLATFORM_REVENUE'))
      )
      FOR UPDATE`,
    [subOrder.vendor_id]
  );
  const vendor = accounts.rows.find((row) => row.owner_id === subOrder.vendor_id);
  const escrow = accounts.rows.find((row) => row.owner_id === 'PLATFORM_ESCROW');
  const revenue = accounts.rows.find((row) => row.owner_id === 'PLATFORM_REVENUE');
  if (!vendor || !escrow || !revenue) throw new Error('Release accounts are missing');

  const entries = [{ accountId: escrow.id, direction: 'debit', amountMinor: gross.toString() }];
  const vendorAmount = gross - commission;
  if (vendorAmount > 0n) entries.push({ accountId: vendor.id, direction: 'credit', amountMinor: vendorAmount.toString() });
  if (commission > 0n) entries.push({ accountId: revenue.id, direction: 'credit', amountMinor: commission.toString() });

  await ledger.postTransaction(client, {
    reference: `escrow-release:${subOrder.id}`,
    type: 'escrow_release',
    idempotencyKey: `escrow-release:${subOrder.id}`,
    metadata: {
      subOrderId: String(subOrder.id),
      amountMinor: gross.toString(),
      commissionMinor: commission.toString(),
      currency: 'NGN'
    },
    entries
  });
  await client.query("UPDATE sub_orders SET status = 'COMPLETED' WHERE id = $1", [subOrder.id]);
  await client.query(
    `UPDATE orders SET status = 'COMPLETED'
      WHERE id = $1
        AND NOT EXISTS (SELECT 1 FROM sub_orders WHERE order_id = $1 AND status <> 'COMPLETED')`,
    [subOrder.order_id]
  );
  return true;
}

async function shipSubOrder(subOrderId, vendorId) {
  const result = await pool.query(
    `UPDATE sub_orders
        SET status = 'SHIPPED', shipped_at = NOW()
      WHERE id = $1 AND vendor_id = $2 AND status = 'PAID'
      RETURNING id::text`,
    [subOrderId, String(vendorId)]
  );
  if (!result.rowCount) throw new AppError(409, 'SUB_ORDER_NOT_SHIPPABLE', 'Sub-order does not exist, is not yours, or cannot be shipped');
  return { subOrderId: result.rows[0].id, status: 'SHIPPED' };
}

async function confirmDelivery(subOrderId, buyerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT s.id, s.order_id, s.status, o.buyer_id
         FROM sub_orders s JOIN orders o ON o.id = s.order_id
        WHERE s.id = $1 FOR UPDATE OF s, o`,
      [subOrderId]
    );
    if (!result.rowCount || result.rows[0].buyer_id !== String(buyerId)) {
      throw new AppError(404, 'SUB_ORDER_NOT_FOUND', 'Sub-order not found');
    }
    const subOrder = result.rows[0];
    if (subOrder.status !== 'SHIPPED') {
      throw new AppError(409, 'INVALID_ORDER_TRANSITION', 'Only a shipped sub-order can be confirmed');
    }
    const openDispute = await client.query(
      "SELECT 1 FROM disputes WHERE sub_order_id = $1 AND status = 'OPEN'",
      [subOrderId]
    );
    if (openDispute.rowCount) throw new AppError(409, 'DISPUTE_OPEN', 'A disputed sub-order cannot be confirmed');
    await client.query("UPDATE sub_orders SET status = 'DELIVERED' WHERE id = $1", [subOrderId]);
    const released = await releaseLockedSubOrder(client, subOrder);
    await client.query('COMMIT');
    return { subOrderId: String(subOrderId), status: released ? 'COMPLETED' : 'DELIVERED' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelOrder(orderId, buyerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      'SELECT id, buyer_id, status FROM orders WHERE id = $1 FOR UPDATE',
      [orderId]
    );
    if (!orderResult.rowCount || orderResult.rows[0].buyer_id !== String(buyerId)) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const order = orderResult.rows[0];
    if (order.status !== 'PAID') throw new AppError(409, 'ORDER_NOT_CANCELLABLE', 'Only an unshipped order can be cancelled');
    const subOrders = await client.query(
      'SELECT id, status FROM sub_orders WHERE order_id = $1 FOR UPDATE',
      [orderId]
    );
    if (!subOrders.rowCount || subOrders.rows.some((row) => row.status !== 'PAID')) {
      throw new AppError(409, 'ORDER_NOT_CANCELLABLE', 'Order cannot be cancelled after any vendor ships');
    }
    const grossResult = await client.query(
      `SELECT COALESCE(SUM(i.unit_price_kobo::numeric * i.quantity), 0)::text AS gross
         FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id
        WHERE s.order_id = $1`,
      [orderId]
    );
    const amount = BigInt(grossResult.rows[0].gross);
    const accounts = await client.query(
      `SELECT id, owner_id FROM accounts
        WHERE currency = 'NGN' AND (
          (owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet') OR
          (owner_type = 'system' AND owner_id = 'PLATFORM_ESCROW')
        )
        FOR UPDATE`,
      [String(buyerId)]
    );
    const wallet = accounts.rows.find((row) => row.owner_id === String(buyerId));
    const escrow = accounts.rows.find((row) => row.owner_id === 'PLATFORM_ESCROW');
    if (!wallet || !escrow || amount <= 0n) throw new Error('Cancellation accounts or amount are invalid');
    await ledger.postTransaction(client, {
      reference: `order-cancellation:${orderId}`,
      type: 'order_refund',
      idempotencyKey: `order-cancellation:${orderId}`,
      metadata: { orderId: String(orderId), amountMinor: amount.toString(), currency: 'NGN' },
      entries: [
        { accountId: escrow.id, direction: 'debit', amountMinor: amount.toString() },
        { accountId: wallet.id, direction: 'credit', amountMinor: amount.toString() }
      ]
    });
    await client.query("UPDATE sub_orders SET status = 'CANCELLED' WHERE order_id = $1", [orderId]);
    await client.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
    await client.query('COMMIT');
    return { orderId: String(orderId), status: 'CANCELLED', refundedKobo: amount.toString() };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeSubOrder(subOrderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id, order_id, vendor_id, status FROM sub_orders WHERE id = $1 FOR UPDATE',
      [subOrderId]
    );
    if (!result.rowCount || result.rows[0].status !== 'SHIPPED') {
      await client.query('COMMIT');
      return false;
    }
    const completed = await releaseLockedSubOrder(client, result.rows[0]);
    await client.query('COMMIT');
    return completed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function autoCompleteDueSubOrders(timeoutHours = Number(process.env.ESCROW_TIMEOUT_HOURS || 72)) {
  if (!Number.isInteger(timeoutHours) || timeoutHours < 1 || timeoutHours > 720) {
    throw new Error('ESCROW_TIMEOUT_HOURS must be an integer between 1 and 720');
  }
  const due = await pool.query(
    `SELECT s.id::text FROM sub_orders s
      WHERE s.status = 'SHIPPED'
        AND s.shipped_at <= NOW() - ($1 * INTERVAL '1 hour')
        AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.sub_order_id = s.id AND d.status = 'OPEN')
      ORDER BY s.shipped_at
      LIMIT 100`
    , [timeoutHours]
  );
  let completed = 0;
  for (const row of due.rows) {
    if (await completeSubOrder(row.id)) completed += 1;
  }
  return completed;
}

module.exports = { shipSubOrder, confirmDelivery, cancelOrder, completeSubOrder, autoCompleteDueSubOrders };
