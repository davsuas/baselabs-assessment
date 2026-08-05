<!--
Sync Impact Report
==================
Version change: 1.1.0 → 1.2.0
Modified principles:
  - VI. Raw SQL & Integer-Cents Money → tightened (not redefined): application
    code MUST NOT issue inline ad-hoc DML/SELECT statements for domain
    reads/writes; it MUST call hand-written PostgreSQL functions (mutations)
    and views (reads) instead. Still raw SQL, still no ORM/query builder — the
    "no ORM" guarantee is unchanged, only the required interface shape is new.
  - V. Security by Default → expanded with authentication, rate limiting, CORS,
    and response-caching requirements.
Added sections: none (existing sections expanded in place)
Removed sections: none
Deferred items: none — all values in this amendment were explicitly directed
  by the user (Docker Compose scope, API-key auth over OAuth2, SQL-via-
  functions/views, React version/hooks pattern) or are direct consequences of
  those directions.
Templates checked for alignment:
  - .specify/templates/plan-template.md — generic, no principle-specific
    references requiring edits; Constitution Check gate reads this file at
    runtime, ✅ compatible.
  - .specify/templates/spec-template.md — no changes required, ✅ compatible.
  - .specify/templates/tasks-template.md — no changes required, ✅ compatible.
  - .specify/templates/checklist-template.md — no changes required, ✅ compatible.
-->

# Base Labs PAS Take-Home Constitution

## Core Principles

### I. Test-Driven Development (NON-NEGOTIABLE)

Tests MUST be written before or alongside the implementation they cover, and MUST
fail for the right reason before the implementation makes them pass. Every
financial mutation path (endorsement proration, payment ingestion, ledger
posting) and every invariant (idempotency, currency validation, hash-chain
integrity) MUST have a focused automated test that exercises it directly —
generic end-to-end smoke tests do not satisfy this principle on their own.
Required minimum coverage: proration math (including rounding), duplicate
delivery for both endorsements and payments, wrong-currency rejection,
balanced double-entry ledger writes, and history-chain verification (including
a deliberately tampered/broken chain).

Rationale: this system's entire evaluation criterion is financial correctness.
Untested money logic is unverifiable money logic, and floating-point-adjacent
bugs in proration or rounding are exactly the class of defect tests exist to
catch before a reviewer does.

### II. Financial Integrity: Atomicity, Idempotency, Balance

Every financial mutation (endorsement, payment) MUST execute inside a single
database transaction that either commits a fully consistent set of writes or
leaves no trace at all — no partial writes under any failure path. Every
mutation that has a client-supplied idempotency key MUST be idempotent: the
same key with the same payload MUST return the original result without
creating new effects, and the same key with a different payload MUST fail
clearly (never silently overwrite or merge). Every financial mutation that
posts to the ledger MUST produce balanced debit/credit entries in the same
transaction as the domain write it represents.

Rationale: this is a ledger-backed system pretending to be a toy — operators
and auditors depend on these guarantees holding without exception, and the
assessment explicitly evaluates "deterministic, traceable, and safe" financial
effects.

### III. Append-Only Auditable History

Policy events and ledger entries MUST NEVER be updated or deleted after
creation. Corrections MUST be modeled as new, subsequent entries. Every policy
event MUST be hash-chained: its `event_hash` MUST be derived from a canonical
serialization of its own payload plus the prior event's `previous_hash`, such
that any retroactive tampering is detectable by recomputing the chain. The
system MUST expose a verification path that recomputes and reports chain
validity rather than trusting stored flags.

Rationale: the scenario explicitly requires a "tamper-evident" history;
mutability anywhere in this chain defeats that guarantee entirely.

### IV. Simplicity & Maintainability (SOLID, KISS, DRY, YAGNI)

Code MUST favor the simplest design that satisfies the current requirement.
Apply SOLID to keep components independently reasoned-about (in particular:
single-responsibility services/handlers, and dependency inversion at the
persistence boundary so raw-SQL data access is swappable/testable). Apply KISS
and YAGNI to reject speculative abstractions, unused configuration surfaces,
or generality not required by this assessment's scope. Apply DRY only where
duplication represents a single concept repeated — do not force premature
abstraction over incidental similarity. When these principles trade off
against each other, prefer the option that is easier to explain out loud in
the live interview.

Rationale: this codebase must be defensible line-by-line in a live interview;
over-engineering is exactly as disqualifying here as sloppiness.

### V. Security by Default

All external input (API request bodies, path/query parameters) MUST be
validated at the boundary before touching business logic or SQL. All SQL
access MUST use parameterized queries/function-calls — string-concatenated
SQL is prohibited, including when building calls to the functions/views
required by Principle VI. Secrets and connection strings MUST be supplied via
environment variables and MUST NOT be committed to the repository; an
`.env.example` (with no real values) is the required substitute. No card
numbers, bank credentials, or other real payment credentials may be
collected, stored, or logged anywhere in the system, consistent with this
project's payment-data-ingestion-only scope.

