const mongoose = require('mongoose');
const Product = require('../models/product.models');
const Review = require('../models/review.models');
const pool = require('../configs/postgres');
const { AppError } = require('../middleware/errorHandler');

async function createReview(buyerId, productId, { rating, comment }) {
  const product = await Product.findOne({ _id: productId, isActive: true, deletedAt: null });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

  const eligible = await pool.query(
    `SELECT 1
       FROM orders o
       JOIN sub_orders so ON so.order_id = o.id
       JOIN order_items oi ON oi.sub_order_id = so.id
      WHERE o.buyer_id = $1 AND oi.product_id = $2 AND so.status = 'COMPLETED'
      LIMIT 1`,
    [String(buyerId), String(productId)]
  );
  if (!eligible.rowCount) {
    throw new AppError(403, 'REVIEW_NOT_ELIGIBLE', 'A completed order for this product is required to review it');
  }

  let review;
  try {
    review = await Review.create({ productId, buyerId, rating, comment });
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'Only one review per buyer and product is allowed');
    }
    throw error;
  }

  const updated = await Product.updateOne(
    { _id: productId },
    { $inc: { ratingSum: rating, ratingCount: 1 } }
  );
  if (updated.matchedCount !== 1) {
    await Review.deleteOne({ _id: review._id });
    throw new AppError(409, 'PRODUCT_CHANGED', 'The product changed while saving the review');
  }

  return review;
}

async function getReviews(productId, { limit = 20, before }) {
  if (!mongoose.isValidObjectId(productId)) {
    throw new AppError(400, 'INVALID_PRODUCT_ID', 'Product ID is invalid');
  }
  const query = { productId };
  if (before && mongoose.isValidObjectId(before)) query._id = { $lt: before };
  const reviews = await Review.find(query).sort({ _id: -1 }).limit(Number(limit)).lean();
  return { reviews, nextCursor: reviews.length === Number(limit) ? String(reviews[reviews.length - 1]._id) : null };
}

module.exports = { createReview, getReviews };
