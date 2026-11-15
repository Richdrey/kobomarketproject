const asyncHandler = require('../middleware/asyncHandler');
const disputeService = require('../services/dispute.service');
const notificationService = require('../services/notification.service');

const open = asyncHandler(async (req, res) => {
  const dispute = await disputeService.openDispute(req.params.id, req.user._id, req.body);
  notificationService.publishDispute(dispute.id, 'DISPUTE_OPENED', 'A dispute was opened for this order.');
  res.status(201).json({ success: true, data: { dispute } });
});

const list = asyncHandler(async (req, res) => {
  const disputes = await disputeService.listDisputes(req.query);
  res.json({ success: true, data: { disputes } });
});

const resolve = asyncHandler(async (req, res) => {
  const result = await disputeService.resolveDispute(req.params.id, req.user._id, req.body);
  notificationService.publishDispute(req.params.id, 'DISPUTE_RESOLVED', 'An admin resolved your order dispute.');
  res.json({ success: true, data: result });
});

module.exports = { open, list, resolve };
