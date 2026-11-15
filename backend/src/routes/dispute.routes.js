const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/dispute.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.post('/sub-orders/:id/disputes', requireRoles('buyer'), validate(Joi.object({
  id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required()
}), 'params'), validate(Joi.object({
  reason: Joi.string().trim().min(5).max(4000).required(),
  evidence: Joi.array().items(Joi.string().uri({ scheme: ['http', 'https'] }).max(2048)).max(20).default([])
}).unknown(false)), controller.open);
router.get('/disputes', requireRoles('admin'), validate(Joi.object({
  status: Joi.string().valid('OPEN', 'RESOLVED'),
  limit: Joi.number().integer().min(1).max(100).default(50)
}).unknown(false), 'query'), controller.list);
router.patch('/disputes/:id/resolve', requireRoles('admin'), validate(Joi.object({
  id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required()
}), 'params'), validate(Joi.object({
  resolution: Joi.string().valid('FULL_REFUND', 'PARTIAL_REFUND', 'REJECT').required(),
  note: Joi.string().trim().min(2).max(4000).required(),
  refundKobo: Joi.string().pattern(/^(0|[1-9]\d{0,17})$/).when('resolution', {
    is: 'PARTIAL_REFUND',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  })
}).unknown(false)), controller.resolve);

module.exports = router;
