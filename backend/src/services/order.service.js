const crypto = require('crypto');
const Cart = require('../models/cart.models');
const Product = require('../models/product.models');
const pool = require('../configs/postgres');
const ledger = require('./ledger.service');
const { AppError } = require('../middleware/errorHandler');

const MAX_BIGINT = 9223372036854775807n;

async function loadCheckoutLines(userId) {
  const cart = await Cart.findOne({ userId }).lean();
  if (!cart?.items.length) throw new AppError(400, 'CART_EMPTY', 'Add items to your cart before checkout');
  const products = await Product.find({
    _id: { $in: cart.items.map((item) => item.productId) },
    isActive: true,
    deletedAt: null
  }).lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const lines = [];

  for (const item of cart.items) {
    const product = productById.get(String(item.productId));
    if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'A cart product is no longer available');
    let variantId = '';
    if (product.variants.length) {
      if (!item.variantId) throw new AppError(409, 'VARIANT_REQUIRED', 'A cart item is missing its variant');
      const variant = product.variants.find((candidate) => String(candidate._id) === String(item.variantId));
      if (!variant || !variant.isActive) throw new AppError(409, 'VARIANT_UNAVAILABLE', 'A cart variant is no longer available');
      variantId = String(variant._id);
    }

    const price = await pool.query(
      `SELECT price_kobo::text FROM product_prices WHERE product_id = $1 AND variant_id = $2 AND currency = 'NGN'`,
      [String(product._id), variantId]
    );
    if (!price.rowCount) throw new AppError(409, 'PRODUCT_PRICE_UNAVAILABLE', 'A cart item has no current NGN price');
    const amount = BigInt(price.rows[0].price_kobo) * BigInt(item.quantity);
    if (amount > MAX_BIGINT) throw new AppError(400, 'ORDER_TOTAL_TOO_LARGE', 'Order amount exceeds the supported range');
    lines.push({
      productId: String(product._id),
      variantId,
      vendorId: String(product.vendorId),
      quantity: item.quantity,
      unitPriceKobo: price.rows[0].price_kobo,
      amountKobo: amount.toString()
    });
  }
  return lines;
}

async function decrementStock(line) {
  const filter = { _id: line.productId, isActive: true, deletedAt: null };
  let update;
  if (line.variantId) {
    filter.variants = { $elemMatch: { _id: line.variantId, isActive: true, stockQuantity: { $gte: line.quantity } } };
    update = { $inc: { 'variants.$.stockQuantity': -line.quantity } };
  } else {
    filter.stockQuantity = { $gte: line.quantity };
    update = { $inc: { stockQuantity: -line.quantity } };
  }
  const result = await Product.updateOne(filter, update);
  return result.modifiedCount === 1;
}

async function restoreStock(line) {
  const filter = { _id: line.productId };
  const update = line.variantId
    ? { $inc: { 'variants.$[variant].stockQuantity': line.quantity } }
    : { $inc: { stockQuantity: line.quantity } };
  const options = line.variantId
    ? { arrayFilters: [{ 'variant._id': line.variantId }] }
    : undefined;
  await Product.updateOne(filter, update, options);
}

