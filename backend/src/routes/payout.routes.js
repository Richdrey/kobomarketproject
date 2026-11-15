const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/payout.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRoles('vendor'));
router.post('/', validate(Joi.object({
  amountKobo: Joi.string().pattern(/^[1-9]\d{0,17}$/).required()
}).unknown(false)), controller.request);
router.get('/', validate(Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50)
}).unknown(false), 'query'), controller.list);

module.exports = router;
