const Store = require('../models/store.models');
const User = require('../models/user.models');
const { encryptBankDetails } = require('../utils/bank-details');
const { AppError } = require('../middleware/errorHandler');

async function applyForVendor(userId, { name, description, bankDetails }) {
  const existing = await Store.findOne({ vendorId: userId });
  if (existing) {
    throw new AppError(409, 'VENDOR_APPLICATION_EXISTS', 'A vendor application already exists');
  }

  const store = await Store.create({
    vendorId: userId,
    name,
    description,
    bankDetailsEncrypted: encryptBankDetails(bankDetails),
    status: 'pending'
  });
  await User.updateOne({ _id: userId }, { $addToSet: { roles: 'vendor' } });
  return store;
}

async function getPublicStore(id) {
  const store = await Store.findOne({
    status: 'approved',
    $or: [{ _id: id }, { vendorId: id }]
  }).select('vendorId name description createdAt');
  if (!store) {
    throw new AppError(404, 'STORE_NOT_FOUND', 'Approved store not found');
  }
  return store;
}

async function getApprovedStoreForVendor(vendorId) {
  const store = await Store.findOne({ vendorId, status: 'approved' });
  if (!store) {
    throw new AppError(403, 'VENDOR_NOT_APPROVED', 'An approved store is required for this action');
  }
  return store;
}

async function reviewApplication(storeId, adminId, decision, rejectionReason) {
  const store = await Store.findOneAndUpdate(
    { _id: storeId, status: 'pending' },
    {
      $set: {
        status: decision,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectionReason: decision === 'rejected' ? rejectionReason : null
      }
    },
    { new: true }
  );
  if (!store) {
    throw new AppError(404, 'PENDING_APPLICATION_NOT_FOUND', 'Pending vendor application not found');
  }
  return store;
}

async function listPendingApplications() {
  return Store.find({ status: 'pending' })
    .select('-bankDetailsEncrypted')
    .sort({ createdAt: 1 })
    .lean();
}

module.exports = { applyForVendor, getPublicStore, getApprovedStoreForVendor, reviewApplication, listPendingApplications };
