const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/product.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
const positiveIntegerString = Joi.string().pattern(/^[1-9]\d*$/).max(18);
const variantSchema = Joi.object({
  id: Joi.string().hex().length(24),
  label: Joi.string().trim().min(1).max(100).required(),
  stockQuantity: Joi.number().integer().min(0).max(100000000).required(),
  priceKobo: positiveIntegerString.required()
}).unknown(false);
const productSchema = Joi.object({
  name: Joi.string().trim().min(1).max(180),
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),
  description: Joi.string().trim().min(1).max(10000),
  category: Joi.string().trim().min(1).max(100),
  images: Joi.array().items(Joi.string().uri({ scheme: ['http', 'https'] })).max(12),
  stockQuantity: Joi.number().integer().min(0).max(100000000),
  variants: Joi.array().items(variantSchema).max(100),
  tags: Joi.array().items(Joi.string().trim().min(1).max(40)).max(30),
  isActive: Joi.boolean(),
  priceKobo: positiveIntegerString
}).unknown(false);
const createSchema = productSchema.keys({
  name: Joi.string().trim().min(1).max(180).required(),
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200).required(),
  description: Joi.string().trim().min(1).max(10000).required(),
  category: Joi.string().trim().min(1).max(100).required(),
  stockQuantity: Joi.number().integer().min(0).max(100000000).required()
}).custom((value, helpers) => {
  if (value.variants?.length) {
    if (value.variants.some((variant) => !variant.priceKobo)) return helpers.error('any.invalid');
  } else if (!value.priceKobo) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'product price source');

const querySchema = Joi.object({
  q: Joi.string().trim().max(200),
  category: Joi.string().trim().max(100),
  vendorId: Joi.string().hex().length(24),
  minRating: Joi.number().min(0).max(5),
  minPriceKobo: positiveIntegerString,
  maxPriceKobo: positiveIntegerString,
  sort: Joi.string().valid('price', 'newest', 'rating'),
  cursor: Joi.string().max(512),
  limit: Joi.number().integer().min(1).max(100)
}).unknown(false);

router.get('/', validate(querySchema, 'query'), controller.list);
router.get('/:id/reviews', validate(Joi.object({
  id: Joi.string().hex().length(24).required()
}), 'params'), validate(Joi.object({
  limit: Joi.number().integer().min(1).max(100),
  before: Joi.string().hex().length(24)
}).unknown(false), 'query'), controller.listReviews);
router.get('/:slug', validate(Joi.object({
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200).required()
}), 'params'), controller.getBySlug);
router.post('/', authenticate, requireRoles('vendor'), validate(createSchema), controller.create);
router.patch('/:id', authenticate, requireRoles('vendor'), validate(Joi.object({
  id: Joi.string().hex().length(24).required()
}), 'params'), validate(productSchema.min(1)), controller.update);
router.delete('/:id', authenticate, requireRoles('vendor'), validate(Joi.object({
  id: Joi.string().hex().length(24).required()
}), 'params'), controller.remove);
router.post('/:id/reviews', authenticate, requireRoles('buyer'), validate(Joi.object({
  id: Joi.string().hex().length(24).required()
}), 'params'), validate(Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().trim().max(2000).allow('')
}).unknown(false)), controller.createReview);

module.exports = router;
