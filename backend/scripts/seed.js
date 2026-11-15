require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const pool = require('../src/configs/postgres');
const connectDB = require('../src/configs/db');
const User = require('../src/models/user.models');
const Store = require('../src/models/store.models');
const Product = require('../src/models/product.models');
const { encryptBankDetails } = require('../src/utils/bank-details');

const SEED_PASSWORD = process.env.SEED_PASSWORD;
const FUNDED_BALANCE_KOBO = '5000000';

async function findOrCreateUser({ email, firstName, lastName, roles, passwordHash }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      firstName,
      lastName,
      password: passwordHash,
      roles,
      isVerified: true,
      walletProvisioningStatus: 'pending'
    });
  }
  return user;
}

async function fundBuyerWallet(user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const key = `development-seed:${user._id}:NGN`;
    const existing = await client.query('SELECT id FROM transactions WHERE idempotency_key = $1', [key]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      return;
    }

    const wallet = await client.query(
      `SELECT id, balance_minor FROM accounts
        WHERE owner_type = 'user' AND owner_id = $1 AND currency = 'NGN'
        FOR UPDATE`,
      [String(user._id)]
    );
    const funding = await client.query(
      `SELECT id, balance_minor FROM accounts
        WHERE owner_type = 'processor' AND owner_id = 'PLATFORM_FUNDING_CLEARING' AND currency = 'NGN'
        FOR UPDATE`
    );
    if (!wallet.rowCount || !funding.rowCount) {
      throw new Error('Required wallet or funding account is missing; run migrations first');
    }

    const transaction = await client.query(
      `INSERT INTO transactions (reference, type, status, idempotency_key, metadata)
       VALUES ($1, 'seed_funding', 'pending', $2, $3::jsonb)
       RETURNING id`,
      [`seed-${user._id}`, key, JSON.stringify({ amountMinor: FUNDED_BALANCE_KOBO, currency: 'NGN' })]
    );
    const transactionId = transaction.rows[0].id;
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_minor)
       VALUES ($1, $2, 'debit', $3), ($1, $4, 'credit', $3)`,
      [transactionId, funding.rows[0].id, FUNDED_BALANCE_KOBO, wallet.rows[0].id]
    );
    await client.query(
      'UPDATE accounts SET balance_minor = balance_minor + $1 WHERE id = $2',
      [FUNDED_BALANCE_KOBO, wallet.rows[0].id]
    );
    await client.query(
      'UPDATE accounts SET balance_minor = balance_minor + $1 WHERE id = $2',
      [FUNDED_BALANCE_KOBO, funding.rows[0].id]
    );
    await client.query("UPDATE transactions SET status = 'posted' WHERE id = $1", [transactionId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed data cannot be created in production');
  }
  if (!SEED_PASSWORD || SEED_PASSWORD.length < 12) {
    throw new Error('SEED_PASSWORD of at least 12 characters is required');
  }

  await connectDB();
  await pool.query('SELECT 1 FROM accounts LIMIT 0');
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const admin = await findOrCreateUser({
    email: 'admin@kobomarket.local',
    firstName: 'KoboMarket',
    lastName: 'Admin',
    roles: ['admin'],
    passwordHash
  });
  const vendors = [];
  for (let index = 1; index <= 3; index += 1) {
    vendors.push(await findOrCreateUser({
      email: `vendor${index}@kobomarket.local`,
      firstName: 'Vendor',
      lastName: String(index),
      roles: ['buyer', 'vendor'],
      passwordHash
    }));
  }

  for (const vendor of vendors) {
    await Store.updateOne(
      { vendorId: vendor._id },
      {
        $setOnInsert: {
          vendorId: vendor._id,
          name: `Development Store ${vendor.firstName} ${vendor.lastName}`,
          description: 'Development-only seed storefront.',
          bankDetailsEncrypted: encryptBankDetails({
            bankCode: '000',
            accountNumber: '0000000000',
            accountName: 'Test Account'
          }),
          status: 'approved'
        }
      },
      { upsert: true }
    );
  }

  const buyers = [];
  for (let index = 1; index <= 5; index += 1) {
    buyers.push(await findOrCreateUser({
      email: `buyer${index}@kobomarket.local`,
      firstName: 'Buyer',
      lastName: String(index),
      roles: ['buyer'],
      passwordHash
    }));
  }

  const allUsers = [admin, ...vendors, ...buyers];
  for (const user of allUsers) {
    await pool.query(
      `INSERT INTO accounts (owner_type, owner_id, account_type, currency)
       VALUES ('user', $1, 'wallet', 'NGN'), ('user', $1, 'wallet', 'USD')
       ON CONFLICT (owner_type, owner_id, currency) DO NOTHING`,
      [String(user._id)]
    );
    await User.updateOne({ _id: user._id }, { $set: { walletProvisioningStatus: 'provisioned' } });
  }
  for (const buyer of buyers) {
    await fundBuyerWallet(buyer);
  }

  for (let index = 1; index <= 20; index += 1) {
    const vendor = vendors[(index - 1) % vendors.length];
    const slug = `development-product-${index}`;
    const product = await Product.findOneAndUpdate(
      { slug },
      {
        $setOnInsert: {
          vendorId: vendor._id,
          name: `Development Product ${index}`,
          slug,
          description: 'Development-only seeded catalogue item.',
          category: index % 2 ? 'general' : 'home',
          images: [],
          stockQuantity: 25,
          variants: [],
          tags: ['development'],
          isActive: true
        }
      },
      { upsert: true, new: true }
    );
    await pool.query(
      `INSERT INTO product_prices (product_id, variant_id, currency, price_kobo)
       VALUES ($1, '', 'NGN', $2)
       ON CONFLICT (product_id, variant_id)
       DO UPDATE SET price_kobo = EXCLUDED.price_kobo, updated_at = NOW()`,
      [String(product._id), String(100000 + index * 10000)]
    );
  }

  console.log('Development seed completed.');
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ errorCode: error.code || 'SEED_FAILED', message: error.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await mongoose.disconnect();
  });
