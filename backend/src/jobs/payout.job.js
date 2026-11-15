const cron = require('node-cron');
const payoutService = require('../services/payout.service');
const { logger } = require('../middleware/logger');

function startPayoutJob() {
  return cron.schedule(process.env.PAYOUT_CRON || '* * * * *', async () => {
    try {
      const processed = await payoutService.processPendingPayouts();
      if (processed) logger.info({ processed }, 'Processed vendor payouts');
    } catch (error) {
      logger.error({ error }, 'Payout job failed');
    }
  }, { noOverlap: true });
}

module.exports = { startPayoutJob };
