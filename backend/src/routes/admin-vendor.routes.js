const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/vendor.controller');
const validate = require('../middleware/validate');
const { authenticate, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRoles('admin'));
router.get('/', controller.listPending);
router.patch('/:id/approve', controller.approve);
router.patch('/:id/reject', validate(Joi.object({
  reason: Joi.string().trim().min(1).max(1000).required()
}).unknown(false)), controller.reject);

module.exports = router;
