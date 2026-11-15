const mongoose = require('mongoose');

const refreshSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    purgeAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('RefreshSession', refreshSessionSchema);
