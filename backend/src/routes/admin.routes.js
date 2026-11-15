const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRoles('admin'));
router.get('/users', validate(Joi.object({
  q: Joi.string().trim().max(254),
  status: Joi.string().valid('active', 'frozen'),
  limit: Joi.number().integer().min(1).max(100).default(50)
}).unknown(false), 'query'), controller.listUsers);
router.patch('/users/:id/freeze', validate(Joi.object({
  id: Joi.string().hex().length(24).required()
}), 'params'), validate(Joi.object({
  frozen: Joi.boolean().required()
}).unknown(false)), controller.freezeUser);
router.get('/wallets/:id/ledger', validate(Joi.object({
  id: Joi.string().pattern(/^[1-9]\d{0,18}$/).required()
}), 'params'), controller.getWalletLedger);
router.patch('/settings/commission', validate(Joi.object({
  rateBps: Joi.number().integer().min(0).max(10000).required()
}).unknown(false)), controller.setCommission);
router.get('/reports/revenue', validate(Joi.object({
  from: Joi.date().iso().required(),
  to: Joi.date().iso().min(Joi.ref('from')).required()
}).unknown(false), 'query'), controller.revenueReport);
router.get('/reports/top-vendors', controller.topVendorsReport);
router.get('/reports/escrow', controller.escrowReport);
router.get('/reports/reconciliation', controller.reconciliationReport);

module.exports = router;
