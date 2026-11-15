const express = require('express');
const Joi = require('joi');
const controller = require('../controllers/notification.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.get('/', validate(Joi.object({
  cursor: Joi.string().hex().length(24),
  limit: Joi.number().integer().min(1).max(100).default(20)
}).unknown(false), 'query'), controller.list);
router.get('/unread-count', controller.unreadCount);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validate(Joi.object({
  id: Joi.string().hex().length(24).required()
}), 'params'), controller.markRead);

module.exports = router;
