# Policy Billing & Ledger Core

A focused slice of a homeowners-insurance Policy Administration System: mid-term endorsements with
deterministic prorated billing, received-payment ingestion, a balanced double-entry ledger, and an
append-only hash-chained policy history. Built per `docs/assessment.md` and the full Spec Kit design
in `docs/BLAB-001-policy-billing-core/` (spec, plan, research, data model, API contract).

## How to run it

```bash
cp .env.example .env        # fill in local values (any strings — this is a local-only tool)
docker compose up --build   # db -> migrate -> backend -> frontend
```

- Backend: `http://localhost:3000` (all routes under `/api`, require `X-API-Key: <API_KEY from .env>`)
- Frontend: `http://localhost:5173` (a policy view for the seeded `POL-1001`)
- The `db` service seeds `POL-1001` automatically via `db/migrations/010_seed_data.sql` on first boot.

Test-runner services are Compose *profiles* — they never start on a plain `docker compose up`:

```bash
docker compose --profile test-integration run --rm newman     # Postman/newman contract tests
docker compose --profile test-e2e run --rm playwright         # Playwright UI E2E
docker compose --profile test-load run --rm k6                # k6 load smoke test (endorsements)
docker compose --profile test-load run --rm --entrypoint k6 k6 run /scripts/payment-load.js
```

Unit tests run against a real Postgres instance (not mocked), so bring `db` up first, then from the
repo root:

```bash
npm run test --workspace packages/backend    # Jest + supertest, against the running db
npm run test --workspace packages/frontend   # Jest + React Testing Library
```

See `docs/BLAB-001-policy-billing-core/quickstart.md` for a full section-by-section walkthrough
(boot, each endpoint by hand with curl, the Postman/Playwright/k6 runs, and the hash-chain-tamper
demo), verified against the actual running system.

## API design

Five authenticated REST endpoints under `/api`, full contract in
`docs/BLAB-001-policy-billing-core/contracts/rest-api.md`:

| Method & path | Purpose |
|---|---|
| `POST /policies/:policyId/endorsements` | Apply a mid-term endorsement, prorate the premium delta, post one billing document + one ledger transaction. Idempotent. |
| `POST /policies/:policyId/payments` | Ingest a normalized received-payment record, post a balanced ledger transaction. Idempotent, rejects wrong currency. |
| `GET /policies/:policyId` | Policy state, billing documents, payments, open balance, history-verification status, plain-English summary. |
| `GET /policies/:policyId/ledger` | Ledger transactions/entries proving the books balance. |
| `GET /policies/:policyId/history/verify` | Recomputes and verifies the append-only hash chain. |

Cross-cutting behavior on every route: `X-API-Key` required (401 if missing/wrong), per-key rate
limiting (429 with `retry_after_seconds`), CORS restricted to one configured origin (no wildcard),
`400`/`404`/`409`/`422`/`500` error shapes as documented in the contract, mutation routes send
`Cache-Control: no-store`, read routes support `ETag`/`If-None-Match` conditional `GET` (`304` on a
match).

## SQL schema

Raw SQL migrations in `db/migrations/`, applied in order by a ~100-line custom runner
(`db/migrate.ts`, tracked in a `schema_migrations` table) — no migration framework, no ORM anywhere
in the stack. Full schema/rationale in `docs/BLAB-001-policy-billing-core/data-model.md`.

**Tables**: `policies`, `policy_events` (append-only, hash-chained), `billing_documents`, `payments`,
`ledger_transactions`, `ledger_entries`. All money columns are `BIGINT` cents — never `float`/`real`.

**The only way application code touches these tables** is through hand-written functions and views
(constitution Principle VI — no ad-hoc SQL in `packages/backend/src/`, only parameterized calls in
`repository.ts`):

- `fn_apply_endorsement(...)` / `fn_record_payment(...)` — each is a single PL/pgSQL function call,
  i.e. one implicit transaction. Validates business rules against live DB state, computes the
  prorated delta or validates currency/amount, writes one hash-chained `policy_events` row + one
  domain row (billing document / payment) + one balanced ledger transaction, all-or-nothing.
