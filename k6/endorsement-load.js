/**
 * k6 load test: POST /api/policies/:policyId/endorsements (T070).
 *
 * Purpose (constitution Testing Strategy — informative only, NOT a merge gate): generate enough
 * concurrent request volume against a single API key to (a) observe real request latency/error
 * rate for the endorsement write path, and (b) deliberately exceed the configured rate-limit
 * budget (`RATE_LIMIT_MAX_REQUESTS` per `RATE_LIMIT_WINDOW_MS`, default 100/60s, keyed per
 * `X-API-Key` — packages/backend/src/middleware/rateLimit.ts) so 429s actually show up in the
 * results. A real client wouldn't sustain this rate; this is closer to a burst/retry-storm
 * scenario, which is exactly the kind of thing the README's on-call/monitoring note should cover.
 *
 * Idempotency-key mix (per the task's guidance to make load "meaningful" rather than just
 * hammering one endpoint):
 *   - ~85% of iterations use a fresh, unique idempotency_key + varying payload -> real new
 *     billing-document/ledger-transaction writes (the expensive path: proration calc, event-hash
 *     chaining, balanced ledger insert, all inside one DB transaction).
 *   - ~15% of iterations replay one fixed idempotency_key + fixed payload -> exercises the
 *     idempotent-replay fast path (should short-circuit to the stored result, no new writes) under
 *     the same concurrent load as the "real" traffic.
 * Both subsets share the same policy row, so this also surfaces any lock-contention latency from
 * concurrent writers on POL-1001 (worth noting for the monitoring write-up regardless of the
 * rate-limit findings).
 *
 * Run: docker compose --profile test-load run --rm k6
 * (or, to run this script specifically if the default entrypoint changes):
 *   docker compose --profile test-load run --rm --entrypoint k6 k6 run /scripts/endorsement-load.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const API_KEY = __ENV.API_KEY || "local-dev-api-key";
const POLICY_ID = __ENV.POLICY_ID || "POL-1001";

const rateLimited429 = new Counter("rate_limited_429");
const idempotencyConflict409 = new Counter("idempotency_conflict_409");
const accepted200 = new Counter("accepted_200");
const unexpectedStatus = new Rate("unexpected_status");

// Fixed valid dates within POL-1001's seeded term (2026-01-01 .. 2027-01-01) so every request is
// a well-formed, in-term endorsement (contracts/rest-api.md endpoint 1) rather than an unrelated
// 422 skewing the results.
const VALID_EFFECTIVE_DATES = [
  "2026-02-01",
  "2026-04-15",
  "2026-06-01",
  "2026-08-15",
  "2026-10-01",
  "2026-11-15",
];

// Fixed payload reused by the "replay" subset — identical idempotency_key AND payload every time
// is what makes it a valid duplicate-delivery replay (contracts/rest-api.md: same key + same
// payload -> idempotency_result: "duplicate_ignored", not a 409).
const REPLAY_KEY = "END-LOAD-REPLAY-1";
const REPLAY_BODY = JSON.stringify({
  idempotency_key: REPLAY_KEY,
  effective_date: "2026-05-01",
  new_annual_premium_cents: 150000,
  reason: "k6 load test replay case",
});

export const options = {
  scenarios: {
    endorsement_burst: {
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

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };

  const useReplay = Math.random() < 0.15;
  const body = useReplay
    ? REPLAY_BODY
    : JSON.stringify({
        idempotency_key: `END-LOAD-${__VU}-${__ITER}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        effective_date: randomFrom(VALID_EFFECTIVE_DATES),
        // Varying premium so proration math actually differs run-to-run, not just hammering an
        // identical no-op delta.
        new_annual_premium_cents: 100000 + Math.floor(Math.random() * 100000),
        reason: "k6 load test",
      });

  const res = http.post(
    `${BASE_URL}/api/policies/${POLICY_ID}/endorsements`,
    body,
    { headers, tags: { replay: String(useReplay) } }
  );

  if (res.status === 429) {
    rateLimited429.add(1);
  } else if (res.status === 409) {
    idempotencyConflict409.add(1);
  } else if (res.status === 200) {
    accepted200.add(1);
  }

  const ok = check(res, {
    "status is 200, 409, or 429": (r) =>
      r.status === 200 || r.status === 409 || r.status === 429,
  });
  unexpectedStatus.add(!ok);

  sleep(0.3);
}
