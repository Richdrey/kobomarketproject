require('dotenv').config();
const cron = require('node-cron');
const connectDB = require('./src/configs/db');
const pool = require('./src/configs/postgres');
const app = require('./app');
const { logger } = require('./src/middleware/logger');
const { provisionPendingWallets } = require('./src/services/wallet.service')

async function start() {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required');
  }
  await connectDB();
  await pool.query('SELECT 1 FROM accounts LIMIT 0');
  await provisionPendingWallets();

  const port = Number(process.env.PORT || 3020);
  const server = app.listen(port, () => logger.info({ port }, 'KoboMarket API started'));

  cron.schedule('* * * * *', () => {
    provisionPendingWallets().catch((error) => {
      logger.error({ errorCode: error.code || 'WALLET_PROVISIONING_FAILED' }, 'Wallet provisioning worker failed');
    });
  });

  const shutdown = async () => {
    server.close(async () => {
      await pool.end();
      await require('mongoose').disconnect();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error) => {
  logger.fatal({ errorCode: error.code || 'STARTUP_FAILED' }, 'KoboMarket API startup failed');
  process.exitCode = 1;
});