Every API request MUST carry a caller credential (a static API key issued via
environment configuration) validated by a request-level authorization
middleware; requests without a valid credential MUST be rejected before
reaching business logic. OAuth2 is explicitly rejected as disproportionate to
this project's scope (single trusted operator, local-only, no user
directory) — it would itself be the kind of full authentication/authorization
system the assessment brief places out of scope. Every endpoint MUST sit
behind rate limiting to bound abuse/retry storms, and CORS MUST be configured
to an explicit allow-list (the local frontend origin), never a wildcard.
Read endpoints MAY use short-lived, explicitly-scoped response caching where
it does not risk serving stale financial state (e.g. never cache in a way
that could mask a just-posted payment or endorsement); financial mutation
endpoints MUST NOT be cached.

Rationale: security defects are non-negotiable regardless of project size,
this scenario handles financial data where injection or secret leakage has
outsized consequences, and an insurance/fintech-flavored API left
unauthenticated or unthrottled is not a credible demonstration of backend
judgment.

### VI. Raw SQL & Integer-Cents Money

Database access MUST use raw, hand-written SQL — no ORM or query builder that
hides the schema or generates SQL implicitly. Specifically: every domain read
MUST go through a hand-written PostgreSQL view (or a function returning a
set/table), and every domain write (endorsement acceptance, payment
acceptance, and any other financial mutation) MUST go through a hand-written
PostgreSQL function that performs its own inserts/updates and — because a
single top-level function invocation executes within one implicit
transaction — provides atomicity in the database layer itself (satisfying
Principle II) rather than relying on application-level `BEGIN`/`COMMIT`
orchestration. Application code MUST NOT contain inline ad-hoc `INSERT`/
`UPDATE`/multi-statement `SELECT` sequences for domain data; it calls these
functions/views with parameterized arguments only. Migrations remain plain,
hand-written `.sql` files (schema, functions, views) — this is a structural
requirement on top of "raw SQL," not a departure from it: no ORM, no query
builder, still hand-written SQL end to end.

All monetary values MUST be stored and computed exclusively as integer cents;
floating-point types MUST NOT be used for any monetary quantity at rest, in
transit, or in intermediate calculation — including inside SQL functions,
where computation MUST use integer/`bigint` arithmetic, never `float`/`real`/
`double precision`. Proration MUST use the specified deterministic rounding
rule (round-half-away-from-zero) applied to integer inputs only.

Rationale: these are explicit, non-negotiable requirements of the assessment
brief (raw SQL, no ORM, integer-cents money), and pushing financial mutations
into database functions both gets atomicity "for free" from Postgres's
transaction model and is a direct, deliberate demonstration of SQL depth —
procedural logic, transactions, and views — which is exactly what "backend
and SQL foundations" evaluates. Floating-point money remains a well-known
source of silent financial drift regardless of which layer computes it.

### VII. Scoped, Timeboxed Delivery

Work MUST stay within the ~6-hour timebox and the assessment's explicit scope:
the six required endpoints, the required data model, and the minimal
frontend. Real payment-provider integration (Stripe/PayPal/bank/webhooks),
card/bank credential handling, production deployment tooling, a polished
design system, and full authentication/authorization are explicitly
out-of-scope and MUST NOT be built. When time pressure and completeness
conflict, prefer a smaller, fully correct, fully tested slice over a larger,
partially-working one.

Rationale: the brief explicitly rewards a focused, explainable solution over
an unfinished ambitious one, and evaluators are told to penalize overbuilding.

## Technology & Architecture Constraints

- **Language**: TypeScript on both backend and frontend; no untyped JavaScript
  in application source.
- **Backend runtime**: Node.js with Express; zod (or an equivalent schema
  validator) for boundary input validation; an authorization middleware
  enforcing the API-key requirement; a rate-limiting middleware; a CORS
  middleware with an explicit origin allow-list (Principle V). Prefer the
  framework surface that stays easiest to explain and modify live over one
  with more built-in magic (Principle IV).
- **Backend data access**: PostgreSQL via the `pg` driver. All domain reads go
  through hand-written views/table-returning functions; all domain writes go
  through hand-written PostgreSQL functions; no ORM or query builder
  (Principle VI). Migrations are plain, sequentially numbered `.sql` files
  (schema, functions, views) applied by a minimal custom runner; no
  heavyweight migration framework.
- **Frontend runtime**: the latest stable React release, with TypeScript,
  built with Vite. Shared/reusable stateful logic (API calls, form
  submission/validation state, polling/refetch behavior) MUST be extracted
  into custom hooks rather than duplicated across components. No UI component
  library or design system beyond what is needed to satisfy the Minimal
  Frontend requirement (Principle VII).
