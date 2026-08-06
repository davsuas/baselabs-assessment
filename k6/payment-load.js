/**
 * k6 load test: POST /api/policies/:policyId/payments (T071).
 *
 * Same rationale/design as endorsement-load.js (see that file's header for the full write-up):
 * deliberately bursty concurrent traffic against a single API key, both to observe raw
 * latency/error-rate on the payment write path and to push past the configured rate-limit budget
 * (RATE_LIMIT_MAX_REQUESTS per RATE_LIMIT_WINDOW_MS, default 100/60s, keyed per X-API-Key) so 429s
 * show up for the README's on-call/monitoring note. Not a merge gate.
 *
 * Idempotency-key mix:
 *   - ~85% of iterations: fresh, unique idempotency_key/external_payment_id + fixed valid USD
 *     amount -> real new payment + balanced ledger-transaction writes.
 *   - ~15% of iterations: replay one fixed idempotency_key + identical payload -> exercises the
 *     duplicate-payment-delivery fast path (contracts/rest-api.md: idempotency_result:
 *     "duplicate_ignored") under concurrent load.
 * Wrong-currency rejection (422 currency_mismatch) is deliberately NOT included here — that's a
 * single-request atomicity property already covered by Jest/Postman; mixing it into the load
 * profile would just dilute the throughput/rate-limit signal this script exists to produce.
 *
 * Run: docker compose --profile test-load run --rm k6
 * (or, to run this script specifically if the default entrypoint changes):
 *   docker compose --profile test-load run --rm --entrypoint k6 k6 run /scripts/payment-load.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const API_KEY = __ENV.API_KEY || "local-dev-api-key";
const POLICY_ID = __ENV.POLICY_ID || "POL-1001";

const rateLimited429 = new Counter("rate_limited_429");
const accepted200 = new Counter("accepted_200");
const unexpectedStatus = new Rate("unexpected_status");

const REPLAY_KEY = "PAY-LOAD-REPLAY-1";
const REPLAY_BODY = JSON.stringify({
  idempotency_key: REPLAY_KEY,
  external_payment_id: REPLAY_KEY,
  amount_cents: 5000,
  currency: "USD",
  received_at: "2026-07-05T12:00:00Z",
});

export const options = {
  scenarios: {
    payment_burst: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 10 }, // ramp-up
        { duration: "10s", target: 25 }, // ramp to burst level
        { duration: "20s", target: 25 }, // hold — this is where the per-key budget gets exceeded
        { duration: "5s", target: 0 }, // ramp-down
      ],
      gracefulRampDown: "5s",
    },
  },
  // Informative only (constitution Testing Strategy) — no thresholds that would fail the run.
};

export default function () {
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };

  const useReplay = Math.random() < 0.15;
  let body;
  if (useReplay) {
    body = REPLAY_BODY;
  } else {
    const uniqueId = `PAY-LOAD-${__VU}-${__ITER}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    body = JSON.stringify({
      idempotency_key: uniqueId,
      external_payment_id: uniqueId,
      amount_cents: 1000 + Math.floor(Math.random() * 20000),
      currency: "USD",
      received_at: new Date().toISOString(),
    });
  }

  const res = http.post(
    `${BASE_URL}/api/policies/${POLICY_ID}/payments`,
    body,
    { headers, tags: { replay: String(useReplay) } }
  );

  if (res.status === 429) {
    rateLimited429.add(1);
  } else if (res.status === 200) {
    accepted200.add(1);
  }

  const ok = check(res, {
    "status is 200 or 429": (r) => r.status === 200 || r.status === 429,
  });
  unexpectedStatus.add(!ok);

  sleep(0.3);
}
