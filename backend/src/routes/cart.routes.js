const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/cart.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRoles('buyer'));
router.get('/', controller.get);
router.post('/items', validate(Joi.object({
  productId: Joi.string().hex().length(24).required(),
  variantId: Joi.string().hex().length(24),
  quantity: Joi.number().integer().min(1).max(100000000).required()
}).unknown(false)), controller.add);
router.patch('/items/:itemId', validate(Joi.object({
  itemId: Joi.string().hex().length(24).required()
}), 'params'), validate(Joi.object({
  quantity: Joi.number().integer().min(1).max(100000000).required()
}).unknown(false)), controller.update);
router.delete('/items/:itemId', validate(Joi.object({
  itemId: Joi.string().hex().length(24).required()
}), 'params'), controller.remove);

module.exports = router;
