exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sub_orders ADD COLUMN completed_at TIMESTAMPTZ;
    CREATE INDEX sub_orders_completed_at_idx ON sub_orders(completed_at DESC) WHERE status = 'COMPLETED';
    CREATE INDEX sub_orders_shipped_at_idx ON sub_orders(shipped_at) WHERE status = 'SHIPPED';
    CREATE UNIQUE INDEX sub_orders_one_vendor_per_order_idx ON sub_orders(order_id, vendor_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS sub_orders_completed_at_idx;
    DROP INDEX IF EXISTS sub_orders_shipped_at_idx;
    DROP INDEX IF EXISTS sub_orders_one_vendor_per_order_idx;
    ALTER TABLE sub_orders DROP COLUMN IF EXISTS completed_at;
  `);
};
