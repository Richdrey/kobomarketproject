const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const notificationService = require('../services/notification.service');

const list = asyncHandler(async (req, res) => {
  const result = await notificationService.list(req.user._id, req.query);
  res.json({ success: true, data: result });
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user._id);
  res.json({ success: true, data: { unreadCount: count } });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.user._id, req.params.id);
  if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  res.json({ success: true, data: { notification } });
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllRead(req.user._id);
  res.json({ success: true, data: result });
});

module.exports = { list, unreadCount, markRead, markAllRead };
