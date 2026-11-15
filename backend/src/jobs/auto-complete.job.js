const cron = require('node-cron');
const escrowService = require('../services/escrow.service');
const { logger } = require('../middleware/logger');

function startAutoCompleteJob() {
  return cron.schedule(process.env.AUTO_COMPLETE_CRON || '*/5 * * * *', async () => {
    try {
      const completed = await escrowService.autoCompleteDueSubOrders();
      if (completed) logger.info({ completed }, 'Auto-completed shipped sub-orders');
    } catch (error) {
      logger.error({ error }, 'Auto-complete job failed');
    }
  }, { noOverlap: true });
}

module.exports = { startAutoCompleteJob };
