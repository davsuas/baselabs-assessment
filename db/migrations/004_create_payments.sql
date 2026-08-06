-- data-model.md: `payments`
-- Only ever inserted by fn_record_payment (007), only on acceptance (no row on rejection).

CREATE TABLE payments (
  id                     BIGSERIAL PRIMARY KEY,
  policy_id              VARCHAR NOT NULL REFERENCES policies (policy_id),
  policy_event_id        BIGINT NOT NULL REFERENCES policy_events (id),
  external_payment_id    VARCHAR NOT NULL,
  idempotency_key        VARCHAR NOT NULL,
  amount_cents           BIGINT NOT NULL CHECK (amount_cents > 0),
  currency               CHAR(3) NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_policy_id_id ON payments (policy_id, id);
