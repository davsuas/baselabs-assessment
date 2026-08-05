-- data-model.md: `billing_documents`
--
-- Documented simplification: `status` does not track per-document payment allocation — the spec
-- only requires a policy-level open_balance_cents, not payment-to-invoice matching (Principle
-- VII/YAGNI). See data-model.md and the README's "what I'd improve with more time" section.

CREATE TABLE billing_documents (
  id                BIGSERIAL PRIMARY KEY,
  policy_id         VARCHAR NOT NULL REFERENCES policies (policy_id),
  policy_event_id   BIGINT NOT NULL REFERENCES policy_events (id),
  type              VARCHAR NOT NULL CHECK (type = 'endorsement_adjustment'),
  amount_cents      BIGINT NOT NULL,
  status            VARCHAR NOT NULL DEFAULT 'posted',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_documents_policy_id_id ON billing_documents (policy_id, id);
