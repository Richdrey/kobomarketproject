# KoboMarket backend

KoboMarket is a backend-only multi-vendor marketplace API built with Node.js, Express, MongoDB, and PostgreSQL.

## Database ownership

MongoDB stores user identity/profile documents, vendor stores, catalogue descriptions and stock metadata, carts, reviews, and notifications. Those records change shape often and are commonly read as documents.

PostgreSQL owns every monetary source of truth: product prices, wallets, journal entries, orders, escrow, payments, payouts, disputes, refunds, and exchange-rate records. SQL transactions, constraints, and row locks protect concurrent money movements. Product prices are deliberately kept in PostgreSQL even though product descriptions are in MongoDB.

Amounts are exact integers in currency minor units: NGN uses kobo and USD uses cents. NGN is the only currency used for marketplace product prices, orders, escrow, checkout, and payouts in this release. USD wallet accounts are separate and hold-only; this release stores admin-managed NGN/USD rate snapshots but does not exchange balances. No monetary calculation uses floating point.

## Cross-database consistency

MongoDB and PostgreSQL cannot commit one shared transaction. That means a user write can succeed while wallet provisioning fails, or an order/escrow transaction can succeed while a MongoDB stock reservation fails.

For account provisioning, the user record has a durable `walletProvisioningStatus`. The service creates NGN and USD wallet accounts idempotently in PostgreSQL, then marks provisioning complete in MongoDB. A periodic worker retries pending records. This leaves a recoverable state in the database that owns the user, instead of silently treating a missing wallet as a successful signup.

For checkout, the API commits the PostgreSQL order and escrow movement, then reserves MongoDB stock with conditional atomic decrements. If a reservation fails, it restores any stock already reserved and attempts a separate PostgreSQL transaction that appends reversing ledger entries and cancels the order. This is a compensating-action workflow rather than a distributed transaction or a transactional outbox. If the compensation transaction itself cannot run, checkout returns an explicit reconciliation error; operators should inspect the order and ledger before retrying.

## Local setup

1. Copy `backend/.env.example` to `backend/.env`; set unique local JWT secrets (at least 32 characters), a 64-character hexadecimal bank-encryption key, and a local PostgreSQL password. Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. From the repository root, start the services with `docker compose --env-file backend/.env up --build`.
3. The API applies PostgreSQL migrations before it starts at `http://localhost:3020`. Health is reported at `/health`.
4. OpenAPI/Swagger is served at `/api-docs`; Mailpit's local inbox is at `http://localhost:8025`.
5. To create development seed data, set `SEED_PASSWORD` in the local environment, then run `docker compose exec api npm run seed`. Seed users are local-only; do not use seed credentials in production.
6. To enable the scheduled 72-hour escrow completion and payout workers, keep `START_BACKGROUND_JOBS=true` (Docker Compose does this). Configure `ESCROW_TIMEOUT_HOURS`, `PAYOUT_MINIMUM_KOBO`, and Paystack test credentials as needed. Without Paystack credentials, development uses the mock provider.
7. Run backend tests with `docker compose exec api npm test` and the ledger audit with `docker compose exec api npm run audit:ledger`.

Never commit `.env` files or production credentials. Live payment/payout processing is not enabled by this local Paystack-test/mock setup.

## API architecture

The backend is organized around routes, controllers, services, and repositories. Controllers translate HTTP requests and responses; services own business transitions and cross-database workflows; repositories own persistence. Request validation uses Joi, errors use `{ success: false, error: { code, message, details } }`, and request logs use structured JSON with request IDs and sensitive fields redacted.

The API surface is under `/api/v1`; consult `/api-docs` for the live route list. The code includes authentication, catalogue/cart, wallet funding, checkout and escrow transitions, dispute resolution, vendor payouts, notifications, and admin reports. Run the tests and `npm run audit:ledger` against a migrated PostgreSQL instance before relying on database-backed flows. USD wallets and stored exchange rates are present, but marketplace checkout, escrow, and payouts remain NGN-only; no conversion is performed.

## Ledger rules

Posted transactions must have at least two positive entries and equal debits and credits. Ledger rows are append-only; corrections are reversal entries. User-wallet cached balances must equal their ledger-derived balances and must not go negative. `npm run audit:ledger` reports `PASS` only when account caches and the NGN funding-minus-payout conservation equation reconcile; it exits nonzero and prints mismatches on failure.
