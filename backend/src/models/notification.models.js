const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, enum: [
    'ORDER_PLACED', 'ORDER_SHIPPED', 'FUNDS_RELEASED', 'WALLET_FUNDED',
    'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'PAYOUT_SUCCESS', 'PAYOUT_FAILURE'
  ] },
  message: { type: String, required: true, maxlength: 500 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

notificationSchema.index({ userId: 1, _id: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
