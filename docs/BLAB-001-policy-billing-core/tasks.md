# Tasks: Policy Billing & Ledger Core

**Input**: Design documents from `docs/BLAB-001-policy-billing-core/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/rest-api.md](./contracts/rest-api.md),
[quickstart.md](./quickstart.md), [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) (v1.2.0)

**Tests**: Included and REQUIRED, not optional — constitution Principle I is explicitly
"non-negotiable" and spec.md lists focused automated tests as a requirement. Write each story's tests
before its implementation tasks and confirm they fail first.

**A note on what "unit test" means here**: per the constitution's SQL-via-functions-and-views design
(Principle VI, v1.2.0), the proration/idempotency/ledger-balance/hash-chain logic lives in PostgreSQL
functions, not TypeScript. Backend "unit" tests for that logic are Jest tests that run against a real
Postgres instance (the Docker Compose `db` service, with migrations applied) — see
`packages/backend/tests/helpers/db.ts` (T017). They still satisfy the constitution's Testing Strategy,
which names Jest as the primary vehicle for this coverage regardless of which layer implements it.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) so each can be
implemented, tested, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 (Apply Endorsement, P1), US2 (Record Payment, P2), US3 (Review Policy/Ledger/History, P3)
- File paths are exact, per plan.md's Project Structure

## Path Conventions (from plan.md)

Web app monorepo: `packages/backend/src/`, `packages/backend/tests/`, `packages/frontend/src/`,
`packages/frontend/tests/`, `packages/shared/src/`, `db/migrations/`, `postman/` (already built —
see prior session), `playwright/`, `k6/`, repo root for `docker-compose.yml`/`.env.example`/`package.json`.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create the npm-workspaces root: `package.json` (workspaces: `packages/*`), root
  `tsconfig.base.json`, and `.gitignore` entries for `node_modules/`, `dist/`, `.env` (plan.md Project
  Structure)
- [X] T002 [P] Initialize `packages/backend/package.json` + `packages/backend/tsconfig.json` with
  dependencies `express`, `zod`, `pg`, `express-rate-limit`, `cors`, `dotenv` and dev dependencies
  `typescript`, `ts-node`, `jest`, `ts-jest`, `supertest`, `@types/express`, `@types/pg`,
  `@types/supertest` (research.md Primary Dependencies)
- [X] T003 [P] Initialize `packages/frontend/package.json` + `packages/frontend/tsconfig.json` with a
  Vite + React (latest stable) + TypeScript scaffold and dev dependencies `vite`,
  `@vitejs/plugin-react`, `jest`, `@testing-library/react`, `@testing-library/jest-dom`
- [X] T004 [P] Initialize `packages/shared/package.json` + `packages/shared/tsconfig.json` (empty
  `src/types.ts` placeholder, referenced by the other two packages via the workspace protocol)
- [X] T005 [P] Configure ESLint + Prettier at the repo root, shared across all three packages

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story task can begin until this phase is complete — every story needs the
database tables, the migration runner, the Express app skeleton, and the auth/rate-limit/CORS
middleware chain.

- [X] T006 Write the migration runner (`db/migrate.ts` + an npm script) that applies any
  not-yet-applied file in `db/migrations/` in filename order inside a transaction, tracking applied
  filenames in a `schema_migrations` table (research.md Migrations decision)
- [X] T007 [P] `db/migrations/001_create_policies.sql` — `policies` table per data-model.md (incl.
  `CHECK` constraints on `status`, `term_end > term_start`, `annual_premium_cents >= 0`)
- [X] T008 [P] `db/migrations/002_create_policy_events.sql` — `policy_events` table per data-model.md
  (incl. `UNIQUE (policy_id, operation_type, idempotency_key)`)
- [X] T009 [P] `db/migrations/003_create_billing_documents.sql` — `billing_documents` table per
  data-model.md
- [X] T010 [P] `db/migrations/004_create_payments.sql` — `payments` table per data-model.md
- [X] T011 [P] `db/migrations/005_create_ledger_transactions.sql` — `ledger_transactions` table per
  data-model.md
- [X] T012 [P] `db/migrations/006_create_ledger_entries.sql` — `ledger_entries` table plus the
  deferred `trg_ledger_entries_balanced` constraint trigger per data-model.md
- [X] T013 `db/migrations/009_grants.sql` — revoke `UPDATE`/`DELETE` on `policy_events`,
  `ledger_transactions`, `ledger_entries` from the application database role (Principle III
  append-only guarantee, enforced structurally) (depends on T007-T012)
- [X] T014 [P] `db/migrations/010_seed_data.sql` — seed the `policy.json` sample policy (`POL-1001`)
  from docs/assessment.md (depends on T007)
- [X] T015 [P] `packages/shared/src/types.ts` — TypeScript types for every request/response/error
  shape in contracts/rest-api.md (`EndorsementRequest`, `EndorsementResponse`, `PaymentRequest`,
  `PaymentResponse`, `PolicySummaryResponse`, `LedgerSummaryResponse`, `HistoryVerifyResponse`,
  `ApiErrorResponse`)
- [X] T016 `packages/backend/src/db/pool.ts` — `pg` connection pool from env vars
- [X] T017 [P] `packages/backend/tests/helpers/db.ts` — test-DB helper that truncates domain tables
  between Jest tests for isolation (used by every story's tests; depends on T007-T013)
- [X] T018 [P] `packages/backend/src/middleware/auth.ts` — `X-API-Key` middleware, constant-time
  comparison against `process.env.API_KEY`, applied to all `/api/*` routes (FR-024, constitution
  Principle V)
- [X] T019 [P] `packages/backend/src/middleware/rateLimit.ts` — `express-rate-limit` config, per-key
  window (FR-025, research.md)
- [X] T020 [P] `packages/backend/src/middleware/cors.ts` — explicit frontend-origin allow-list, no
  wildcard (constitution Principle V)
- [X] T021 [P] `packages/backend/src/middleware/errorHandler.ts` — maps thrown/DB errors to the
  contract's error shapes (400/401/404/409/422/429/500 per contracts/rest-api.md)
- [X] T022 `packages/backend/src/app.ts` — Express app wiring CORS → rate-limit → auth →
  (empty router mount points for each story) → error handler (depends on T018-T021)
- [X] T023 `packages/backend/src/server.ts` — boots `app.ts`, listens on configured port (depends on T022)
- [X] T024 [P] `packages/backend` Jest config (`jest.config.ts`, `ts-jest`, `supertest` setup)
- [X] T025 [P] `packages/frontend` Jest + React Testing Library config
- [X] T026 [P] `packages/frontend/src/api/client.ts` — fetch wrapper injecting the `X-API-Key` header
  and base URL from build-time config (depends on T015)
- [X] T027 `docker-compose.yml` — `db` (postgres:16-alpine), `migrate` (one-shot, depends on T006),
  `backend`, `frontend`, plus `newman`/`playwright`/`k6` services gated behind the `test-integration`/
  `test-e2e`/`test-load` Compose profiles (research.md Docker Compose topology) (depends on T028, T029)
- [X] T028 [P] `packages/backend/Dockerfile`
- [X] T029 [P] `packages/frontend/Dockerfile`
- [X] T030 [P] `.env.example` — `API_KEY`, `POSTGRES_*`, `CORS_ORIGIN`, backend port,
  `VITE_API_BASE_URL`, `VITE_API_KEY` placeholders (no real values)

**Checkpoint**: `docker compose up --build` boots `db` → `migrate` → `backend`/`frontend` cleanly
(quickstart.md §1) with an empty-but-authenticated API. User story implementation can now begin.

---

## Phase 3: User Story 1 - Apply a Mid-Term Endorsement and Generate Billing (Priority: P1) 🎯 MVP

**Goal**: `POST /api/policies/:policyId/endorsements` calculates the prorated delta, creates one
billing document + one policy event, updates the policy's premium, is idempotent, and rejects invalid
requests with zero side effects.

**Independent Test**: Submit one endorsement request against seeded `POL-1001`; verify the billing
document amount equals the deterministic prorated delta (12099, per docs/assessment.md's sample),
independent of any payment or read-endpoint work (spec.md Independent Test, US1).

### Tests for User Story 1 ⚠️ Write first, confirm they fail before implementing

- [X] T031 [P] [US1] Proration/rounding test in `packages/backend/tests/unit/proration.test.ts` —
  the documented 12099 example, a zero-delta case, and a premium-decrease (negative-delta) case
  (FR-003, SC-001)
- [X] T032 [P] [US1] Idempotent-replay and conflicting-payload test in
  `packages/backend/tests/unit/endorsement-idempotency.test.ts` — same key/same payload → original
  result, no new rows; same key/different payload → rejection, no new rows (FR-005, FR-006, SC-002)
- [X] T033 [P] [US1] Validation-rejection test in
  `packages/backend/tests/unit/endorsement-validation.test.ts` — inactive policy and
  effective-date-outside-term cases, both with zero side effects (FR-002, spec.md Acceptance Scenarios 4-5)
- [X] T034 [P] [US1] `supertest` HTTP contract test in `packages/backend/tests/http/endorsements.test.ts` —
  200 success shape, 409 conflict shape, 422 validation shapes, 401 with no `X-API-Key`
  (contracts/rest-api.md endpoint 1)

### Implementation for User Story 1

- [X] T035 [US1] `db/migrations/007_create_functions.sql` — enable the `pgcrypto` extension and write
  `fn_apply_endorsement` (validate active/date-in-term, compute prorated delta, insert policy_event +
  billing_document + ledger_transaction/entries, update policy premium, enforce idempotency via the
  unique constraint) per data-model.md (depends on T007-T013)
- [X] T036 [US1] `packages/backend/src/db/repository.ts` — add `applyEndorsement()` calling
  `fn_apply_endorsement` with parameterized args only (depends on T035, T016)
- [X] T037 [US1] `packages/backend/src/validation/endorsementSchema.ts` (zod) +
  `packages/backend/src/routes/endorsements.ts` (POST handler, `Cache-Control: no-store`) mounted into
  `app.ts` (depends on T036)
- [X] T038 [P] [US1] `packages/frontend/src/hooks/useApplyEndorsement.ts` — custom hook owning the
  submit/loading/success/validation-error/server-error state machine (depends on T026, T015)
- [X] T039 [US1] `packages/frontend/src/components/EndorsementForm.tsx` (depends on T038)
- [X] T040 [P] [US1] `packages/frontend/tests/unit/EndorsementForm.test.tsx` (Jest + RTL)
- [X] T041 [US1] `playwright/tests/apply-endorsement.spec.ts` — submit an endorsement, assert the
  rendered outcome, assert a duplicate submission renders as a no-op (depends on T037, T039)

**Checkpoint**: User Story 1 is fully functional and independently testable — `POST .../endorsements`
works end-to-end, including via the frontend form. Run the Postman collection's "Endorsements" folder
(`docker compose --profile test-integration run --rm newman`) to confirm.

---

## Phase 4: User Story 2 - Record a Received Payment and Update the Balance (Priority: P2)

**Goal**: `POST /api/policies/:policyId/payments` validates currency/amount, applies the payment to
the open balance, posts a balanced ledger entry, is idempotent, and atomically rejects wrong-currency
payments.

**Independent Test**: Submit a payment against a policy with a known open balance; verify the balance
decreases by exactly the payment amount and a balanced ledger entry is created, independent of
endorsement or frontend work (spec.md Independent Test, US2).

### Tests for User Story 2 ⚠️ Write first, confirm they fail before implementing

- [X] T042 [P] [US2] Validation-rejection test in
  `packages/backend/tests/unit/payment-validation.test.ts` — currency mismatch and non-positive
  amount, both with zero side effects (FR-008, SC-004)
- [X] T043 [P] [US2] Duplicate-delivery test in `packages/backend/tests/unit/payment-idempotency.test.ts`
  — same key (byte-identical or not) → original result, no additional balance/ledger effect (FR-009, SC-003)
- [X] T044 [P] [US2] Balanced double-entry ledger test in `packages/backend/tests/unit/ledger-balance.test.ts`
  — apply an endorsement then a matching payment and assert `open_balance_cents` reaches zero with
  every ledger transaction's debits equal to its credits (FR-012, SC-005 — reproduces docs/assessment.md's
  canonical bill-12099/pay-12099/balance-0 example)
- [X] T045 [P] [US2] `supertest` HTTP contract test in `packages/backend/tests/http/payments.test.ts` —
  200 success shape, 422 currency/amount shapes, 401 with no `X-API-Key` (contracts/rest-api.md endpoint 2)

### Implementation for User Story 2

- [X] T046 [US2] `db/migrations/007_create_functions.sql` — append `fn_record_payment` (validate
  currency/amount, insert policy_event + payment + ledger_transaction/entries, enforce idempotency)
  per data-model.md (depends on T035 — same file, sequential)
- [X] T047 [US2] `packages/backend/src/db/repository.ts` — add `recordPayment()` calling
  `fn_record_payment` (depends on T046)
- [X] T048 [US2] `packages/backend/src/validation/paymentSchema.ts` (zod) +
  `packages/backend/src/routes/payments.ts` (POST handler, `Cache-Control: no-store`) mounted into
  `app.ts` (depends on T047)
- [X] T049 [P] [US2] `packages/frontend/src/hooks/useRecordPayment.ts` (depends on T026, T015)
- [X] T050 [US2] `packages/frontend/src/components/PaymentForm.tsx` — amount/currency/metadata fields
  only, no card/bank fields (FR-021) (depends on T049)
- [X] T051 [P] [US2] `packages/frontend/tests/unit/PaymentForm.test.tsx` (Jest + RTL)
- [X] T052 [US2] `playwright/tests/record-payment.spec.ts` — record a payment, assert the rendered
  outcome (depends on T048, T050)

**Checkpoint**: User Stories 1 AND 2 both work independently and together — the full endorsement→
payment→zero-balance flow is reproducible. Run the Postman collection's "Payments" folder to confirm.

---

## Phase 5: User Story 3 - Review Policy State, Ledger Balance, and History Integrity (Priority: P3)

**Goal**: The three `GET` endpoints let an operator see policy state, a balanced-ledger proof, and a
recomputed history-chain verification result, each with a plain-English summary/suggested action where
applicable, backed by conditional-GET caching.

**Independent Test**: Seed a policy with a known history of endorsements and payments (including a
rejected currency-mismatch attempt); verify the state, ledger, and history-verification views each
report accurate results without submitting any new requests during the test (spec.md Independent Test, US3).

### Tests for User Story 3 ⚠️ Write first, confirm they fail before implementing

- [X] T053 [P] [US3] History-chain verification test in
  `packages/backend/tests/unit/history-verification.test.ts` — an intact chain reports `valid: true`;
  a chain tampered via a privileged test-only DB role (bypassing the app role's revoked grants, per
  plan.md's documented note) reports `valid: false` with the correct `first_broken_event_id`
  (FR-015, spec.md Acceptance Scenario 4)
- [X] T054 [P] [US3] Policy-summary/open-balance test in `packages/backend/tests/unit/policy-summary.test.ts`
  — `v_policy_summary`'s `open_balance_cents` matches the ledger's Premium Receivable net balance
  (FR-016, data-model.md)
- [X] T055 [P] [US3] Ledger-summary-balanced test in `packages/backend/tests/unit/ledger-summary-view.test.ts`
  — `v_ledger_summary` reports `balanced: true` only when every transaction's debits equal its credits (FR-017)
- [X] T056 [P] [US3] `supertest` HTTP contract test in `packages/backend/tests/http/policy-read.test.ts`
  — 200 shapes for all three GET endpoints incl. `ETag` header and `304` on matching
  `If-None-Match`, 404 for an unknown policy, 401 with no `X-API-Key` (contracts/rest-api.md endpoints 3-5)

### Implementation for User Story 3

- [X] T057 [US3] `db/migrations/007_create_functions.sql` — append `fn_verify_policy_history`
  (recompute the chain in event order, return `valid`/`event_count`/`first_broken_event_id`) per
  data-model.md (depends on T046 — same file, sequential)
- [X] T058 [US3] `db/migrations/008_create_views.sql` — `v_policy_summary`,
  `v_policy_billing_documents`, `v_policy_payments`, `v_ledger_summary` per data-model.md (depends on T007-T013)
- [X] T059 [US3] `packages/backend/src/db/repository.ts` — add `getPolicySummary()`,
  `getLedgerSummary()`, `verifyPolicyHistory()` (depends on T057, T058)
- [X] T060 [US3] `packages/backend/src/routes/policies.ts` — `GET /:policyId` composing
  `v_policy_summary` + billing documents + payments + `fn_verify_policy_history`, with the
  server-derived `summary`/`suggested_action` text (FR-023) and `ETag`/`If-None-Match` support, mounted
  into `app.ts` (depends on T059)
- [X] T061 [US3] `packages/backend/src/routes/ledger.ts` — `GET /:policyId/ledger` with `ETag` support,
  mounted into `app.ts` (depends on T059)
- [X] T062 [US3] `packages/backend/src/routes/history.ts` — `GET /:policyId/history/verify` with
  `ETag` support, mounted into `app.ts` (depends on T059)
- [X] T063 [P] [US3] `packages/frontend/src/hooks/usePolicy.ts` — fetch + conditional-refetch +
  loading/success/error state (depends on T026, T015)
- [X] T064 [US3] `packages/frontend/src/components/PolicyStateView.tsx` (depends on T063)
- [X] T065 [US3] `packages/frontend/src/components/Timeline.tsx` — events/billing documents/payments/
  ledger summary (depends on T063)
- [X] T066 [US3] `packages/frontend/src/pages/PolicyPage.tsx` — composes `PolicyStateView`,
  `Timeline`, `EndorsementForm`, `PaymentForm` (depends on T039, T050, T064, T065)
- [X] T067 [P] [US3] `packages/frontend/tests/unit/PolicyStateView.test.tsx` (Jest + RTL)
- [X] T068 [P] [US3] `packages/frontend/tests/unit/Timeline.test.tsx` (Jest + RTL)
- [X] T069 [US3] `playwright/tests/policy-review.spec.ts` — load the policy page, assert state/timeline/
  ledger/history render correctly (depends on T066)

**Checkpoint**: All three user stories are independently functional. The full docs/assessment.md
"Expected Output" JSON example is now reproducible end-to-end via the running stack. Run the full
Postman collection and the full Playwright suite to confirm.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T070 [P] `k6/endorsement-load.js` — concurrent load against `POST .../endorsements`, including
  enough volume to observe the rate limiter engage (research.md, constitution Testing Strategy)
- [X] T071 [P] `k6/payment-load.js` — concurrent load against `POST .../payments`
- [X] T072 [P] Docker hardening: non-root user + multi-stage builds in `packages/backend/Dockerfile`
  and `packages/frontend/Dockerfile` (security-auditor)
- [X] T073 Run `npm audit` across all three packages; document or fix findings (security-auditor)
- [X] T074 Run quickstart.md's full validation walkthrough (§1-§7) end-to-end and fix any drift
  between the docs and the actual implementation
- [X] T075 Write `README.md`: how to run the project, API design, SQL schema/invariants, business
  rules (proration/rounding, idempotency, currency), where AI was used and what was manually verified,
  what would be improved with more time, and a brief on-call monitoring/recovery note (constitution
  Development Workflow, assessment deliverable requirements)
- [X] T076 Final constitution compliance pass against the actual implementation — re-check all 7
  principles from plan.md's Constitution Check table still hold (security-auditor + qa-developer)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3-5)**: all depend on Foundational; within `db/migrations/007_create_functions.sql`
  specifically, US1 → US2 → US3 are sequential (same file, one function appended per story) even though
  the rest of each story's work is independent
- **Polish (Phase 6)**: depends on the user stories it touches (k6 scripts need endpoints to exist;
  the README needs the whole system built)

### User Story Dependencies

- **US1 (P1)**: no dependency on US2/US3 for its own correctness; shares `007_create_functions.sql`
  and `app.ts` as append-only integration points
- **US2 (P2)**: independently correct on its own, but its ledger-balance test (T044) demonstrates the
  full endorsement+payment round trip, so is easiest to validate meaningfully after US1 exists
- **US3 (P3)**: purely additive read-side work; needs US1/US2's functions to exist for its tests to have
  non-trivial data, but its own views/routes don't modify anything US1/US2 built

### Parallel Opportunities

- All Setup tasks marked [P] (T002-T005)
- Table migrations T007-T012 (six different files)
- Foundational middleware T018-T021 (four different files) and config tasks T024-T026, T028-T030
- All tests within a story marked [P] (different test files)
- Frontend hook/test tasks marked [P] within a story

---

## Parallel Example: User Story 1

```bash
# Tests together (different files):
Task: "Proration/rounding test in packages/backend/tests/unit/proration.test.ts"
Task: "Idempotent-replay/conflict test in packages/backend/tests/unit/endorsement-idempotency.test.ts"
Task: "Validation-rejection test in packages/backend/tests/unit/endorsement-validation.test.ts"
Task: "supertest contract test in packages/backend/tests/http/endorsements.test.ts"

# Frontend hook + its test together (backend route work is sequential, different concern):
Task: "packages/frontend/src/hooks/useApplyEndorsement.ts"
Task: "packages/frontend/tests/unit/EndorsementForm.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational (blocks everything)
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: run T031-T034, then `docker compose --profile test-integration run --rm
   newman` against the "Endorsements" folder, then T041's Playwright spec
5. This alone demonstrates the assessment's single most-evaluated capability: deterministic prorated
   billing with idempotency

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → this is the MVP
3. Add US2 → validate independently → the endorsement+payment+zero-balance story is now demoable
4. Add US3 → validate independently → the full assessment "Expected Output" example is reproducible
5. Polish (k6, hardening, README) → submission-ready

---

## Notes

- [P] tasks touch different files with no unmet dependency
- [Story] labels give traceability back to spec.md's prioritized user stories
- `db/migrations/007_create_functions.sql` is intentionally shared across all three stories (per
  plan.md's Project Structure) — treat its three tasks (T035, T046, T057) as strictly sequential even
  though everything else in each story is independent
- Every test task MUST fail before its corresponding implementation task is done (constitution
  Principle I, non-negotiable)
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: vague tasks, two tasks editing the same file marked [P], cross-story dependencies that would
  break a story's independent testability
