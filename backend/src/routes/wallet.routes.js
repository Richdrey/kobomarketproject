const express = require('express');
const Joi = require('joi');
const walletController = require('../controllers/wallet.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.get('/', walletController.getWallet);
router.get('/transactions', validate(Joi.object({
  limit: Joi.number().integer().min(1).max(100),
  before: Joi.string().pattern(/^\d+$/)
}).unknown(false), 'query'), walletController.getTransactions);

module.exports = router;
