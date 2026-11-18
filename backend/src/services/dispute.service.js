const pool = require('../configs/postgres');
const ledger = require('./ledger.service');
const { AppError } = require('../middleware/errorHandler');

async function openDispute(subOrderId, buyerId, { reason, evidence = [] }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const subOrder = await client.query(
      `SELECT s.id, s.status, o.buyer_id
         FROM sub_orders s JOIN orders o ON o.id = s.order_id
        WHERE s.id = $1 FOR UPDATE OF s, o`,
      [subOrderId]
    );
    if (!subOrder.rowCount || subOrder.rows[0].buyer_id !== String(buyerId)) {
      throw new AppError(404, 'SUB_ORDER_NOT_FOUND', 'Sub-order not found');
    }
    if (!['SHIPPED', 'DELIVERED'].includes(subOrder.rows[0].status)) {
      throw new AppError(409, 'DISPUTE_NOT_ALLOWED', 'A dispute can only be opened on a shipped or delivered sub-order');
    }
    const created = await client.query(
      `INSERT INTO disputes (sub_order_id, buyer_id, status, reason, evidence)
       VALUES ($1, $2, 'OPEN', $3, $4::jsonb)
       RETURNING id::text, sub_order_id::text, status, reason, evidence, created_at`,
      [subOrderId, String(buyerId), reason, JSON.stringify(evidence)]
    );
    await client.query("UPDATE sub_orders SET status = 'DISPUTED' WHERE id = $1", [subOrderId]);
    await client.query('COMMIT');
    return created.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new AppError(409, 'DISPUTE_ALREADY_OPENED', 'A dispute already exists for this sub-order');
    throw error;
  } finally {
    client.release();
  }
}

async function listDisputes({ status, limit = 50 }) {
  const result = await pool.query(
    `SELECT d.id::text, d.sub_order_id::text, d.buyer_id, d.status, d.reason, d.evidence,
            d.resolution, d.resolution_note, d.resolved_by, d.created_at, d.resolved_at,
            s.vendor_id, o.id::text AS order_id
       FROM disputes d
       JOIN sub_orders s ON s.id = d.sub_order_id
       JOIN orders o ON o.id = s.order_id
      WHERE ($1::text IS NULL OR d.status = $1)
      ORDER BY d.created_at DESC
      LIMIT $2`,
    [status || null, limit]
  );
  return result.rows;
}

