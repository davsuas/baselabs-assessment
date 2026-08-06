# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains no application code. What exists: the take-home assessment brief
(`docs/assessment.md`), a Spec Kit scaffold (`.specify/`, `.claude/skills/speckit-*`), a ratified
constitution (`.specify/memory/constitution.md`, **v1.2.0**), four specialized subagents
(`.claude/agents/`), a Postman collection/environment (`postman/`), and the full Phase 0/1 design for
the one feature (`docs/BLAB-001-policy-billing-core/`: `spec.md`, `research.md`, `data-model.md`,
`contracts/rest-api.md`, `quickstart.md`, `plan.md`). There is no `package.json` and no source tree yet.
Next step is `/speckit-tasks` → `/speckit-implement` to actually build it.

Once the project is scaffolded, update this file with real build/lint/test/run commands — do not leave
this section stale.

## Confirmed tech stack

- **Backend**: Node.js 22 LTS + TypeScript, Express, zod for boundary validation, PostgreSQL 16 via the
  `pg` driver. **No ORM, and no inline ad-hoc SQL in application code either**: every domain write is a
  single call to a hand-written PostgreSQL function (atomicity comes from Postgres's own implicit
  per-statement transaction); every domain read goes through a hand-written view or table-returning
  function. See `docs/BLAB-001-policy-billing-core/data-model.md` for the full function/view list and
  `research.md` for why (constitution Principle VI, v1.2.0). Migrations are plain, sequentially numbered
  `.sql` files applied by a minimal custom runner.
- **Security**: every `/api/*` route requires an `X-API-Key` header (API key over OAuth2 — OAuth2 was
  explicitly rejected as disproportionate to this project's scope), sits behind rate limiting, and CORS
  is an explicit origin allow-list (never a wildcard). Read endpoints use `ETag`/`If-None-Match`
  conditional caching; mutation endpoints are `Cache-Control: no-store`. Full contract:
  `docs/BLAB-001-policy-billing-core/contracts/rest-api.md`.
- **Frontend**: latest stable React + TypeScript, built with Vite. Shared stateful logic (API calls, the
  loading/success/validation-error/server-error state machine) lives in custom hooks, not duplicated per
  component. No UI component library/design system beyond the minimal-frontend requirement.
- **Containerization**: one `docker-compose.yml` covers `db`, `migrate`, `backend`, `frontend`, plus
  Compose-profiled test-runner services (`newman`, `playwright`, `k6`) so the whole toolchain — not just
  the app — runs from a single Compose file without blocking a plain `docker compose up`.
- **Repository layout**: npm-workspaces monorepo (`packages/backend`, `packages/frontend`,
  `packages/shared`), with `db/migrations/`, `postman/`, `playwright/`, and `k6/` at the repo root. Full
  tree: `docs/BLAB-001-policy-billing-core/plan.md`'s Project Structure section.

## Testing stack

- **Unit tests — Jest**: primary vehicle for the constitution's required coverage (proration/rounding,
  duplicate delivery, wrong-currency rejection, balanced ledger writes, hash-chain verification
  including a tampered case). Backend and frontend each carry their own Jest suite; backend also uses
  `supertest` for HTTP-boundary tests (auth rejection, validation-error shapes); frontend component
  tests use React Testing Library.
- **Integration/contract tests — Postman**: `postman/collections/policy-billing-core.postman_collection.json`
  + `postman/environments/local.postman_environment.json`. Collection-level `X-API-Key` auth, covers all
  5 endpoints including idempotent-replay, conflicting-payload (409), duplicate-payment,
  wrong-currency (422), not-found (404), and unauthorized (401) cases. Run via
  `docker compose --profile test-integration run --rm newman`.
- **Load/stress tests — k6**: scripts (`k6/`) targeting the endorsement and payment endpoints under
  concurrent load, including observing the rate limiter engage. Informative for the on-call/monitoring
  note, not a merge gate. Run via `docker compose --profile test-load run --rm k6`. Not yet scaffolded —
  script content is implementation work for `/speckit-implement`.
- **UI/E2E tests — Playwright**: (`playwright/`) drives the frontend through the primary flows and
  asserts the four required UI states. Run via `docker compose --profile test-e2e run --rm playwright`.
  Not yet scaffolded — add once the frontend exists.

## Specialized subagents

Four Claude Code subagents in `.claude/agents/` divide the work, each reading the constitution and the
`docs/BLAB-001-policy-billing-core/` design docs first: `backend-developer` (Express/TS API, SQL
functions/views, financial logic, auth/rate-limit/CORS middleware, backend Jest),
`frontend-developer` (React/TS UI, custom hooks, frontend Jest + RTL), `qa-developer` (Postman/k6/
Playwright, cross-cutting coverage audit), `security-auditor` (Principle V review gate — injection,
auth, rate-limit/CORS config, secrets, idempotency abuse, payment-data scope). A change touching
financial logic must pass both the owning developer and the security-auditor before it's considered
done (constitution, Development Workflow & Quality Gates).

