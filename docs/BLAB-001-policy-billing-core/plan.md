# Implementation Plan: Policy Billing & Ledger Core

**Branch**: `BLAB-001-policy-billing-core` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/BLAB-001-policy-billing-core/spec.md`

## Summary

Build a focused slice of a homeowners-insurance PAS: mid-term endorsements with deterministic prorated
billing, received-payment ingestion, a balanced double-entry ledger, and an append-only hash-chained
policy history, exposed over 5 authenticated REST endpoints and a minimal React frontend. Technical
approach (research.md): all financial mutations are single PostgreSQL function calls (atomicity from
Postgres's implicit per-statement transaction, not app-level orchestration), all reads go through views,
no ORM; the API sits behind API-key auth, rate limiting, and an explicit CORS allow-list; read endpoints
use ETag/conditional-GET caching; the whole stack (DB, backend, frontend, and Postman/Playwright/k6
runners) runs from one Docker Compose file.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS (backend) and in the Vite/React build (frontend).

**Primary Dependencies**: Backend — Express 4.x, zod, `pg` (PostgreSQL driver), `express-rate-limit`,
`cors`. Frontend — React (latest stable), Vite. Testing — Jest (+ `ts-jest`, `supertest` on the backend,
React Testing Library on the frontend), Postman/newman, Playwright, k6.

**Storage**: PostgreSQL 16. All domain reads/writes go through hand-written SQL functions and views
(research.md, data-model.md) — no ORM, no query builder.

**Testing**: Jest (unit, both packages; `supertest` for backend HTTP-boundary tests) as the primary
Principle I coverage vehicle; Postman/newman for black-box contract tests; Playwright for E2E/UI;
k6 for load/stress (informative, not a merge gate).

**Target Platform**: Local Docker Compose environment (Linux containers), reviewer's machine — no
production deployment target (Principle VII, assessment out-of-scope list).

**Project Type**: Web application (frontend + backend + database).

**Performance Goals**: No production SLA — see research.md's Performance/scale targets decision. k6
scripts run a modest-concurrency smoke load against the endorsement/payment endpoints to produce an
observation for the README's on-call note, not to meet a fabricated throughput number.

**Constraints**: 6-hour assessment timebox (Principle VII); money exclusively as integer cents end-to-end
including inside SQL functions (Principle VI); every financial mutation atomic and idempotent
(Principle II); policy events and ledger entries append-only and hash-chained (Principle III); every
endpoint authenticated, rate-limited, and CORS-restricted (Principle V).

**Scale/Scope**: Single-operator, local-only tool; the 5 endpoints and data model defined in spec.md;
no multi-tenant, multi-currency-per-policy, or production-scale concerns (spec.md Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design below.*

| Principle | Check | Status |
|---|---|---|
| I. TDD (non-negotiable) | Jest suites (unit + supertest) written per constitution's required coverage list; contracts.md/data-model.md give enough shape to write tests before implementation | PASS |
| II. Financial Integrity | Every mutation is one PostgreSQL function call = one implicit transaction; idempotency enforced by a DB unique constraint, race-safe under concurrent retries; balanced ledger entries asserted by function logic *and* a deferred constraint trigger (defense in depth) | PASS |
| III. Append-Only Auditable History | No `UPDATE`/`DELETE` grants on `policy_events`/ledger tables for the app role; hash computed and verified by the same canonicalization path (in-function `pgcrypto.digest`) to avoid write/verify divergence | PASS |
| IV. Simplicity (SOLID/KISS/DRY/YAGNI) | Express (not Fastify), custom hooks (not Redux/React Query), a ~40-line migration runner (not a migration framework), Compose profiles (not a second compose file) — each justified in research.md against a heavier alternative | PASS |
| V. Security by Default | API-key middleware, rate limiting, explicit-origin CORS, parameterized function/view calls only, no secrets committed, no payment-credential fields anywhere | PASS |
| VI. Raw SQL & Integer-Cents Money | All access via hand-written functions/views (no ORM); `BIGINT` cents everywhere including inside functions; proration uses documented integer rounding rule | PASS |
| VII. Scoped, Timeboxed Delivery | Structure below implements exactly the 6 endpoints/data model/minimal frontend from spec.md; no speculative extra endpoints, roles, or admin surface | PASS |

No violations — Complexity Tracking is not applicable (see bottom of this document).

## Project Structure

### Documentation (this feature)

```text
docs/BLAB-001-policy-billing-core/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── rest-api.md       # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md   # /speckit-specify quality checklist
└── tasks.md              # Phase 2 output (/speckit-tasks command — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
docker-compose.yml        # db, migrate, backend, frontend + profiled newman/playwright/k6 services
.env.example
package.json               # npm workspaces root: packages/backend, packages/frontend, packages/shared

