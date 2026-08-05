-- data-model.md: `policies`
-- annual_premium_cents and status only ever change via fn_apply_endorsement (007) — never a direct
-- UPDATE from application code (Principle VI).

CREATE TABLE policies (
  policy_id             VARCHAR PRIMARY KEY,
  homeowner_id          VARCHAR NOT NULL,
  status                VARCHAR NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  term_start            DATE NOT NULL,
  term_end              DATE NOT NULL CHECK (term_end > term_start),
  annual_premium_cents  BIGINT NOT NULL CHECK (annual_premium_cents >= 0),
  currency              CHAR(3) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
