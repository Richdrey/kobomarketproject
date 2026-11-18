exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION enforce_order_transition() RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.status = NEW.status THEN
        RETURN NEW;
      END IF;
      IF NOT (
        (OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('PAID', 'CANCELLED')) OR
        (OLD.status = 'PAID' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
      ) THEN
        RAISE EXCEPTION 'Invalid order transition: % -> %', OLD.status, NEW.status;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER order_state_machine
      BEFORE UPDATE OF status ON orders
      FOR EACH ROW EXECUTE FUNCTION enforce_order_transition();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS order_state_machine ON orders;
    DROP FUNCTION IF EXISTS enforce_order_transition();
  `);
};
