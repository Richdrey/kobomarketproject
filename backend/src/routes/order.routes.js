const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/order.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.post('/orders/checkout', requireRoles('buyer'), validate(Joi.object().default({}).unknown(false)), controller.checkout);
router.get('/orders', requireRoles('buyer'), controller.list);
router.get('/orders/:id', requireRoles('buyer'), validate(Joi.object({ id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required() }), 'params'), controller.getById);
router.post('/orders/:id/cancel', requireRoles('buyer'), validate(Joi.object({ id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required() }), 'params'), controller.cancel);
router.patch('/sub-orders/:id/ship', requireRoles('vendor'), validate(Joi.object({ id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required() }), 'params'), controller.ship);
router.patch('/sub-orders/:id/confirm', requireRoles('buyer'), validate(Joi.object({ id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required() }), 'params'), controller.confirmDelivery);

module.exports = router;
