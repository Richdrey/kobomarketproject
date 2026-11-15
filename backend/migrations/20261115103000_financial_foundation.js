exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE accounts (
      id BIGSERIAL PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'system', 'processor')),
      owner_id TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('wallet', 'system', 'processor')),
      currency CHAR(3) NOT NULL CHECK (currency IN ('NGN', 'USD')),
      balance_minor BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_type, owner_id, currency),
      CHECK (account_type <> 'wallet' OR balance_minor >= 0)
    );

    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed', 'reversed')),
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE ledger_entries (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES transactions(id),
      account_id BIGINT NOT NULL REFERENCES accounts(id),
      direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX ledger_entries_account_created_idx ON ledger_entries(account_id, created_at DESC);
    CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);

    CREATE FUNCTION enforce_balanced_posting() RETURNS TRIGGER AS $$
    DECLARE
      transaction_id_to_check BIGINT;
      entry_count BIGINT;
      debit_total NUMERIC;
      credit_total NUMERIC;
      transaction_status TEXT;
    BEGIN
      IF TG_TABLE_NAME = 'transactions' THEN
        transaction_id_to_check := NEW.id;
      ELSE
        transaction_id_to_check := NEW.transaction_id;
      END IF;
      SELECT status INTO transaction_status FROM transactions WHERE id = transaction_id_to_check;
      IF transaction_status <> 'posted' THEN
        RETURN NULL;
      END IF;

      SELECT COUNT(*),
             COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0),
             COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)
        INTO entry_count, debit_total, credit_total
        FROM ledger_entries
       WHERE transaction_id = transaction_id_to_check;

      IF entry_count < 2 OR debit_total <> credit_total THEN
        RAISE EXCEPTION 'Posted ledger transaction % is not balanced', transaction_id_to_check;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    CREATE CONSTRAINT TRIGGER balanced_ledger_entries
      AFTER INSERT ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_balanced_posting();

    CREATE CONSTRAINT TRIGGER balanced_posted_transaction
      AFTER INSERT OR UPDATE ON transactions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_balanced_posting();

    CREATE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Ledger entries are append-only; post a reversal instead';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER ledger_entries_are_immutable
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

    CREATE TABLE idempotency_keys (
      id BIGSERIAL PRIMARY KEY,
      owner_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash CHAR(64) NOT NULL,
      response JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_id, operation, key)
    );

    CREATE TABLE platform_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE exchange_rates (
      id BIGSERIAL PRIMARY KEY,
      base_currency CHAR(3) NOT NULL CHECK (base_currency IN ('NGN', 'USD')),
      quote_currency CHAR(3) NOT NULL CHECK (quote_currency IN ('NGN', 'USD')),
      rate_scaled BIGINT NOT NULL CHECK (rate_scaled > 0),
      rate_scale BIGINT NOT NULL DEFAULT 1000000 CHECK (rate_scale > 0),
      source TEXT NOT NULL DEFAULT 'admin',
      updated_by TEXT NOT NULL,
      effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (base_currency <> quote_currency)
    );

    CREATE INDEX exchange_rates_pair_effective_idx
      ON exchange_rates(base_currency, quote_currency, effective_at DESC);

    CREATE TABLE product_prices (
      id BIGSERIAL PRIMARY KEY,
      product_id TEXT NOT NULL,
      variant_id TEXT NOT NULL DEFAULT '',
      currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
      price_kobo BIGINT NOT NULL CHECK (price_kobo > 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (product_id, variant_id)
    );

    CREATE TABLE funding_intents (
      id BIGSERIAL PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      account_id BIGINT NOT NULL REFERENCES accounts(id),
      amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
      idempotency_key TEXT NOT NULL,
      provider_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, idempotency_key)
    );

    CREATE TABLE orders (
      id BIGSERIAL PRIMARY KEY,
      buyer_id TEXT NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
      status TEXT NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'COMPLETED')),
      idempotency_key TEXT NOT NULL,
      request_hash CHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (buyer_id, idempotency_key)
    );

    CREATE TABLE sub_orders (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id),
      vendor_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'CANCELLED')),
      shipped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE FUNCTION enforce_sub_order_transition() RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status = NEW.status THEN
        RETURN NEW;
      END IF;
      IF NOT (
        (OLD.status = 'PAID' AND NEW.status IN ('SHIPPED', 'CANCELLED')) OR
        (OLD.status = 'SHIPPED' AND NEW.status IN ('DELIVERED', 'COMPLETED', 'DISPUTED')) OR
        (OLD.status = 'DELIVERED' AND NEW.status IN ('COMPLETED', 'DISPUTED')) OR
        (OLD.status = 'DISPUTED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
      ) THEN
        RAISE EXCEPTION 'Invalid sub-order transition: % -> %', OLD.status, NEW.status;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER sub_order_state_machine
      BEFORE UPDATE OF status ON sub_orders
      FOR EACH ROW EXECUTE FUNCTION enforce_sub_order_transition();

    CREATE TABLE order_items (
      id BIGSERIAL PRIMARY KEY,
      sub_order_id BIGINT NOT NULL REFERENCES sub_orders(id),
      product_id TEXT NOT NULL,
      variant_id TEXT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_kobo BIGINT NOT NULL CHECK (unit_price_kobo > 0),
      commission_rate_bps INTEGER NOT NULL CHECK (commission_rate_bps BETWEEN 0 AND 10000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE payouts (
      id BIGSERIAL PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      account_id BIGINT NOT NULL REFERENCES accounts(id),
      amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 100000),
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
      idempotency_key TEXT NOT NULL,
      provider_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (vendor_id, idempotency_key)
    );

    CREATE UNIQUE INDEX payouts_one_pending_per_vendor
      ON payouts(vendor_id) WHERE status = 'PENDING';

    INSERT INTO platform_settings(setting_key, setting_value, updated_by)
    VALUES ('commission_rate_bps', '500'::jsonb, 'system')
    ON CONFLICT (setting_key) DO NOTHING;

    CREATE TABLE disputes (
      id BIGSERIAL PRIMARY KEY,
      sub_order_id BIGINT NOT NULL UNIQUE REFERENCES sub_orders(id),
      buyer_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
      reason TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      resolution TEXT CHECK (resolution IN ('FULL_REFUND', 'PARTIAL_REFUND', 'REJECT')),
      resolution_note TEXT,
      resolved_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );

    INSERT INTO accounts(owner_type, owner_id, account_type, currency)
    VALUES
      ('system', 'PLATFORM_ESCROW', 'system', 'NGN'),
      ('system', 'PLATFORM_REVENUE', 'system', 'NGN'),
      ('system', 'PLATFORM_PAYOUT_CLEARING', 'system', 'NGN'),
      ('processor', 'PLATFORM_FUNDING_CLEARING', 'processor', 'NGN'),
      ('processor', 'PLATFORM_PAYOUT_SETTLED', 'processor', 'NGN')
    ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS disputes, payouts, order_items, sub_orders, orders, funding_intents, product_prices, exchange_rates,
      platform_settings, idempotency_keys, ledger_entries, transactions, accounts CASCADE;
    DROP FUNCTION IF EXISTS enforce_sub_order_transition();
    DROP FUNCTION IF EXISTS prevent_ledger_mutation();
    DROP FUNCTION IF EXISTS enforce_balanced_posting();
  `);
};
