const express = require('express');
const Joi = require('joi');
const authController = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const crypto = require('crypto');

const router = express.Router();
const emailSchema = Joi.string().trim().lowercase().email().max(254).required();
const passwordSchema = Joi.string().min(12).max(128).required();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator(req) {
    const email = String(req.body.email || '').trim().toLowerCase();
    const emailHash = crypto.createHash('sha256').update(email).digest('hex');
    return `${emailHash}:${ipKeyGenerator(req.ip)}`;
  },
  handler(req, res) {
    res.status(429).json({
      success: false,
      error: {
        code: 'LOGIN_RATE_LIMITED',
        message: 'Too many failed login attempts. Try again in 15 minutes.',
        details: null
      }
    });
  }
});

router.post('/register', validate(Joi.object({
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  email: emailSchema,
  password: passwordSchema
})), authController.register);

router.post('/verify-email', validate(Joi.object({
  token: Joi.string().min(32).max(512)
}).or('token').unknown(false)), authController.verifyEmail);
router.get('/verify-email', validate(Joi.object({
  token: Joi.string().min(32).max(512).required()
}).unknown(false), 'query'), authController.verifyEmail);

router.post('/resend-verification', validate(Joi.object({
  email: emailSchema
})), authController.resendVerification);

router.post('/login', validate(Joi.object({
  email: emailSchema,
  password: Joi.string().min(1).max(128).required()
})), loginLimiter, authController.login);

router.post('/refresh', validate(Joi.object({
  refreshToken: Joi.string().required()
})), authController.refresh);

router.post('/logout', validate(Joi.object({
  refreshToken: Joi.string().required()
})), authController.logout);

router.post('/forgot-password', validate(Joi.object({
  email: emailSchema
})), authController.forgotPassword);

router.post('/reset-password', validate(Joi.object({
  token: Joi.string().min(32).max(512).required(),
  newPassword: passwordSchema
})), authController.resetPassword);

module.exports = router;
