-- data-model.md: `ledger_entries` + the deferred balance constraint trigger.

CREATE TABLE ledger_entries (
  id                       BIGSERIAL PRIMARY KEY,
  ledger_transaction_id    BIGINT NOT NULL REFERENCES ledger_transactions (id),
  account                  VARCHAR NOT NULL
                              CHECK (account IN ('premium_receivable', 'written_premium', 'cash')),
  direction                VARCHAR NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_cents             BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_entries_transaction_id ON ledger_entries (ledger_transaction_id);

-- Defense-in-depth balance check (data-model.md): the writing functions (007) already only ever
-- insert two balanced rows per ledger transaction, so this should never fire in practice — its
-- purpose is to make an *impossible* accounting state structurally enforced by the database, not
-- just promised by function code.
CREATE OR REPLACE FUNCTION fn_check_ledger_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
  v_debits  BIGINT;
  v_credits BIGINT;
BEGIN
  SELECT
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'credit'), 0)
    INTO v_debits, v_credits
    FROM ledger_entries
   WHERE ledger_transaction_id = NEW.ledger_transaction_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'ledger_transaction % is not balanced: debits=% credits=%',
      NEW.ledger_transaction_id, v_debits, v_credits;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_ledger_transaction_balanced();
