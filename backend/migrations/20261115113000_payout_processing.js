exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payouts DROP CONSTRAINT payouts_status_check;
    ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
      CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'));
    DROP INDEX payouts_one_pending_per_vendor;
    CREATE UNIQUE INDEX payouts_one_pending_per_vendor
      ON payouts(vendor_id) WHERE status IN ('PENDING', 'PROCESSING');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE payouts SET status = 'PENDING' WHERE status = 'PROCESSING';
    DROP INDEX payouts_one_pending_per_vendor;
    ALTER TABLE payouts DROP CONSTRAINT payouts_status_check;
    ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
      CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED'));
    CREATE UNIQUE INDEX payouts_one_pending_per_vendor
      ON payouts(vendor_id) WHERE status = 'PENDING';
  `);
};
