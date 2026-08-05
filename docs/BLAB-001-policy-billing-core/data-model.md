# Phase 1 Data Model: Policy Billing & Ledger Core

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Per research.md's data-access decision, every domain write below is performed by a single PostgreSQL
function (one implicit transaction = atomicity for free); every domain read is a view or table-returning
function. Application code never writes ad-hoc `INSERT`/`UPDATE`/multi-statement `SELECT` against these
tables directly. All monetary columns are `BIGINT` cents — never `numeric`/`float`/`real`.

## Design note: money is single-sourced from the ledger

`open_balance_cents` is **not** a stored column anywhere. It is always computed from
`ledger_entries` for the `premium_receivable` account (debits increase what's owed, credits decrease
it). This makes the ledger the one source of truth for balance — there is no separate balance field that
could drift out of sync with it, which directly serves Principle II (financial integrity) by removing an
entire class of "balance disagrees with ledger" bugs.

## Tables

### `policies`

| Column | Type | Constraints |
|---|---|---|
| `policy_id` | `VARCHAR` | PK (business ID, e.g. `POL-1001` — matches assessment sample data) |
| `homeowner_id` | `VARCHAR` | NOT NULL |
| `status` | `VARCHAR` | NOT NULL, `CHECK (status IN ('active','cancelled','expired'))` |
| `term_start` | `DATE` | NOT NULL |
| `term_end` | `DATE` | NOT NULL, `CHECK (term_end > term_start)` |
| `annual_premium_cents` | `BIGINT` | NOT NULL, `CHECK (annual_premium_cents >= 0)` |
| `currency` | `CHAR(3)` | NOT NULL (ISO 4217) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` (set by `fn_apply_endorsement` on premium change) |

`annual_premium_cents` and `status` only ever change via `fn_apply_endorsement` — never a direct
`UPDATE` from application code (Principle VI).

### `policy_events` (append-only, hash-chained — Principle III)

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGSERIAL` | PK |
| `policy_id` | `VARCHAR` | NOT NULL, FK → `policies` |
| `operation_type` | `VARCHAR` | NOT NULL, `CHECK (operation_type IN ('endorsement','payment'))` |
| `event_type` | `VARCHAR` | NOT NULL (e.g. `endorsement.applied`, `payment.applied`) |
| `idempotency_key` | `VARCHAR` | NOT NULL |
| `payload_canonical` | `TEXT` | NOT NULL — the exact fixed-order field concatenation that was hashed |
| `previous_hash` | `CHAR(64)` | NOT NULL (a fixed genesis constant for a policy's first event) |
| `event_hash` | `CHAR(64)` | NOT NULL — `sha256(payload_canonical \|\| previous_hash)`, computed in-function |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` |

- `UNIQUE (policy_id, operation_type, idempotency_key)` — the database-level idempotency guarantee
  (research.md, Idempotency Enforcement). This is the constraint `fn_apply_endorsement` and
  `fn_record_payment` rely on to detect replays race-safely.
- No `UPDATE`/`DELETE` privilege on this table for the application's database role — enforced at the
  role/grant level, not just by convention, so append-only is structurally guaranteed, not just
  agreed-upon.
- Only successful mutations produce a row here. A rejected request (wrong currency, conflicting
  idempotency payload, invalid dates, inactive policy) never reaches an `INSERT` — "no side effects on
  failure" (FR-002, FR-006, FR-008) is satisfied by construction, not by a compensating rollback.

### `billing_documents`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGSERIAL` | PK |
| `policy_id` | `VARCHAR` | NOT NULL, FK → `policies` |
| `policy_event_id` | `BIGINT` | NOT NULL, FK → `policy_events` (the endorsement event that produced it) |
| `type` | `VARCHAR` | NOT NULL, `CHECK (type = 'endorsement_adjustment')` (only type in this slice) |
| `amount_cents` | `BIGINT` | NOT NULL — signed; a premium decrease produces a negative adjustment |
| `status` | `VARCHAR` | NOT NULL DEFAULT `'posted'` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` |

**Documented simplification**: `status` does not track per-document payment allocation (e.g. becoming
`'paid'` once a specific matching payment arrives) — the spec only requires a policy-level
`open_balance_cents`, not payment-to-invoice matching, and building FIFO/allocation logic would be scope
beyond the six required endpoints (Principle VII/YAGNI). This is called out here so it's not mistaken for
an oversight; flag it in the README's "what I'd improve with more time" per the constitution's Development
Workflow rule.

### `payments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGSERIAL` | PK |
| `policy_id` | `VARCHAR` | NOT NULL, FK → `policies` |
| `policy_event_id` | `BIGINT` | NOT NULL, FK → `policy_events` |
| `external_payment_id` | `VARCHAR` | NOT NULL |
| `idempotency_key` | `VARCHAR` | NOT NULL |
| `amount_cents` | `BIGINT` | NOT NULL, `CHECK (amount_cents > 0)` |
| `currency` | `CHAR(3)` | NOT NULL |
| `received_at` | `TIMESTAMPTZ` | NOT NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` |

Only ever inserted by `fn_record_payment`, only on acceptance (same "no row on rejection" rule as
`policy_events`).

### `ledger_transactions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGSERIAL` | PK |
| `policy_id` | `VARCHAR` | NOT NULL, FK → `policies` |
| `policy_event_id` | `BIGINT` | NOT NULL, UNIQUE, FK → `policy_events` (1:1 — every accepted mutation produces exactly one transaction) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` |

### `ledger_entries`

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGSERIAL` | PK |
| `ledger_transaction_id` | `BIGINT` | NOT NULL, FK → `ledger_transactions` |
| `account` | `VARCHAR` | NOT NULL, `CHECK (account IN ('premium_receivable','written_premium','cash'))` |
| `direction` | `VARCHAR` | NOT NULL, `CHECK (direction IN ('debit','credit'))` |
| `amount_cents` | `BIGINT` | NOT NULL, `CHECK (amount_cents > 0)` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT `now()` |

**Defense-in-depth balance check**: a deferred `CONSTRAINT TRIGGER` (`trg_ledger_entries_balanced`) fires
at transaction commit and raises if a `ledger_transaction_id`'s entries don't have equal debit and credit
totals. The writing functions already only ever insert two balanced rows per transaction, so this trigger
should never fire in practice — its purpose is to make an *impossible* accounting state structurally
enforced at the database level, not just promised by function code, which is exactly the kind of
belt-and-suspenders correctness this domain calls for.

## Business rules → schema mapping

| Rule (spec.md / business-rules.txt) | Enforced by |
|---|---|
| `delta_cents = round_half_away_from_0((new-old) * remaining_days / term_days)` | Integer arithmetic inside `fn_apply_endorsement`, `remaining_days`/`term_days` from `policies.term_start/term_end` and the request's `effective_date` |
| Positive delta → DR Premium Receivable / CR Written Premium | `fn_apply_endorsement`'s two `ledger_entries` inserts (sign-aware: a negative delta reverses debit/credit) |
| Payment received → DR Cash / CR Premium Receivable | `fn_record_payment`'s two `ledger_entries` inserts |
| Same key + same payload → original result, no new effects | `UNIQUE (policy_id, operation_type, idempotency_key)` + payload-hash comparison in-function |
| Same key + different payload → clear failure | Same unique check, payload mismatch branch raises a custom exception |
| Wrong-currency payment → atomic rejection | `fn_record_payment` validates `currency = policies.currency` before any insert; on mismatch, raises before touching any table |
| Append-only history | No `UPDATE`/`DELETE` grants on `policy_events`/`ledger_entries`/`ledger_transactions` for the app role |
| Hash chain | `previous_hash`/`event_hash` columns + `fn_verify_policy_history` recomputation (research.md) |

## Views & functions (the API surface application code calls)

| Name | Kind | Purpose | Backs |
|---|---|---|---|
| `fn_apply_endorsement(policy_id, idempotency_key, effective_date, new_annual_premium_cents, reason)` | function (write) | Validates, prorates, writes event + billing document + ledger transaction, updates policy premium | `POST .../endorsements` |
| `fn_record_payment(policy_id, idempotency_key, external_payment_id, amount_cents, currency, received_at)` | function (write) | Validates currency/amount, writes event + payment + ledger transaction | `POST .../payments` |
| `v_policy_summary` | view | Policy fields + `open_balance_cents` (computed from `ledger_entries`) | `GET /policies/:id` |
| `v_policy_billing_documents` / `v_policy_payments` | views | Billing documents / payments for a policy, newest first | `GET /policies/:id` |
| `v_ledger_summary` | view | Per-transaction debit/credit totals + a `balanced` flag per transaction | `GET /policies/:id/ledger` |
| `fn_verify_policy_history(policy_id)` | function (read) | Recomputes the hash chain in event order, returns `(valid, event_count, first_broken_event_id)` | `GET /policies/:id/history/verify` |

## Validation rules (from Functional Requirements)

- `effective_date` MUST satisfy `term_start <= effective_date <= term_end` (FR-002) — checked in
  `fn_apply_endorsement` before any write.
- `policies.status` MUST be `'active'` for an endorsement to be accepted (FR-002).
- `payments.currency` MUST equal `policies.currency` (FR-008).
- `payments.amount_cents` MUST be `> 0` (FR-008, edge case).
- All of the above validation happens **inside the SQL function**, not only at the Express/zod boundary
  — zod validates shape/type (is this a well-formed request), the SQL function validates business
  invariants against current database state (is this policy active, does this currency match), which is
  the only place that state can be checked without a race between the boundary check and the write.

## State transitions

- `policies.status`: fixed at seed time for this slice (`active` in the sample data); no endpoint in
  this feature transitions a policy to `cancelled`/`expired` — those values exist in the `CHECK`
  constraint for schema completeness and to make the "endorsement on an inactive policy is rejected"
  rule (FR-002, Acceptance Scenario 4) testable by seeding a non-active policy directly.
- `policies.annual_premium_cents`: monotonically follows accepted endorsements only, via
  `fn_apply_endorsement`.
- `billing_documents.status`, `payments`: write-once, no further transitions in this slice (see
  documented simplification above).
