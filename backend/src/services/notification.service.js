const { EventEmitter } = require('events');
const Notification = require('../models/notification.models');
const pool = require('../configs/postgres');
const { logger } = require('../middleware/logger');

const events = new EventEmitter();

events.on('notification', (message) => {
  setImmediate(async () => {
    try {
      await Notification.create(message);
    } catch (error) {
      logger.error({ error, type: message.type, userId: String(message.userId) }, 'Notification delivery failed');
    }
  });
});

function publish(userId, type, message, data = {}) {
  events.emit('notification', { userId, type, message, data });
}

function publishOrderPlaced(orderId, buyerId) {
  publish(buyerId, 'ORDER_PLACED', 'Your order was placed successfully.', { orderId: String(orderId) });
  setImmediate(async () => {
    try {
      const result = await pool.query('SELECT DISTINCT vendor_id FROM sub_orders WHERE order_id = $1', [orderId]);
      for (const row of result.rows) {
        publish(row.vendor_id, 'ORDER_PLACED', 'A new order was placed for your store.', { orderId: String(orderId) });
      }
    } catch (error) {
      logger.error({ error, orderId: String(orderId) }, 'Order notification recipients could not be loaded');
    }
  });
}

function publishOrderShipped(subOrderId) {
  setImmediate(async () => {
    try {
      const result = await pool.query(
        `SELECT o.buyer_id, s.vendor_id, s.order_id
           FROM sub_orders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1`,
        [subOrderId]
      );
      if (!result.rowCount) return;
      const row = result.rows[0];
      publish(row.buyer_id, 'ORDER_SHIPPED', 'A vendor has shipped your order.', {
        orderId: String(row.order_id),
        subOrderId: String(subOrderId)
      });
    } catch (error) {
      logger.error({ error, subOrderId: String(subOrderId) }, 'Shipment notification recipient could not be loaded');
    }
  });
}

function publishFundsReleased(subOrderId) {
  setImmediate(async () => {
    try {
      const result = await pool.query(
        `SELECT o.buyer_id, s.vendor_id, s.order_id
           FROM sub_orders s JOIN orders o ON o.id = s.order_id WHERE s.id = $1`,
        [subOrderId]
      );
      if (!result.rowCount) return;
      const row = result.rows[0];
      const data = { orderId: String(row.order_id), subOrderId: String(subOrderId) };
      publish(row.buyer_id, 'FUNDS_RELEASED', 'Funds for your order have been released to the vendor.', data);
      publish(row.vendor_id, 'FUNDS_RELEASED', 'Escrow funds for your order have been released.', data);
    } catch (error) {
      logger.error({ error, subOrderId: String(subOrderId) }, 'Funds release notification recipients could not be loaded');
    }
  });
}

function publishDispute(disputeId, type, message) {
  setImmediate(async () => {
    try {
      const result = await pool.query(
        `SELECT d.buyer_id, s.vendor_id, s.id AS sub_order_id
           FROM disputes d JOIN sub_orders s ON s.id = d.sub_order_id
          WHERE d.id = $1`,
        [disputeId]
      );
      if (!result.rowCount) return;
      const row = result.rows[0];
      const data = { disputeId: String(disputeId), subOrderId: String(row.sub_order_id) };
      publish(row.buyer_id, type, message, data);
      publish(row.vendor_id, type, message, data);
    } catch (error) {
      logger.error({ error, disputeId: String(disputeId) }, 'Dispute notification recipients could not be loaded');
    }
  });
}

async function list(userId, { cursor, limit = 20 }) {
  const query = { userId };
  if (cursor) query._id = { $lt: cursor };
  const notifications = await Notification.find(query).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = notifications.length > limit;
  const page = hasMore ? notifications.slice(0, limit) : notifications;
  return {
    notifications: page,
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null
  };
}

async function markRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();
  return notification;
}

async function markAllRead(userId) {
  const result = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  return { updatedCount: result.modifiedCount };
}

async function unreadCount(userId) {
  return Notification.countDocuments({ userId, readAt: null });
}

module.exports = {
  publish,
  publishOrderPlaced,
  publishOrderShipped,
  publishFundsReleased,
  publishDispute,
  list,
  markRead,
  markAllRead,
  unreadCount
};