- **Repository layout**: monorepo with clearly separated packages/directories
  for backend, frontend, and shared/database concerns (e.g. migrations and any
  types shared across backend/frontend), structured so a reviewer can locate a
  component without a guided tour.
- **Containerization**: the full local stack MUST be runnable via a single
  Docker Compose invocation, covering: the API, PostgreSQL, the frontend, and
  the project's test tooling (a Postman/newman runner service, a Playwright
  runner service, and a k6 runner service) so that unit, integration, E2E, and
  load tests are all runnable through the same one-command local environment
  without additional host-machine setup.
- **Money representation**: integer cents end-to-end, including over the wire
  in API request/response JSON.

## Testing Strategy

Each tool below is scoped to the layer it verifies; none substitutes for
another, and Principle I's minimum coverage list MUST be satisfied primarily
at the unit layer, where the logic actually lives.

- **Unit tests — Jest**: the primary vehicle for Principle I's required
  coverage (proration/rounding, duplicate delivery, wrong-currency rejection,
  balanced ledger writes, hash-chain verification including a tampered case).
  Backend and frontend packages each carry their own Jest suite; frontend
  component tests use React Testing Library conventions.
- **Integration/contract tests — Postman**: collections and environments
  exercise the six REST endpoints (with the required API-key credential) as a
  black-box HTTP client would, including the idempotent-replay and
  duplicate-payment request pairs, run via a Docker Compose newman service
  against the rest of the running local stack.
- **Load/stress tests — k6**: scripted scenarios, run via a Docker Compose k6
  service, targeting the endorsement and payment endpoints to observe
  behavior under concurrent load and under rate limiting; informative for the
  on-call/monitoring note, not a merge-blocking gate given the assessment's
  timebox.
- **UI/E2E tests — Playwright**: run via a Docker Compose Playwright service,
  drives the minimal frontend through the primary flows (apply endorsement,
  record payment, view policy/ledger/history) against the running stack,
  asserting the loading/success/validation-error/server-error states required
  by the frontend spec.

## Development Workflow & Quality Gates

- New financial behavior (endorsement, payment, ledger, or history-chain
  logic) MUST NOT be merged/considered done without the corresponding test(s)
  required by Principle I passing.
- Any deviation from Principles I–VII (e.g., a pragmatic timebox-driven
  shortcut) MUST be called out explicitly in the README's "what I would
  improve with more time" section rather than left silent.
- AI-assisted code is permitted but every submitted line MUST be understood by
  the author well enough to explain and modify it live; the README MUST note
  where AI tools were used and what was manually verified.
- Work is divided across four specialized roles (implemented as Claude Code
  subagents under `.claude/agents/`), each accountable for a distinct
  quality gate:
  - **backend-developer** — Express/TypeScript API, hand-written SQL
    migrations/functions/views, proration/idempotency/ledger logic,
    authorization/rate-limit/CORS middleware, Jest unit tests for backend
    code.
  - **frontend-developer** — React/TypeScript UI, Jest + React Testing
    Library component tests, API integration and the four required UI states.
  - **qa-developer** — owns cross-cutting test coverage: Postman collections/
    environments, k6 load scripts, Playwright E2E specs, and verifying
    Principle I's minimum coverage list is actually met end-to-end.
  - **security-auditor** — reviews changes against Principle V (input
    validation, parameterized SQL, secret handling) and general OWASP-class
    risks before a change is considered done.
  A change touching financial logic MUST pass review from both the owning
  developer role and the security-auditor before it is considered complete.

## Governance

This constitution supersedes ad hoc preference whenever the two conflict.
Amendments require: (1) a stated reason for the change, (2) an update to this
file including the placeholders resolved, and (3) a version bump per the
policy below, recorded in a Sync Impact Report comment at the top of this
file.

**Versioning policy** (semantic versioning applied to governance):
- MAJOR: a principle is removed or redefined in a backward-incompatible way.
- MINOR: a new principle or section is added, or existing guidance is
  materially expanded.
- PATCH: wording, clarification, or typo fixes with no semantic change.

Compliance with this constitution is reviewed at each meaningful checkpoint of
the Spec Kit workflow (`/speckit-plan`'s Constitution Check gate,
`/speckit-analyze`, and `/speckit-implement`). Any complexity or deviation
introduced during planning or implementation MUST be justified against
Principle IV and, if unjustifiable, simplified instead. Use `CLAUDE.md` for
day-to-day runtime development guidance (commands, current project state);
this constitution governs principles, not operational commands.

**Version**: 1.2.0 | **Ratified**: 2026-08-05 | **Last Amended**: 2026-08-05
