# Quickstart: Policy Billing & Ledger Core

**Feature**: [spec.md](./spec.md) | **Contract**: [contracts/rest-api.md](./contracts/rest-api.md) |
**Data model**: [data-model.md](./data-model.md)

This validates the feature end-to-end against a running local stack. It does not contain
implementation code — see `tasks.md` (from `/speckit-tasks`) for that.

## Prerequisites

- Docker and Docker Compose.
- A local `.env` at the repo root, copied from `.env.example`, at minimum setting:
  `API_KEY` (any local secret value), `POSTGRES_*` credentials, `CORS_ORIGIN` (the frontend's local
  origin). Never commit `.env` (Principle V).

## 1. Start the core stack

```bash
docker compose up --build
```

Starts, in order: `db` (PostgreSQL) → `migrate` (applies `db/migrations/*.sql`, including the
`fn_apply_endorsement`/`fn_record_payment`/`fn_verify_policy_history` functions and
`v_policy_summary`/`v_ledger_summary` views, then seeds `policy.json` — see data-model.md) → `backend`
→ `frontend`.

**Expected outcome**: `docker compose ps` shows `db` as `healthy` (it has an actual Compose
healthcheck); `backend` and `frontend` show `Up` (neither has a configured healthcheck, so Compose
never reports them as `healthy` even once they're serving traffic — that's expected, not a fault).
Confirm the app tier is actually up with a request rather than reading `Up` alone:
`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/` (expect `200`) and
`curl -s -o /dev/null -w '%{http_code}\n' -H "X-API-Key: <your local API_KEY>" http://localhost:3000/api/policies/POL-1001`
(expect `200`).

## 2. Run unit tests (Jest)

```bash
docker compose run --rm frontend npm test
```

**Backend**: `docker compose run --rm backend npm test` does **not** work — `packages/backend/Dockerfile`
is a hardened multi-stage build (tasks.md T072) whose final `runtime` stage ships only the compiled
`dist/` output + `node_modules`, deliberately dropping `tests/`, `jest.config.ts`, and
`tsconfig.jest.json` from the image (a smaller, source-free production image). Running that command
fails with `No tests found, exiting with code 1`. Backend Jest specs also intentionally run against a
real Postgres instance rather than mocking `pg` (`tests/helpers/db.ts`), so they're designed to run
from the host, not inside the app container. Run them locally instead, with the `db` service up:

```bash
docker compose up -d db
npm install                               # once, at the repo root (npm workspaces)
npm run test --workspace packages/backend
```

`tests/setupEnv.ts` loads the repo-root `.env` automatically, so this uses the same credentials as the
Compose stack, connecting to `localhost:5432` (the port Compose publishes).

**Expected outcome**: all suites pass, including the constitution's required coverage — proration/
rounding, duplicate delivery (endorsements and payments), wrong-currency rejection, balanced ledger
writes, and history-chain verification (intact and deliberately-tampered cases). Both backend and
frontend suites currently pass in full (56 and 42 tests respectively as of this writing).

**Note**: backend Jest specs write to and truncate shared domain tables in whatever `db` they connect
to — the same local dev database the rest of this quickstart uses. Running them leaves `POL-1001` in a
mutated state (e.g. `annual_premium_cents` no longer the seeded `120000`). If you want the exact values
in §6/§7 below to reproduce, reset the database (see the note at the top of §6) before running through
it.

## 3. Run integration/contract tests (Postman / newman)

```bash
docker compose --profile test-integration run --rm newman
```