- `fn_verify_policy_history(policyId)` — recomputes the hash chain in event order using the exact
  same `sha256(payload || previous_hash)` expression the write functions use, returns
  `valid` / `event_count` / `first_broken_event_id`.
- `v_policy_summary`, `v_policy_billing_documents`, `v_policy_payments`, `v_ledger_summary` — the
  read side. `open_balance_cents` is never a stored column; it's always computed from
  `ledger_entries` for the `premium_receivable` account, so the ledger is the single source of
  truth and can't drift out of sync with a cached balance.
- `009_grants.sql` creates a least-privileged `app_user` role and **revokes `UPDATE`/`DELETE`** on
  `policy_events`, `ledger_transactions`, `ledger_entries` — append-only is enforced structurally by
  Postgres grants, not just by convention. A deferred `CONSTRAINT TRIGGER` on `ledger_entries` also
  rejects an unbalanced transaction at `COMMIT` as defense-in-depth on top of the function logic.

## Business rules

- **Proration** (`fn_apply_endorsement`): integer-only,
  `delta_cents = round_half_away_from_0((new_premium - old_premium) * remaining_days / term_days)`,
  `remaining_days = term_end - effective_date`, `term_days = term_end - term_start`. Handles
  premium increases, decreases (negative delta), and zero-delta. `effective_date` must fall within
  `[term_start, term_end]` and the policy must be `active`, or the request is rejected with zero
  side effects.
- **Idempotency**: every mutation carries an `idempotency_key`, scoped per `(policy_id,
  operation_type)` at the DB level via a `UNIQUE` constraint. Same key + same payload → the
  original result is returned (`idempotency_result: "duplicate_ignored"`), no new rows. Same key +
  different payload → `409 idempotency_conflict`, never a silent overwrite.
- **Ledger effects**: positive premium delta → DR Premium Receivable / CR Written Premium; payment
  received → DR Cash / CR Premium Receivable. Every transaction's debits equal its credits, checked
  by the writing function and re-checked by a deferred trigger.
- **Currency**: a payment's currency must equal the policy's currency or it's rejected
  (`422 currency_mismatch`) atomically — no partial persistence.
- **Append-only history**: every accepted mutation writes one `policy_events` row whose
  `event_hash = sha256(payload_canonical || previous_hash)`. Rows are never edited or deleted;
  corrections are new events. `GET /history/verify` recomputes the chain and reports the first
  broken link, if any.

## Where AI was used

This entire feature — spec, plan, task breakdown, and implementation — was built with Claude Code
via the Spec Kit workflow (`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks`
→ `/speckit-implement`), following a ratified project constitution
(`.specify/memory/constitution.md`) that encodes the non-negotiable rules (TDD, financial integrity,
append-only history, raw SQL only, security-by-default, scope discipline). Four specialized
subagents (`.claude/agents/`) divided the implementation: `backend-developer` (API, SQL functions,
financial logic), `frontend-developer` (React UI, hooks), `qa-developer` (Postman/Playwright/k6),
`security-auditor` (a dedicated review gate on every backend change, plus a final pass).

TDD was enforced throughout: every test file was written and run to confirm it failed for the right
reason before its implementation existed, not written after the fact. What a human manually verified
rather than took on faith: every phase's checkpoint was actually executed against a live
Docker Compose stack (not just "tests pass in isolation") — `docker compose up --build` booting
cleanly, curl round-trips against every endpoint, the canonical bill-12099/pay-12099/balance-0
example from `docs/assessment.md` reproduced exactly against a freshly-seeded policy, the hash-chain
tamper scenario demonstrated with a privileged DB role, and the rate limiter observed actually
engaging under k6 load (100 requests accepted, then real `429`s). Two real bugs were found and fixed
during this manual verification, not just written and assumed correct: a Docker-network `baseUrl`
issue that broke the containerized Postman run, and a `postman/newman` auth-override quirk that let
an "unauthorized" test pass for the wrong reason (it wasn't actually being sent without a key).

## What I'd improve with more time

- **Payment-to-invoice allocation**: `billing_documents.status` doesn't track which specific payment
  paid which specific invoice — only a policy-level `open_balance_cents`. Matches spec.md's actual
  requirement, but real FIFO/allocation logic would be the next feature.
- **`VITE_API_KEY` ships the API key into the frontend bundle.** Justified by this being a single
  trusted operator's own local client (spec.md's explicit scope, no multi-tenant/public-facing
  concern) — but is exactly the kind of shortcut that can't survive contact with a real product.
