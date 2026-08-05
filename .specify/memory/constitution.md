<!--
Sync Impact Report
==================
Version change: [TEMPLATE] → 1.0.0 (initial ratification)
Modified principles: n/a (template placeholders replaced with concrete principles)
Added sections:
  - Core Principles: I. Test-Driven Development, II. Financial Integrity
    (Atomicity, Idempotency, Balance), III. Append-Only Auditable History,
    IV. Simplicity & Maintainability (SOLID/KISS/DRY/YAGNI), V. Security by
    Default, VI. Raw SQL & Integer-Cents Money, VII. Scoped, Timeboxed Delivery
  - Technology & Architecture Constraints (stack, monorepo layout, containerization)
  - Development Workflow & Quality Gates
  - Governance
Removed sections: none (template placeholders only)
Deferred items: none — all user-supplied constraints were governance-scoped and
  have been incorporated directly; no non-governance intents were present.
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
access MUST use parameterized queries — string-concatenated SQL is
prohibited. Secrets and connection strings MUST be supplied via environment
variables and MUST NOT be committed to the repository; an `.env.example`
(with no real values) is the required substitute. No card numbers, bank
credentials, or other real payment credentials may be collected, stored, or
logged anywhere in the system, consistent with this project's payment-data-
ingestion-only scope.

Rationale: security defects are non-negotiable regardless of project size, and
this scenario handles financial data where injection or secret leakage has
outsized consequences.

### VI. Raw SQL & Integer-Cents Money

Database access MUST use raw SQL (hand-written migrations and queries) — no
ORM or query builder that hides the schema or generates SQL implicitly. All
monetary values MUST be stored and computed exclusively as integer cents;
floating-point types MUST NOT be used for any monetary quantity at rest, in
transit, or in intermediate calculation. Proration MUST use the specified
deterministic rounding rule (round-half-away-from-zero) applied to integer
inputs only.

Rationale: these are explicit, non-negotiable requirements of the assessment
brief, and floating-point money is a well-known source of silent financial
drift.

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
- **Backend data access**: raw SQL migrations and queries only, no ORM (see
  Principle VI).
- **Repository layout**: monorepo with clearly separated packages/directories
  for backend, frontend, and shared/database concerns (e.g. migrations and any
  types shared across backend/frontend), structured so a reviewer can locate a
  component without a guided tour.
- **Containerization**: the full local stack (API, database, frontend) MUST be
  runnable via Docker, orchestrated with Docker Compose for one-command local
  startup.
- **Money representation**: integer cents end-to-end, including over the wire
  in API request/response JSON.

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

**Version**: 1.0.0 | **Ratified**: 2026-08-05 | **Last Amended**: 2026-08-05
