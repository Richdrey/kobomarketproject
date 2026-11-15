const asyncHandler = require('../middleware/asyncHandler');
const storeService = require('../services/store.service');

const apply = asyncHandler(async (req, res) => {
  const store = await storeService.applyForVendor(req.user._id, req.body);
  res.status(201).json({
    success: true,
    data: {
      store: {
        id: String(store._id),
        name: store.name,
        status: store.status
      }
    }
  });
});

const getById = asyncHandler(async (req, res) => {
  const store = await storeService.getPublicStore(req.params.id);
  res.json({ success: true, data: { store } });
});

const listPending = asyncHandler(async (req, res) => {
  const stores = await storeService.listPendingApplications();
  res.json({ success: true, data: { stores } });
});

const approve = asyncHandler(async (req, res) => {
  const store = await storeService.reviewApplication(req.params.id, req.user._id, 'approved');
  res.json({ success: true, data: { store: { id: String(store._id), status: store.status } } });
});

const reject = asyncHandler(async (req, res) => {
  const store = await storeService.reviewApplication(req.params.id, req.user._id, 'rejected', req.body.reason);
  res.json({ success: true, data: { store: { id: String(store._id), status: store.status } } });
});

module.exports = { apply, getById, listPending, approve, reject };