- **The rate limiter is a single shared in-memory store, keyed per API key** — and this system has
  exactly one API key for the whole app (frontend + any scripts). A burst of traffic (or a
  misbehaving retry loop) exhausts the shared budget for every caller, including the human operator,
  until the window clears. A real deployment needs either per-client keys or a smarter limiter.
  It also resets silently on a backend restart (in-memory, not Redis-backed).
- **`vite`/`esbuild` dev-server advisories** (`npm audit`, frontend devDependency only, not shipped
  in any production path): no patch/minor fix exists on the 5.x line; the real fix is a major bump
  to `vite@6.4.3+` or `8.x`, deferred here to avoid an unreviewed breaking change under a timebox.
- **Frontend timezone handling**: the payment form's `received_at` field naively appends `:00Z` to a
  `datetime-local` value rather than converting from the browser's actual offset.
- **Timeline ordering**: billing documents/payments/ledger rows render in API order (newest-first),
  not client-sorted by an explicit timestamp field, since the current response shapes don't carry
  one per row.
- **Test-DB isolation**: the backend Jest suite truncates the same policy row the running Compose
  stack uses (both point at the same local Postgres by default) — fine for this assessment's
  single-environment scope, but a real setup would give tests their own database.

## On-call / monitoring note

**What to watch**: the two mutation endpoints' `429` rate (rate limiter engaging under real load is
expected and by design — it kicked in cleanly and correctly under a k6 burst test at exactly the
configured `RATE_LIMIT_MAX_REQUESTS` threshold, with no errors or latency degradation beyond that),
`GET /history/verify`'s `valid` field on every seeded/critical policy (a `false` here means someone
bypassed the app's DB role and directly mutated `policy_events`/ledger tables — should never happen
in normal operation and is a signal worth paging on), and `GET /ledger`'s `balanced` field (should
always be `true`; the deferred constraint trigger makes an unbalanced commit structurally impossible,
so seeing `false` would mean that trigger itself was bypassed or dropped).

**Recovery**: because every mutation is a single atomic PostgreSQL function call, there is no
"partially applied" state to clean up after a crash mid-request — either the whole endorsement/
payment landed (event + domain row + balanced ledger entries, all together) or none of it did. If a
client's retry after a timeout produces a `409 idempotency_conflict` instead of a clean replay, that
means the retried payload didn't byte-for-byte match the original — the fix is operator
investigation of what actually changed between attempts, not a DB repair. There is no `UPDATE`/
`DELETE` path for `policy_events` or ledger tables at all (even for on-call use) — a correction is
always a new event, never an edit, which is what makes `history/verify` trustworthy as an audit tool
in the first place.

**Known operational limit to plan around**: since there's one shared API key and the rate limiter is
per-key (not per-caller), a runaway script or retry storm from *any* one client throttles every other
client, including the frontend, until the window clears (see "what I'd improve" above). If this were
running for real, splitting the key or moving the limiter to a per-source-IP or per-session scheme
would be the first thing to fix before it caused a real incident.

## Explicitly out of scope

No real payment-provider integration (Stripe/PayPal/bank/webhooks), no card/bank credential
collection anywhere in the schema or UI, no production deployment target, no polished design system,
no full multi-user auth system (single static API key by design), no broader PAS beyond this
workflow.