async function compensateFailedStock(orderId, buyerId, amountKobo) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query('SELECT id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!order.rowCount || order.rows[0].status === 'CANCELLED') {
      await client.query('COMMIT');
      return;
    }
    const accounts = await client.query(
      `SELECT id, owner_id FROM accounts
        WHERE currency = 'NGN'
          AND ((owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet')
            OR (owner_type = 'system' AND owner_id = 'PLATFORM_ESCROW'))
        FOR UPDATE`,
      [String(buyerId)]
    );
    const buyerWallet = accounts.rows.find((account) => account.owner_id === String(buyerId));
    const escrow = accounts.rows.find((account) => account.owner_id === 'PLATFORM_ESCROW');
    if (!buyerWallet || !escrow) throw new Error('Checkout compensation accounts are missing');

    await ledger.postTransaction(client, {
      reference: `stock-compensation:${orderId}`,
      type: 'checkout_compensation',
      idempotencyKey: `stock-compensation:${orderId}`,
      metadata: { orderId: String(orderId), amountMinor: amountKobo, currency: 'NGN' },
      entries: [
        { accountId: escrow.id, direction: 'debit', amountMinor: amountKobo },
        { accountId: buyerWallet.id, direction: 'credit', amountMinor: amountKobo }
      ]
    });
    await client.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
    await client.query("UPDATE sub_orders SET status = 'CANCELLED' WHERE order_id = $1 AND status = 'PAID'", [orderId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function checkout(buyerId, idempotencyKey, requestBody = {}) {
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  }
  const lines = await loadCheckoutLines(buyerId);
  const total = lines.reduce((sum, line) => sum + BigInt(line.amountKobo), 0n);
  if (total <= 0n || total > MAX_BIGINT) throw new AppError(400, 'INVALID_ORDER_TOTAL', 'Order total is outside the supported range');

  const client = await pool.connect();
  let orderResponse;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`checkout:${buyerId}:${idempotencyKey}`]);
    const claim = await ledger.claimIdempotency(client, {
      ownerId: buyerId,
      operation: 'checkout',
      key: idempotencyKey,
      body: requestBody
    });
    if (claim.replay) {
      await client.query('COMMIT');
      return claim.replay;
    }

    const wallets = await client.query(
      `SELECT id, balance_minor::text, status
         FROM accounts
        WHERE owner_type = 'user' AND owner_id = $1 AND account_type = 'wallet' AND currency = 'NGN'
        FOR UPDATE`,
      [String(buyerId)]
    );
    if (!wallets.rowCount || wallets.rows[0].status !== 'active') {
      throw new AppError(409, 'WALLET_UNAVAILABLE', 'NGN wallet is unavailable');
    }
    if (BigInt(wallets.rows[0].balance_minor) < total) {
      throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Wallet balance is insufficient');
    }

    const escrow = await client.query(
      `SELECT id FROM accounts
        WHERE owner_type = 'system' AND owner_id = 'PLATFORM_ESCROW' AND currency = 'NGN'
        FOR UPDATE`
    );
    const commission = await client.query(
      `SELECT setting_value::text AS value FROM platform_settings WHERE setting_key = 'commission_rate_bps'`
    );
    if (!escrow.rowCount || !commission.rowCount) throw new Error('Escrow account or commission setting is missing');
    const rateBps = Number(commission.rows[0].value.replaceAll('"', ''));
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
      throw new Error('Commission setting is invalid');
    }

    const orderResult = await client.query(
      `INSERT INTO orders (buyer_id, currency, status, idempotency_key, request_hash)
       VALUES ($1, 'NGN', 'PAID', $2, $3)
       RETURNING id::text`,
      [String(buyerId), idempotencyKey, claim.hash]
    );
    const orderId = orderResult.rows[0].id;
    const subOrders = new Map();
    for (const line of lines) {
      let subOrderId = subOrders.get(line.vendorId);
      if (!subOrderId) {
        const subOrder = await client.query(
          `INSERT INTO sub_orders (order_id, vendor_id, status)
           VALUES ($1, $2, 'PAID') RETURNING id::text`,
          [orderId, line.vendorId]
        );
        subOrderId = subOrder.rows[0].id;
        subOrders.set(line.vendorId, subOrderId);
      }
      await client.query(
        `INSERT INTO order_items (sub_order_id, product_id, variant_id, quantity, unit_price_kobo, commission_rate_bps)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [subOrderId, line.productId, line.variantId || null, line.quantity, line.unitPriceKobo, rateBps]
      );
    }

    await ledger.postTransaction(client, {
      reference: `checkout:${orderId}`,
      type: 'checkout',
      idempotencyKey: `checkout:${buyerId}:${idempotencyKey}`,
      metadata: { orderId, amountMinor: total.toString(), currency: 'NGN' },
      entries: [
        { accountId: wallets.rows[0].id, direction: 'debit', amountMinor: total.toString() },
        { accountId: escrow.rows[0].id, direction: 'credit', amountMinor: total.toString() }
      ]
    });
    orderResponse = {
      orderId,
      status: 'PAID',
      currency: 'NGN',
      totalKobo: total.toString(),
      subOrderIds: [...subOrders.values()]
    };
    await ledger.completeIdempotency(client, {
      ownerId: buyerId,
      operation: 'checkout',
      key: idempotencyKey,
      response: orderResponse
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const reserved = [];
  for (const line of lines) {
    if (!await decrementStock(line)) {
      for (const reservedLine of reserved) await restoreStock(reservedLine);
      try {
        await compensateFailedStock(orderResponse.orderId, buyerId, total.toString());
      } catch {
        throw new AppError(503, 'CHECKOUT_COMPENSATION_PENDING', 'Stock reservation failed; order compensation requires reconciliation');
      }
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Stock changed during checkout; escrow was refunded and the order was cancelled');
    }
    reserved.push(line);
  }

  await Cart.updateOne({ userId: buyerId }, { $set: { items: [] } });
  return orderResponse;
}

module.exports = { checkout };