db/
└── migrations/
    ├── 001_create_policies.sql
    ├── 002_create_policy_events.sql
    ├── 003_create_billing_documents.sql
    ├── 004_create_payments.sql
    ├── 005_create_ledger_transactions.sql
    ├── 006_create_ledger_entries.sql
    ├── 007_create_functions.sql        # fn_apply_endorsement, fn_record_payment, fn_verify_policy_history
    ├── 008_create_views.sql            # v_policy_summary, v_ledger_summary, v_policy_billing_documents, v_policy_payments
    ├── 009_grants.sql                  # revoke UPDATE/DELETE on append-only tables from the app role
    └── 010_seed_data.sql               # policy.json / events.json fixtures (docs/assessment.md)

packages/
├── shared/
│   └── src/types.ts        # TS types mirroring contracts/rest-api.md, shared by backend + frontend
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── app.ts
│   │   ├── middleware/      # auth.ts, rateLimit.ts, cors.ts, errorHandler.ts
│   │   ├── routes/          # endorsements.ts, payments.ts, policies.ts, ledger.ts, history.ts
│   │   ├── validation/      # zod schemas per endpoint
│   │   └── db/              # pool.ts, repository.ts (thin parameterized calls to functions/views only)
│   ├── tests/
│   │   ├── unit/            # proration, idempotency, currency, ledger-balance, history-chain
│   │   └── http/            # supertest: auth, validation-error shapes, endpoint contracts
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── hooks/            # useApiRequest, usePolicy, useApplyEndorsement, useRecordPayment
    │   ├── components/       # PolicyStateView, Timeline, EndorsementForm, PaymentForm
    │   ├── pages/             # PolicyPage
    │   └── api/client.ts
    ├── tests/unit/            # Jest + React Testing Library
    └── Dockerfile

postman/
├── collections/policy-billing-core.postman_collection.json
└── environments/local.postman_environment.json

playwright/
├── playwright.config.ts
└── tests/                   # apply-endorsement.spec.ts, record-payment.spec.ts, policy-review.spec.ts

k6/
├── endorsement-load.js
└── payment-load.js
```

**Structure Decision**: Web-application layout (Option 2 shape from the template), realized as an npm-
workspaces monorepo with `packages/backend`, `packages/frontend`, `packages/shared` as workspace
members — no extra monorepo tool (Turborepo/Nx) needed for 3 packages (Principle IV/YAGNI). SQL lives
outside any package, in `db/migrations/`, since it's shared infrastructure the backend calls into, not
backend application code. `postman/`, `playwright/`, and `k6/` sit at the repo root (cross-cutting QA
tooling owned by `qa-developer`, per the constitution's role division) rather than inside either app
package, and are wired into `docker-compose.yml` as profiled services (research.md).

## Post-Design Constitution Check

*Re-checked after Phase 1 (data-model.md, contracts/rest-api.md, quickstart.md).*

No new violations introduced by the detailed design. Two items worth naming explicitly (not violations,
documented simplifications per the constitution's Development Workflow rule to surface deviations rather
than let them pass silently):

- `billing_documents.status` does not track per-invoice payment allocation (data-model.md) — matching
  the spec's policy-level `open_balance_cents` requirement without building unspecified FIFO-allocation
  logic (Principle VII/YAGNI).
- The tampered-history-chain scenario (spec.md Acceptance Scenario 4, User Story 3) requires privileged
  direct DB access to simulate, since the application role structurally cannot `UPDATE` `policy_events`
  (Principle III) — this is by design, and is covered by a backend Jest test with elevated test-only DB
  credentials, not by the Postman/Playwright suites (quickstart.md §7).

## Complexity Tracking

Not applicable — no Constitution Check violations were found in either the pre- or post-design gate.
