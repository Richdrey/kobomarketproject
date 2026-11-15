const express = require('express');
const Joi = require('joi');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');
const controller = require('../controllers/exchange-rate.controller');

const router = express.Router();
router.use(authenticate);
router.get('/', requireRoles('admin'), controller.listRates);
router.patch('/', requireRoles('admin'), validate(Joi.object({
  baseCurrency: Joi.string().valid('NGN', 'USD').required(),
  quoteCurrency: Joi.string().valid('NGN', 'USD').invalid(Joi.ref('baseCurrency')).required(),
  rateScaled: Joi.string().pattern(/^[1-9]\d*$/).max(18).required(),
  rateScale: Joi.string().pattern(/^[1-9]\d*$/).max(18)
}).unknown(false)), controller.setRate);

module.exports = router;
