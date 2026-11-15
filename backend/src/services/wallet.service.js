const User = require('../models/user.models');
const pool = require('../configs/postgres');
const { logger } = require('../middleware/logger');

const WALLET_CURRENCIES = ['NGN', 'USD'];

async function createWalletAccounts(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const currency of WALLET_CURRENCIES) {
      await client.query(
        `INSERT INTO accounts (owner_type, owner_id, account_type, currency)
         VALUES ('user', $1, 'wallet', $2)
         ON CONFLICT (owner_type, owner_id, currency) DO NOTHING`,
        [String(userId), currency]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function provisionUserWallets(userId) {
  await createWalletAccounts(userId);
  await User.updateOne(
    { _id: userId },
    { $set: { walletProvisioningStatus: 'provisioned' } }
  );
}

async function provisionPendingWallets() {
  const pendingUsers = await User.find({ walletProvisioningStatus: 'pending' })
    .select('_id')
    .limit(100);

  for (const user of pendingUsers) {
    try {
      await provisionUserWallets(user._id);
    } catch (error) {
      logger.error({ errorCode: error.code || 'WALLET_PROVISIONING_FAILED', userId: String(user._id) }, 'Wallet provisioning retry failed');
    }
  }
}

module.exports = { provisionUserWallets, provisionPendingWallets };
