-- data-model.md: `policy_events` (append-only, hash-chained — Principle III)
--
-- UNIQUE (policy_id, operation_type, idempotency_key) is the database-level idempotency guarantee
-- (research.md, Idempotency Enforcement) that fn_apply_endorsement/fn_record_payment (007) rely on
-- to detect replays race-safely. UPDATE/DELETE are revoked from the application role in
-- 009_grants.sql — append-only is structurally guaranteed, not just agreed-upon convention.

CREATE TABLE policy_events (
  id                  BIGSERIAL PRIMARY KEY,
  policy_id           VARCHAR NOT NULL REFERENCES policies (policy_id),
  operation_type      VARCHAR NOT NULL CHECK (operation_type IN ('endorsement', 'payment')),
  event_type          VARCHAR NOT NULL,
  idempotency_key     VARCHAR NOT NULL,
  payload_canonical   TEXT NOT NULL,
  previous_hash       CHAR(64) NOT NULL,
  event_hash          CHAR(64) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_policy_events_idempotency UNIQUE (policy_id, operation_type, idempotency_key)
);

-- Supports fn_verify_policy_history's in-order chain walk and per-policy timeline reads.
CREATE INDEX idx_policy_events_policy_id_id ON policy_events (policy_id, id);
