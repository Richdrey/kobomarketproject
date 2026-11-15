require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const mongoose = require('mongoose');
const pool = require('./src/configs/postgres');
const { requestLogger, logger } = require('./src/middleware/logger');
const { AppError, notFoundHandler, errorHandler } = require('./src/middleware/errorHandler');
const asyncHandler = require('./src/middleware/asyncHandler');
const authRoutes = require('./src/routes/auth.routes');
const walletRoutes = require('./src/routes/wallet.routes');
const exchangeRateRoutes = require('./src/routes/exchange-rate.routes');
const vendorRoutes = require('./src/routes/vendor.routes');
const productRoutes = require('./src/routes/product.routes');
const adminVendorRoutes = require('./src/routes/admin-vendor.routes');
const cartRoutes = require('./src/routes/cart.routes');
const paymentRoutes = require('./src/routes/payment.routes');
const paymentController = require('./src/controllers/payment.controller');
const orderRoutes = require('./src/routes/order.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const disputeRoutes = require('./src/routes/dispute.routes');
const payoutRoutes = require('./src/routes/payout.routes');
const adminRoutes = require('./src/routes/admin.routes');
const userController = require('./src/controllers/user.controllers-v2');
const { authenticate } = require('./src/middleware/auth');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(requestLogger);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({
  limit: '1mb',
  verify(req, res, buffer) {
    if (req.originalUrl.startsWith('/api/v1/webhooks/paystack')) req.rawBody = Buffer.from(buffer);
  }
}));

app.get('/health', asyncHandler(async (req, res) => {
  const checks = {
    mongo: mongoose.connection.readyState === 1,
    postgres: false
  };
  await pool.query('SELECT 1');
  checks.postgres = true;
  const healthy = checks.mongo && checks.postgres;
  res.status(healthy ? 200 : 503).json({ success: healthy, data: { checks } });
}));

app.get('/api/v1/users/me', authenticate, userController.getMe);
app.patch('/api/v1/users/me', authenticate, userController.validateProfileUpdate, userController.updateMe);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/wallet', paymentRoutes);
app.post('/api/v1/webhooks/paystack', paymentController.paystackWebhook);
app.post('/api/v1/mock-payments/:reference/succeed', paymentController.mockPaymentSucceeded);
app.use('/api/v1/admin/settings/exchange-rates', exchangeRateRoutes);
app.use('/api/v1/vendors', vendorRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/admin/vendors', adminVendorRoutes);
app.use('/api/v1', orderRoutes);
app.use('/api/v1', disputeRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/payouts', payoutRoutes);
app.use('/api/v1/admin', adminRoutes);

if (process.env.START_BACKGROUND_JOBS === 'true') {
  require('./src/jobs/auto-complete.job').startAutoCompleteJob();
  require('./src/jobs/payout.job').startPayoutJob();
}

const openApiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'KoboMarket API',
      version: '1.0.0',
      description: 'Backend API for the KoboMarket multi-vendor marketplace.'
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    }
  },
  apis: ['./src/routes/*.js']
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
