-- T058 (US3): read-side views backing the three GET endpoints (contracts/rest-api.md endpoints
-- 3-5, data-model.md "Views & functions"). Every domain read in this project goes through a
-- hand-written view or table-returning function (constitution Principle VI) — application code
-- (packages/backend/src/db/repository.ts) only ever issues a single parameterized SELECT against
-- one of these, never an ad-hoc join/aggregation of the base tables.
--
-- Grants note: this file (008) runs *before* 009_grants.sql in migration order (numbering follows
-- tasks.md exactly) and, unlike functions, a view needs an explicit SELECT grant before any
-- non-owner role can query it — `app_user` doesn't even exist as a role yet at this point in the
-- migration sequence, so that grant can't live here. 009_grants.sql (which creates `app_user`)
-- explicitly `GRANT SELECT`s on these four views once the role exists; see that file. Functions
-- don't need the same treatment: PostgreSQL grants EXECUTE on newly created functions to PUBLIC by
-- default, which is exactly why fn_apply_endorsement/fn_record_payment (007, likewise created
-- before 009) already work for app_user with no explicit grant — fn_verify_policy_history (007) is
-- no different.

-- v_policy_summary: policy fields + open_balance_cents, computed from ledger_entries for the
-- premium_receivable account (data-model.md "money is single-sourced from the ledger" — there is no
-- stored balance column anywhere to drift out of sync). One row per existing policy_id, zero rows
-- for an unknown policy_id (the repository layer treats an empty result as 404). `term_start`/
-- `term_end` are cast to TEXT here (DATE::TEXT renders as "YYYY-MM-DD") so the contract's date
-- format comes straight from the view, rather than depending on the `pg` driver's default DATE ->
-- JS Date parsing (which would otherwise serialize with a spurious time-of-day component).
CREATE OR REPLACE VIEW v_policy_summary AS
SELECT
  p.policy_id,
  p.status,
  p.annual_premium_cents,
  p.currency,
  p.term_start::TEXT AS term_start,
  p.term_end::TEXT AS term_end,
  p.updated_at,
  COALESCE(ob.open_balance_cents, 0)::BIGINT AS open_balance_cents
FROM policies p
LEFT JOIN LATERAL (
  SELECT SUM(
           CASE WHEN le.direction = 'debit' THEN le.amount_cents ELSE -le.amount_cents END
         ) AS open_balance_cents
    FROM ledger_entries le
    JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
   WHERE lt.policy_id = p.policy_id
     AND le.account = 'premium_receivable'
) ob ON true;

-- v_policy_billing_documents: a policy's billing documents, newest first (data-model.md).
CREATE OR REPLACE VIEW v_policy_billing_documents AS
SELECT
  bd.policy_id,
  bd.id,
  bd.type,
  bd.amount_cents,
  bd.status,
  bd.created_at
FROM billing_documents bd
ORDER BY bd.created_at DESC, bd.id DESC;

-- v_policy_payments: a policy's payments, newest first (data-model.md). `status` is hardcoded
-- 'applied' — payments has no status column because a row only ever exists here after
-- fn_record_payment's validation succeeds (data-model.md: "only ever inserted ... only on
-- acceptance"), so every persisted payment is, by construction, in the applied state.
CREATE OR REPLACE VIEW v_policy_payments AS
SELECT
  p.policy_id,
  p.id,
  p.external_payment_id,
  p.amount_cents,
  p.currency,
  p.received_at,
  p.created_at,
  'applied'::VARCHAR AS status
FROM payments p
ORDER BY p.created_at DESC, p.id DESC;

-- v_ledger_summary: one row per ledger_transaction for a policy, with per-transaction debit/credit
-- totals and a row-level `balanced` flag (contracts/rest-api.md endpoint 4; the API layer's
-- policy-wide `balanced` is the AND of every row's flag). Built FROM policies (not
-- FROM ledger_transactions) with LEFT JOINs so a policy that exists but has no history yet still
-- produces exactly one row (with transaction_id NULL and debits/credits/balanced defaulting to
-- 0/0/true) instead of zero rows — this is what lets the repository layer distinguish "policy
-- exists, no transactions" from "policy does not exist" (zero rows) using a single query, without a
-- separate ad-hoc existence check (Principle VI).
CREATE OR REPLACE VIEW v_ledger_summary AS
SELECT
  p.policy_id,
  lt.id AS transaction_id,
  pe.idempotency_key AS source,
  COALESCE(SUM(CASE WHEN le.direction = 'debit' THEN le.amount_cents ELSE 0 END), 0)::BIGINT
    AS debits_cents,
  COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_cents ELSE 0 END), 0)::BIGINT
    AS credits_cents,
  COALESCE(SUM(CASE WHEN le.direction = 'debit' THEN le.amount_cents ELSE 0 END), 0)
    = COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_cents ELSE 0 END), 0)
    AS balanced
FROM policies p
LEFT JOIN ledger_transactions lt ON lt.policy_id = p.policy_id
LEFT JOIN policy_events pe ON pe.id = lt.policy_event_id
LEFT JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
GROUP BY p.policy_id, lt.id, pe.idempotency_key;
