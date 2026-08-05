-- data-model.md: `ledger_transactions`
-- 1:1 with policy_events: every accepted mutation produces exactly one ledger transaction.

CREATE TABLE ledger_transactions (
  id                BIGSERIAL PRIMARY KEY,
  policy_id         VARCHAR NOT NULL REFERENCES policies (policy_id),
  policy_event_id   BIGINT NOT NULL UNIQUE REFERENCES policy_events (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_transactions_policy_id_id ON ledger_transactions (policy_id, id);
