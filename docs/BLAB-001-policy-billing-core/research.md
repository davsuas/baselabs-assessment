# Phase 0 Research: Policy Billing & Ledger Core

**Feature**: [spec.md](./spec.md) | **Constitution**: v1.2.0

This resolves every open technical decision implied by the spec and the constitution's Technology &
Architecture Constraints / Testing Strategy / Principle V / Principle VI sections. No `NEEDS
CLARIFICATION` markers remain.

## Runtime & language

- **Decision**: Node.js 22 LTS, TypeScript 5.x (strict mode), on both backend and frontend.
- **Rationale**: Node 22 is the current LTS at time of writing; strict TypeScript catches the exact
  class of "accidentally a float" bugs Principle VI is designed to prevent.
- **Alternatives considered**: Deno/Bun — rejected, not what the assessment/constitution specify and
  would add unfamiliar tooling risk under a 6-hour timebox (Principle VII).

## Backend framework & validation

- **Decision**: Express 4.x + zod for request-body/param schema validation at the route boundary.
- **Rationale**: Confirmed by user; smallest-surface-area framework that's trivial to explain and step
  through live (Principle IV). zod gives typed, declarative boundary validation without hand-rolled
  `if` chains.
- **Alternatives considered**: Fastify (more built-in validation machinery, more to explain live —
  rejected per the same constitution tradeoff already recorded in v1.1.0).

## Data access strategy: functions & views, not inline SQL

- **Decision**: Every domain write is a single PostgreSQL function call (`SELECT * FROM
  fn_apply_endorsement(...)`, `SELECT * FROM fn_record_payment(...)`); every domain read is a view or
  a table-returning function (`v_policy_summary`, `v_ledger_summary`, `v_policy_timeline`,
  `fn_verify_policy_history(...)`). Application code (a thin repository/data-access module) only issues
  parameterized calls to these — never inline `INSERT`/`UPDATE`/multi-statement `SELECT`.
- **Rationale**: Constitution Principle VI (v1.2.0). A single top-level function invocation runs inside
  one implicit Postgres transaction, so atomicity (Principle II) falls out of the database layer itself
  instead of needing app-level `BEGIN`/`COMMIT` orchestration around multiple statements — fewer places
  for a partial-write bug to hide. It's also a direct, gradeable demonstration of SQL depth (functions,
  transactions, views) which the assessment explicitly evaluates ("backend and SQL foundations").
- **Alternatives considered**: App-level raw parameterized queries wrapped in an app-managed transaction
  (the v1.1.0 baseline) — rejected per explicit user direction; still valid raw SQL, but doesn't
  showcase procedural SQL and pushes transaction-boundary correctness into TypeScript instead of the
  database. Postgres `PROCEDURE`s (vs `FUNCTION`s) — rejected: procedures that issue internal
  `COMMIT`/`ROLLBACK` cannot be called from inside an app-managed transaction block, which would force
  exactly the app-level orchestration this decision is trying to avoid; `FUNCTION`s returning a row/
  table are the correct primitive here.

## Idempotency enforcement

- **Decision**: A unique index on `(operation_type, policy_id, idempotency_key)` at the database level
  (across a shared idempotency-tracking table, or per-table unique constraints on endorsements/
  payments). The write function attempts the insert; on a unique-violation it re-fetches and compares
  the stored payload hash to the incoming payload: identical → return the original result; different →
  raise an application-level error the API layer maps to a 409-class response.
- **Rationale**: A DB-level uniqueness constraint is race-proof under concurrent duplicate submissions
  in a way an app-level "check then insert" can't be without extra locking — the database is the single
  source of truth for "has this key been used," consistent with pushing correctness into the data layer
  (see previous decision).
- **Alternatives considered**: App-level check-then-write — rejected, race-prone under concurrent
  retries, which is explicitly a scenario the spec calls out (Edge Cases, User Story 1/2).

## Hash-chain canonicalization

