# REST API Contract: Policy Billing & Ledger Core

**Feature**: [../spec.md](../spec.md) | **Data model**: [../data-model.md](../data-model.md)

Base path: `/api`. All monetary fields are integer cents (`*_cents`), never floats (Principle VI).
All request/response bodies are JSON.

## Cross-cutting rules (apply to every endpoint below)

- **Auth**: every request MUST include `X-API-Key: <key>`. Missing/invalid key → `401` before any
  other processing (FR-024). Response body: `{ "error": "unauthorized" }`.
- **Rate limiting**: exceeding the configured per-key threshold → `429`. Response body:
  `{ "error": "rate_limited", "retry_after_seconds": <number> }` (FR-025).
- **CORS**: only the configured frontend origin is allowed; other origins receive no
  `Access-Control-Allow-Origin` header and the browser blocks the response.
- **Validation errors** (malformed/missing fields): `400`. Response body:
  `{ "error": "validation_error", "details": [{ "field": string, "message": string }] }`.
- **Not found** (unknown `policyId`): `404`. Response body: `{ "error": "not_found" }`.
- **Idempotency-key conflict** (same key, different payload): `409`. Response body:
  `{ "error": "idempotency_conflict", "message": string }`.
- **Business-rule rejection** (inactive policy, date outside term, currency mismatch, non-positive
  amount): `422`. Response body: `{ "error": <machine-readable reason>, "message": string }`.
- **Server error** (unexpected failure): `500`. Response body: `{ "error": "server_error" }`. Never
  leaks stack traces or raw database errors to the client.

## 1. `POST /api/policies/:policyId/endorsements`

Applies a mid-term endorsement. Backed by `fn_apply_endorsement` (data-model.md).

**Request body**:

```json
{
  "idempotency_key": "END-2001",
  "effective_date": "2026-07-01",
  "new_annual_premium_cents": 144000,
  "reason": "Water-shutoff discount removed"
}
```

**Response `200`** (accepted, whether newly applied or an idempotent replay):

```json
{
  "endorsement_id": "END-2001",
  "policy_id": "POL-1001",
  "annual_premium_cents": 144000,
  "billing_document": {
    "id": 3001,
    "type": "endorsement_adjustment",
    "amount_cents": 12099,
    "status": "posted"
  },
  "idempotency_result": "applied"
}
```

`idempotency_result` is `"applied"` on first acceptance, `"duplicate_ignored"` when the same key +
same payload is replayed (FR-005, SC-002).

**Cache-Control**: `no-store`.

**Specific rejections**: `422` with `error: "policy_not_active"` or `error:
"effective_date_out_of_term"`; `409` with `error: "idempotency_conflict"` for same-key/different-payload
(FR-006).

## 2. `POST /api/policies/:policyId/payments`

Ingests a received-payment record. Backed by `fn_record_payment`.

**Request body**:

```json
{
  "idempotency_key": "PAY-9001",
  "external_payment_id": "PAY-9001",
  "amount_cents": 12099,
  "currency": "USD",
  "received_at": "2026-07-03T18:30:00Z"
}
```

**Response `200`**:

```json
{
  "payment_id": 9001,
  "external_payment_id": "PAY-9001",
  "policy_id": "POL-1001",
  "amount_cents": 12099,
  "status": "applied",
  "idempotency_result": "applied"
}
```

`idempotency_result` follows the same `"applied"` / `"duplicate_ignored"` convention as endorsements
(FR-009, SC-003).

**Cache-Control**: `no-store`.

**Specific rejection**: `422` with `error: "currency_mismatch"` — matches the assessment's documented
`rejected_events` example (`{"id": "PAY-9002", "reason": "currency mismatch"}`); `422` with
`error: "invalid_amount"` for non-positive `amount_cents`.

## 3. `GET /api/policies/:policyId`

Aggregate policy state. Reads from `v_policy_summary`, `v_policy_billing_documents`,
`v_policy_payments`, and `fn_verify_policy_history` (data-model.md).

**Response `200`**:

```json
{
  "policy_id": "POL-1001",
  "status": "active",
  "annual_premium_cents": 144000,
  "currency": "USD",
  "term_start": "2026-01-01",
  "term_end": "2027-01-01",
  "open_balance_cents": 0,
  "billing_documents": [
    { "id": 3001, "type": "endorsement_adjustment", "amount_cents": 12099, "status": "posted" }
  ],
  "payments": [
    { "id": 9001, "external_payment_id": "PAY-9001", "amount_cents": 12099, "status": "applied" }
  ],
  "history": { "valid": true, "event_count": 2 },
  "summary": "Policy POL-1001 is active with an open balance of $0.00.",
  "suggested_action": "No action required"
}
```

`summary`/`suggested_action` satisfy FR-023 and are derived server-side from `open_balance_cents` and
`history.valid` — not left to the frontend to infer.

**Caching**: `ETag` derived from the policy's latest `updated_at`/event-count; supports
`If-None-Match` → `304 Not Modified` (research.md).

## 4. `GET /api/policies/:policyId/ledger`

Reads from `v_ledger_summary`.

**Response `200`**:

```json
{
  "policy_id": "POL-1001",
  "balanced": true,
  "transactions": [
    { "id": 1, "source": "END-2001", "debits_cents": 12099, "credits_cents": 12099 },
    { "id": 2, "source": "PAY-9001", "debits_cents": 12099, "credits_cents": 12099 }
  ]
}
```

`balanced` is `true` only if every transaction's debits equal its credits (SC-005) — computed by the
view, not asserted by the API layer.

**Caching**: same `ETag`/`If-None-Match` pattern as endpoint 3.

## 5. `GET /api/policies/:policyId/history/verify`

Calls `fn_verify_policy_history`.

**Response `200`** (intact chain):

```json
{
  "policy_id": "POL-1001",
  "valid": true,
  "event_count": 2
}
```

**Response `200`** (tampered chain — this is a successful verification *call* that reports an invalid
result, not an error response):

```json
{
  "policy_id": "POL-1001",
  "valid": false,
  "event_count": 2,
  "first_broken_event_id": 2
}
```

**Caching**: same `ETag`/`If-None-Match` pattern as endpoint 3.

## Idempotency-key scoping (research.md, data-model.md)

Idempotency keys are scoped per `(policy_id, operation_type)` at the database level — the same key
value used for an endorsement and a payment on the same policy does not collide (edge case in spec.md).
Clients should still use distinct key values per operation as a matter of good practice; the system
does not depend on them doing so.
