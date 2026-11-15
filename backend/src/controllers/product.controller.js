const asyncHandler = require('../middleware/asyncHandler');
const productService = require('../services/product.service');
const reviewService = require('../services/review.service');

const list = asyncHandler(async (req, res) => {
  const result = await productService.listProducts(req.query);
  res.json({ success: true, data: result });
});

const getBySlug = asyncHandler(async (req, res) => {
  const product = await productService.getProductBySlug(req.params.slug);
  res.json({ success: true, data: { product } });
});

const create = asyncHandler(async (req, res) => {
  const product = await productService.createProduct(req.user._id, req.body);
  res.status(201).json({ success: true, data: { product } });
});

const update = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(req.user._id, req.params.id, req.body);
  res.json({ success: true, data: { product } });
});

const remove = asyncHandler(async (req, res) => {
  const product = await productService.softDeleteProduct(req.user._id, req.params.id);
  res.json({ success: true, data: { id: String(product._id), deleted: true } });
});

const createReview = asyncHandler(async (req, res) => {
  const review = await reviewService.createReview(req.user._id, req.params.id, req.body);
  res.status(201).json({ success: true, data: { review } });
});

const listReviews = asyncHandler(async (req, res) => {
  const data = await reviewService.getReviews(req.params.id, req.query);
  res.json({ success: true, data });
});

module.exports = { list, getBySlug, create, update, remove, createReview, listReviews };