async function resolveDispute(disputeId, adminId, { resolution, note, refundKobo }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT d.id, d.sub_order_id, d.buyer_id, d.status AS dispute_status,
              s.order_id, s.vendor_id, s.status AS sub_order_status
         FROM disputes d
         JOIN sub_orders s ON s.id = d.sub_order_id
        WHERE d.id = $1
        FOR UPDATE OF d, s`,
      [disputeId]
    );
    if (!result.rowCount) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
    const dispute = result.rows[0];
    if (dispute.dispute_status !== 'OPEN' || dispute.sub_order_status !== 'DISPUTED') {
      throw new AppError(409, 'DISPUTE_ALREADY_RESOLVED', 'Dispute is not open');
    }

    const totals = await client.query(
      `SELECT COALESCE(SUM(unit_price_kobo::numeric * quantity), 0)::text AS gross,
              COALESCE(SUM(FLOOR(unit_price_kobo::numeric * quantity * commission_rate_bps / 10000)), 0)::text AS commission
         FROM order_items WHERE sub_order_id = $1`,
      [dispute.sub_order_id]
    );
    const gross = BigInt(totals.rows[0].gross);
    const originalCommission = BigInt(totals.rows[0].commission);
    if (gross <= 0n) throw new Error('Dispute sub-order total is invalid');

    const accounts = await client.query(
      `SELECT id, owner_id FROM accounts
        WHERE currency = 'NGN' AND (
          (owner_type = 'user' AND owner_id IN ($1, $2) AND account_type = 'wallet') OR
          (owner_type = 'system' AND owner_id IN ('PLATFORM_ESCROW', 'PLATFORM_REVENUE'))
        )
        FOR UPDATE`,
      [dispute.buyer_id, dispute.vendor_id]
    );
    const buyer = accounts.rows.find((row) => row.owner_id === dispute.buyer_id);
    const vendor = accounts.rows.find((row) => row.owner_id === dispute.vendor_id);
    const escrow = accounts.rows.find((row) => row.owner_id === 'PLATFORM_ESCROW');
    const revenue = accounts.rows.find((row) => row.owner_id === 'PLATFORM_REVENUE');
    if (!buyer || !vendor || !escrow || !revenue) throw new Error('Dispute resolution accounts are missing');

    let refund = 0n;
    let commission = 0n;
    let vendorAmount = 0n;
    const entries = [{ accountId: escrow.id, direction: 'debit', amountMinor: gross.toString() }];
    if (resolution === 'FULL_REFUND') {
      refund = gross;
      entries.push({ accountId: buyer.id, direction: 'credit', amountMinor: refund.toString() });
    } else if (resolution === 'PARTIAL_REFUND') {
      if (!/^(0|[1-9]\d*)$/.test(String(refundKobo))) {
        throw new AppError(400, 'INVALID_REFUND_AMOUNT', 'Partial refund must be an integer number of kobo');
      }
      refund = BigInt(refundKobo);
      if (refund <= 0n || refund >= gross) {
        throw new AppError(400, 'INVALID_REFUND_AMOUNT', 'Partial refund must be greater than zero and less than the order total');
      }
      const vendorGross = gross - refund;
      commission = (vendorGross * originalCommission) / gross;
      vendorAmount = vendorGross - commission;
      entries.push({ accountId: buyer.id, direction: 'credit', amountMinor: refund.toString() });
      if (vendorAmount > 0n) entries.push({ accountId: vendor.id, direction: 'credit', amountMinor: vendorAmount.toString() });
      if (commission > 0n) entries.push({ accountId: revenue.id, direction: 'credit', amountMinor: commission.toString() });
    } else if (resolution === 'REJECT') {
      commission = originalCommission;
      vendorAmount = gross - commission;
      if (vendorAmount > 0n) entries.push({ accountId: vendor.id, direction: 'credit', amountMinor: vendorAmount.toString() });
      if (commission > 0n) entries.push({ accountId: revenue.id, direction: 'credit', amountMinor: commission.toString() });
    } else {
      throw new AppError(400, 'INVALID_DISPUTE_RESOLUTION', 'Unsupported dispute resolution');
    }

    await ledger.postTransaction(client, {
      reference: `dispute-resolution:${dispute.id}`,
      type: `dispute_${resolution.toLowerCase()}`,
      idempotencyKey: `dispute-resolution:${dispute.id}`,
      metadata: {
        disputeId: String(dispute.id),
        subOrderId: String(dispute.sub_order_id),
        amountMinor: gross.toString(),
        refundMinor: refund.toString(),
        commissionMinor: commission.toString(),
        currency: 'NGN'
      },
      entries
    });
    await client.query(
      `UPDATE disputes
          SET status = 'RESOLVED', resolution = $2, resolution_note = $3,
              resolved_by = $4, resolved_at = NOW()
        WHERE id = $1`,
      [dispute.id, resolution, note, String(adminId)]
    );
    const nextStatus = resolution === 'FULL_REFUND' ? 'CANCELLED' : 'COMPLETED';
    await client.query(
      `UPDATE sub_orders SET status = $2,
          completed_at = CASE WHEN $2 = 'COMPLETED' THEN NOW() ELSE completed_at END
        WHERE id = $1`,
      [dispute.sub_order_id, nextStatus]
    );
    if (nextStatus === 'COMPLETED') {
      await client.query(
        `UPDATE orders SET status = 'COMPLETED'
          WHERE id = $1
            AND NOT EXISTS (SELECT 1 FROM sub_orders WHERE order_id = $1 AND status <> 'COMPLETED')`,
        [dispute.order_id]
      );
    } else {
      await client.query(
        `UPDATE orders SET status = 'CANCELLED'
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM sub_orders WHERE order_id = $1 AND status <> 'CANCELLED')`,
        [dispute.order_id]
      );
    }
    await client.query('COMMIT');
    return {
      disputeId: String(dispute.id),
      status: 'RESOLVED',
      resolution,
      refundKobo: refund.toString(),
      vendorKobo: vendorAmount.toString(),
      commissionKobo: commission.toString()
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { openDispute, listDisputes, resolveDispute };
