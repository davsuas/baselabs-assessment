# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains no application code — only the take-home assessment brief
(`docs/assessment.md`) and a Spec Kit scaffold (`.specify/`, `.claude/skills/speckit-*`). There is no
`package.json`, no source tree, and no chosen stack yet. The first substantive work in this repo is
building the project described below from scratch.

Once a project is scaffolded, update this file with real build/lint/test/run commands — do not leave
this section stale.

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

policies, policy events, billing documents, payments, ledger transactions, ledger entries.

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

`.specify/memory/constitution.md` is still the unfilled template — run `speckit-constitution` (or fill it
manually) before relying on it for project principles.
