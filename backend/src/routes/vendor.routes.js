const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/vendor.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.post('/apply', authenticate, validate(Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  description: Joi.string().trim().min(1).max(2000).required(),
  bankDetails: Joi.object({
    bankCode: Joi.string().trim().min(2).max(20).required(),
    accountNumber: Joi.string().trim().pattern(/^\d{8,20}$/).required(),
    accountName: Joi.string().trim().min(2).max(120).required()
  }).required()
}).unknown(false)), controller.apply);
router.get('/:id', controller.getById);

module.exports = router;
