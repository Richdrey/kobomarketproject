const asyncHandler = require('../middleware/asyncHandler');
const cartService = require('../services/cart.service');

const get = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user._id);
  res.json({ success: true, data: { cart } });
});

const add = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem(req.user._id, req.body);
  res.status(201).json({ success: true, data: { cart } });
});

const update = asyncHandler(async (req, res) => {
  const cart = await cartService.updateItem(req.user._id, req.params.itemId, req.body);
  res.json({ success: true, data: { cart } });
});

const remove = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user._id, req.params.itemId);
  res.json({ success: true, data: { cart } });
});

module.exports = { get, add, update, remove };
