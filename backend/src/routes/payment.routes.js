const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/payment.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.post('/fund', authenticate, validate(Joi.object({
  amountKobo: Joi.string().pattern(/^[1-9]\d{0,17}$/).required()
}).unknown(false)), controller.fundWallet);

module.exports = router;