- **Decision**: Each policy event's canonical payload is a fixed-order, explicitly-concatenated string
  of its defining fields (not a serialized JSON blob, to avoid any key-ordering ambiguity), computed
  inside the same PostgreSQL function that writes the event, using the `pgcrypto` extension's `digest()`
  for SHA-256: `event_hash = encode(digest(canonical_payload || previous_hash, 'sha256'), 'hex')`.
- **Rationale**: Keeping canonicalization and hashing inside the database function that writes the
  event guarantees write-time and verify-time hashing use the identical code path (verification is a
  second PL/pgSQL function/query that recomputes the same way) — eliminating the classic bug where
  app-code and verification-code canonicalize differently and the chain falsely reports tampering.
- **Alternatives considered**: Canonical JSON (e.g. sorted-key `jsonb`) — rejected as needlessly
  fragile (Postgres `jsonb` does not guarantee key order is preserved on round-trip); hashing in
  TypeScript — rejected for the write-vs-verify code-path-divergence risk above, and because it moves
  logic out of the layer this project is deliberately showcasing.

## Authentication

- **Decision**: Static API key, issued via environment configuration (`API_KEY` env var, no default
  baked into the image), sent by callers as an `X-API-Key` header, checked by an Express middleware
  applied to all `/api/*` routes using a constant-time comparison before any route handler runs.
- **Rationale**: Constitution Principle V (v1.2.0) requires every request to carry a credential;
  OAuth2 was explicitly considered and rejected there as disproportionate to a single-trusted-operator,
  local-only system — it would itself be the "full authentication/authorization system" the assessment
  brief places out of scope.
- **Alternatives considered**: OAuth2 (client-credentials or otherwise) — rejected per Principle V's
  explicit rationale. No auth at all — rejected, fails FR-024 and Principle V outright.

## Rate limiting

- **Decision**: `express-rate-limit`, in-memory store (single local instance, no distributed store
  needed), applied per API key, a conservative fixed window (e.g. 100 requests/minute per key) as a
  reasonable default for a local assessment environment, configurable via env var.
- **Rationale**: Constitution Principle V requires every endpoint sit behind rate limiting; in-memory is
  sufficient because Docker Compose runs a single backend instance — a distributed store (Redis) would
  be scope the assessment explicitly warns against (Principle VII, YAGNI).
- **Alternatives considered**: Redis-backed limiter — rejected as unnecessary infrastructure for a
  single-instance local deployment.

## CORS

- **Decision**: `cors` middleware, explicit allow-list containing only the frontend's origin (from an
  env var, e.g. `http://localhost:5173` for local Vite dev / the Compose frontend service origin), no
  wildcard, credentials not required (API key travels in a header, not a cookie).
- **Rationale**: Constitution Principle V explicitly prohibits a wildcard origin.

## Response caching

- **Decision**: The three read endpoints (`GET /policies/:id`, `.../ledger`, `.../history/verify`) emit
  a strong `ETag` derived from the underlying data's latest state (e.g. a hash or `updated_at`/event-
  count-derived value returned by the view itself) and honor `If-None-Match`, returning `304 Not
  Modified` when unchanged. All mutation endpoints (`POST .../endorsements`, `POST .../payments`)
  respond with `Cache-Control: no-store`.
- **Rationale**: Constitution Principle V permits caching on reads only where it can't mask a
  just-posted mutation. ETag/conditional-GET is correct-by-construction here: the moment new data is
  written, the ETag changes and any cached `304` response becomes invalid on the very next request —
  there's no time-based staleness window to reason about, unlike a `max-age`-based cache.
- **Alternatives considered**: `Cache-Control: max-age=N` — rejected, introduces a window in which an
  operator could view stale balance/ledger/history state after a mutation, which directly conflicts
  with the spec's "operators need a clear explanation of current policy state" goal.

## Frontend framework & state pattern

