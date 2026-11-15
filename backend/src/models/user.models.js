const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    roles: { type: [String], enum: ['buyer', 'vendor', 'admin'], default: ['buyer'] },
    accountStatus: { type: String, enum: ['active', 'frozen'], default: 'active' },
    isVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
    walletProvisioningStatus: {
      type: String,
      enum: ['pending', 'provisioned'],
      default: 'pending'
    }
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('User', userSchema);