Runs `postman/collections/policy-billing-core.postman_collection.json` against the `PAS Local`
environment. **Expected outcome**: all requests pass (13 requests, 30 assertions), including the
duplicate-endorsement, conflicting-payload, duplicate-payment, wrong-currency, and unauthorized
scenarios (see the collection's request descriptions for exactly what each one proves).

This requires running against a freshly-seeded `POL-1001` (fresh `docker compose up`, or reset per
§6's note) — the collection's `Apply Endorsement - Success` / `Record Payment - Success` requests
expect a first-application (`idempotency_result: "applied"`), which only holds if `END-2001`/`PAY-9001`
haven't already been used against this policy by an earlier §2, §5, or manual-walkthrough run.

**Two things were fixed here** (both were breaking this command outright, not just doc drift):

- `docker-compose.yml`'s `newman` service now passes `--env-var baseUrl=http://backend:3000`. The
  committed environment file's `baseUrl` (`http://localhost:3000`) is correct for interactive
  Postman/host use, but inside the `newman` container `localhost` is the container itself, not the
  `backend` service — every request failed with `ECONNREFUSED` without this override (same class of
  problem the `frontend`/`playwright` services solve with `VITE_DEV_API_PROXY_TARGET`).
- The collection no longer relies on collection-level `apikey` auth + a request-level `auth` override
  for the "Unauthorized" negative case. Verified directly against `postman/newman:6-alpine`: a
  request-level `auth` of `noauth` (or even a differently-valued `apikey`) does **not** override a
  collection-level `apikey` auth block in this newman version — the collection-level credential is
  sent regardless, silently defeating the 401 test (it was asserting 401 and getting 200). Every
  request in the collection now carries an explicit `X-API-Key: {{apiKey}}` header instead of relying
  on collection-level auth, and the "Unauthorized" request simply omits it.

## 4. Run E2E tests (Playwright)

```bash
docker compose --profile test-e2e run --rm playwright
```

**Expected outcome**: the primary frontend flows pass — 7 specs across `apply-endorsement.spec.ts`,
`record-payment.spec.ts`, and `policy-review.spec.ts`, applying an endorsement and seeing it reflected
in the policy view, recording a payment and seeing the balance update, replaying both idempotently, and
rejecting a conflicting-payload/wrong-currency case.

This suite itself only directly observes two of the four required UI states — **success** and
**validation error** — via explicit `toBeVisible()` assertions. **Loading** is not asserted (Playwright's
auto-waiting locators pass through it without a dedicated check) and **server error** is only ever
asserted absent (`toHaveCount(0)`) on the happy paths, never actually triggered. All four states,
including loading and server error, are covered — with explicit assertions — by the frontend Jest/RTL
suite instead (§2: `PolicyPage.test.tsx`, `EndorsementForm.test.tsx`, `PaymentForm.test.tsx`). Together,
§2 (frontend Jest) + §4 (Playwright) is where all four states are demonstrated; §4 alone is not.

## 5. Run load/stress tests (k6)

```bash
docker compose --profile test-load run --rm k6
```

This runs `k6/endorsement-load.js` only — that's the `k6` service's default entrypoint in
`docker-compose.yml`. To also exercise the payment endpoint (`k6/payment-load.js`), override the
entrypoint explicitly:

```bash
docker compose --profile test-load run --rm --entrypoint k6 k6 run /scripts/payment-load.js
```

Run both if you want the "endorsement and payment endpoints" coverage the original single command
implied — one command alone only covers endorsements.

**Expected outcome**: a k6 summary report (not a pass/fail gate — see constitution Testing Strategy)
showing request latency/error-rate under concurrent load against the endorsement and payment endpoints,
including observing the rate limiter engaging once the configured threshold is exceeded. Use this output
for the README's on-call/monitoring note.

**Observed** (default `.env` — `RATE_LIMIT_MAX_REQUESTS=100` / `RATE_LIMIT_WINDOW_MS=60000`, single
shared `X-API-Key`, 25 VUs sustained): each 40s script run produced ~2,500 requests, of which exactly
100 were accepted (`200`) and the remaining ~96% were `429 rate_limited` — the limiter engages hard and
fast under this profile, well within the 60s window, with accepted-request p95 latency ~5-9ms. Worth
flagging for the README's on-call note: a single leaked/shared API key throttles almost all real traffic
during a burst, since the limit isn't scoped any more finely than per-key.

**Both k6 runs mutate `POL-1001`** (the accepted, non-rate-limited requests are real writes) — reset
per §6's note if you need a clean policy afterward.

## 6. Manual validation walkthrough (matches spec.md's acceptance scenarios)

All requests need `X-API-Key: <your local API_KEY>`. Full request/response shapes are in
[contracts/rest-api.md](./contracts/rest-api.md) — commands below are illustrative, not exhaustive.

**Reset first if you've already run §2 (backend Jest), §3 (Postman), or §5 (k6) against this stack.**
There is one shared local `db`, not an isolated database per test tool, and all four of §2/§3/§5/§6 act
on the same `POL-1001` row using overlapping idempotency keys (`END-2001`/`PAY-9001`/`PAY-9002`, chosen
to match the Postman environment and docs/assessment.md's example on purpose). Running them back-to-back
without a reset means this section's first endorsement call is a `duplicate_ignored` replay instead of a
fresh `applied`, and the proration math no longer lands on `12099` because `annual_premium_cents` is no
longer the seeded `120000`. To get a clean, exactly-reproducible run (this is also how to reproduce
docs/assessment.md's expected-output example verbatim):

```bash
docker compose down
docker volume rm policy-billing-core_pgdata
docker compose up -d
```

Verified end-to-end against a freshly-seeded `POL-1001`: every value below (`12099`, `applied` →
`duplicate_ignored` → `409`, `422 currency_mismatch`, `open_balance_cents: 0`, `history.valid: true`,
`event_count: 2`, both ledger transactions balanced) reproduces exactly as documented.

```bash
BASE=http://localhost:3000/api
KEY="<your local API_KEY>"

# User Story 1 (P1): apply an endorsement, then replay it (idempotent), then conflict it.
curl -s -X POST "$BASE/policies/POL-1001/endorsements" -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"END-2001","effective_date":"2026-07-01","new_annual_premium_cents":144000,"reason":"Water-shutoff discount removed"}'
# Expect: 200, billing_document.amount_cents == 12099, idempotency_result == "applied"

curl -s -X POST "$BASE/policies/POL-1001/endorsements" -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"END-2001","effective_date":"2026-07-01","new_annual_premium_cents":144000,"reason":"Water-shutoff discount removed"}'
# Expect: 200, idempotency_result == "duplicate_ignored", same billing_document.id as above

curl -s -X POST "$BASE/policies/POL-1001/endorsements" -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"END-2001","effective_date":"2026-07-01","new_annual_premium_cents":999900,"reason":"different"}'
# Expect: 409, error == "idempotency_conflict"

# User Story 2 (P2): record a payment, replay it, then submit the wrong-currency sample (rejected-path example).
curl -s -X POST "$BASE/policies/POL-1001/payments" -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"PAY-9001","external_payment_id":"PAY-9001","amount_cents":12099,"currency":"USD","received_at":"2026-07-03T18:30:00Z"}'
# Expect: 200, idempotency_result == "applied"

curl -s -X POST "$BASE/policies/POL-1001/payments" -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"PAY-9002","external_payment_id":"PAY-9002","amount_cents":5000,"currency":"EUR","received_at":"2026-07-04T10:00:00Z"}'
# Expect: 422, error == "currency_mismatch" — the failure-path example for the video walkthrough

# User Story 3 (P3): review state, ledger, and history.
curl -s "$BASE/policies/POL-1001" -H "X-API-Key: $KEY"
# Expect: open_balance_cents == 0 (12099 billed - 12099 paid), history.valid == true

curl -s "$BASE/policies/POL-1001/ledger" -H "X-API-Key: $KEY"
# Expect: balanced == true, two transactions each with equal debits_cents/credits_cents

curl -s "$BASE/policies/POL-1001/history/verify" -H "X-API-Key: $KEY"
# Expect: valid == true, event_count == 2

# Auth/rate-limit edge cases (FR-024, FR-025)
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/policies/POL-1001"
# Expect: 401 (no X-API-Key header)
```

## 7. Simulating a tampered chain (for the "history invalid" case)

Because `policy_events` grants no `UPDATE`/`DELETE` to the application role (data-model.md), producing
a tampered-chain example requires connecting directly as a superuser/migration role and altering one
event's `payload_canonical` or `event_hash`, then re-running step 6's history/verify call and observing
`valid: false`. This is the scenario the backend Jest suite covers directly (step 2) since it needs
privileged DB access that the application itself intentionally never has.

Verified working example (run after §6, against the two seeded events):

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "UPDATE policy_events SET payload_canonical = payload_canonical || 'TAMPERED' WHERE policy_id='POL-1001' AND id=2;"

curl -s "$BASE/policies/POL-1001/history/verify" -H "X-API-Key: $KEY"
# Expect: {"policy_id":"POL-1001","valid":false,"event_count":2,"first_broken_event_id":2}
```

`GET /api/policies/POL-1001` also reflects this: `history.valid: false` and both `summary` and
`suggested_action` switch to a distinct tamper-warning wording (not the "No action required" happy
path) — confirmed matches the server-derived-messaging intent in contracts/rest-api.md endpoint 3.