- **Decision**: Latest stable React release, TypeScript, Vite. All API interaction, form-submission/
  validation state, and the loading/success/validation-error/server-error state machine (FR-022) are
  implemented as custom hooks (e.g. `useApiRequest`, `usePolicy`, `useApplyEndorsement`,
  `useRecordPayment`) consumed by presentational components, rather than duplicated inline per
  component.
- **Rationale**: Confirmed by user; custom hooks are the idiomatic React mechanism for sharing stateful
  logic without a heavier state-management library, consistent with Principle IV (KISS/YAGNI — no
  Redux/React Query needed for four screens/forms).
- **Alternatives considered**: A data-fetching library (React Query/SWR) — would also provide caching/
  refetch, but is an added dependency and concept to explain live for a 4-screen app; a hand-written
  hook is simpler and sufficient (Principle IV).

## Migrations

- **Decision**: Plain, sequentially numbered `.sql` files (`001_create_policies.sql`,
  `002_create_policy_events.sql`, ..., `NNN_create_functions.sql`, `NNN_create_views.sql`) under a
  `db/migrations/` directory, applied by a minimal TypeScript runner (tracks applied filenames in a
  `schema_migrations` table, applies any not-yet-applied file in order inside a transaction) run as a
  one-off Docker Compose step before the backend starts.
- **Rationale**: Constitution Technology & Architecture Constraints explicitly rules out a heavyweight
  migration framework; a ~40-line runner is enough and keeps every migration fully inspectable as raw
  SQL (including the function/view definitions).
- **Alternatives considered**: `node-pg-migrate` — not an ORM, but still an added framework/DSL layer
  beyond what's needed; rejected under Principle IV/YAGNI.

## Docker Compose topology

- **Decision**: A single `docker-compose.yml` with services `db` (postgres:16-alpine), `migrate`
  (one-shot, runs the migration runner then exits), `backend`, `frontend`, and three test-runner
  services gated behind Compose **profiles** so they don't start on a plain `docker compose up`:
  `newman` (profile `test-integration`), `playwright` (profile `test-e2e`), `k6` (profile `test-load`).
  `docker compose up` starts `db` → `migrate` → `backend`/`frontend`. `docker compose --profile
  test-integration run newman` (etc.) runs a given test layer on demand against the already-running
  stack.
- **Rationale**: Satisfies "all needed components: database, FE, BE, postman, playwright, k6" in one
  Compose file while keeping default startup fast and not forcing every `up` to spin up test runners
  (Principle VII/YAGNI — test runners aren't part of the running product).
- **Alternatives considered**: Separate `docker-compose.test.yml` overlay — rejected as an unnecessary
  second file when Compose profiles solve the same problem in one file (Principle IV/KISS).

## Testing tool wiring

- **Decision**: Backend Jest suite includes `supertest`-based tests for HTTP-boundary behavior
  (auth-middleware rejection, validation-error shapes) in addition to pure unit tests of proration/
  hashing logic; this stays inside the Jest/unit layer per the constitution's Testing Strategy, and is
  distinct from Postman's black-box role of testing the same endpoints as an external client would,
  including the full Docker-networked stack.
- **Rationale**: Keeps a fast, no-network feedback loop for logic correctness (Jest+supertest against
  the Express app object in-process) separate from the slower, real-network contract verification
  (Postman against the running container), matching each tool's stated scope in the constitution.

## Performance/scale targets

- **Decision**: No specific throughput target is set beyond "doesn't visibly degrade under the k6
  smoke-load scenario" — this is a local, single-operator assessment tool, not a production service
  (Principle VII). k6 scripts target the endorsement/payment endpoints at a modest concurrency (e.g.
  10–20 virtual users) to produce an observation for the README's on-call/monitoring note, not to hit a
  contractual SLA.
- **Rationale**: Setting an arbitrary production-grade number (e.g. "1000 req/s") would be fabricated
  and contradict Principle VII's explicit anti-overbuilding stance.