## The assignment

Full spec: `docs/assessment.md`. Summary — build a focused slice of a homeowners-insurance Policy
Administration System (PAS):

- **TypeScript required**, raw SQL only (**no ORM**), money stored/calculated as **integer cents**
  (never floating point).
- Timeboxed to ~6 hours. Favor a small, correct, well-tested slice over a broad, unfinished one.

### Required API endpoints

1. `POST /api/policies/:policyId/endorsements` — validate status/dates, calculate the prorated premium
   delta, create one billing document + one policy event. Idempotent.
2. `POST /api/policies/:policyId/payments` — ingest normalized payment JSON (not a real payment
   integration), validate, persist, reject wrong currency, return original result on duplicate delivery.
3. `GET /api/policies/:policyId` — policy state, billing documents, payments, open balance, readable
   summary.
4. `GET /api/policies/:policyId/ledger` — ledger transactions/entries proving the books are balanced.
5. `GET /api/policies/:policyId/history/verify` — verify the append-only, hash-chained policy-event
   history (`previous_hash` / `event_hash`) and return the verification result.

### Core invariants (do not compromise these)

- **Atomicity**: every financial mutation writes balanced debit/credit ledger entries inside a single
  DB transaction. No partial writes on failure.
- **Idempotency**: same idempotency key + same payload → return the original result, no new effects.
  Same key + different payload → fail clearly (do not silently overwrite).
- **Append-only history**: policy events and ledger entries are never edited or deleted; corrections are
  new entries. Each event hash covers the canonical payload + `previous_hash`.
- **Money**: integer cents only, deterministic rounding — proration uses
  `round_half_away_from_0((new_premium - old_premium) * remaining_days / term_days)`, where
  `remaining_days = term_end - effective_date` and `term_days = term_end - term_start`.
- **Ledger effects**: positive premium delta → DR Premium Receivable / CR Written Premium. Payment
  received → DR Cash / CR Premium Receivable.
- Wrong-currency payments fail atomically (no partial persistence).

### Required data model (raw SQL migrations)

Tables: policies, policy events, billing documents, payments, ledger transactions, ledger entries.
Plus (per the confirmed tech stack above) the SQL functions/views that are the only way application
code touches these tables — see `docs/BLAB-001-policy-billing-core/data-model.md`.

### Minimal frontend

Required, not polished: policy state view (ID, status, premium, currency, term dates, open balance,
history-verification status), a timeline/summary of events + billing documents + payments + ledger,
an Apply Endorsement form, a Record Received Payment form (no card numbers / bank credentials), and
loading/success/validation-error/server-error states.

### Tests to include

Focused automated tests for: proration math, duplicate delivery (endorsements and payments), wrong-
currency rejection, balanced ledger writes, and history-chain verification.

### Explicitly out of scope

No real payment-provider integration (Stripe/PayPal/bank/webhooks), no card/bank credential collection,
no production deployment, no polished design system, no full auth system, no broader PAS beyond this
workflow.

### Deliverable expectations

- README covering: how to run it, API design, SQL schema, business rules, where AI was used, what
  you'd improve with more time, and a brief on-call monitoring/recovery note.
- Sample seed data (`policy.json`, `events.json`) and `business-rules.txt` are specified in
  `docs/assessment.md` — use them as fixtures/seed data.

## Spec Kit workflow

This repo is scaffolded with [Spec Kit](https://github.com/) (`.specify/`). Slash-command skills exist for
the spec-driven workflow: `speckit-constitution`, `speckit-specify`, `speckit-clarify`, `speckit-plan`,
`speckit-tasks`, `speckit-analyze`, `speckit-checklist`, `speckit-implement`, `speckit-converge`,
`speckit-taskstoissues`. Typical order: constitution → specify → clarify → plan → tasks → analyze →
implement.

`.specify/memory/constitution.md` has been ratified (v1.2.0) — read it before planning or implementing
anything; it governs TDD, financial-integrity, append-only-history, simplicity, security (incl.
authentication/rate-limiting/CORS/caching), SQL-via-functions-and-views, and scope-discipline rules for
this project.

### Spec artifact location convention

Spec Kit's default spec root (`specs/`) is **not** used in this repo. Every feature spec lives under
`docs/BLAB-XXX-<short-name>/`, sequential 3-digit numbering (`BLAB-001`, `BLAB-002`, ...), one folder per
feature. This is a per-invocation override, not a persistent tool setting — when running
`/speckit-specify` (or any command that creates a new feature directory), explicitly pass
`SPECIFY_FEATURE_DIRECTORY=docs/BLAB-XXX-<short-name>` rather than letting it default to `specs/`.
Check existing `docs/BLAB-*` folders to determine the next sequential number.
