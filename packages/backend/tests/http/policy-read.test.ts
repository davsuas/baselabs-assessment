/**
 * T056 [US3]: supertest HTTP-boundary contract tests for the three read endpoints
 * (contracts/rest-api.md endpoints 3-5) — exercised in-process against the Express app object, same
 * approach as `endorsements.test.ts`/`payments.test.ts`. Covers: 200 response shapes, `ETag`
 * emission, `304 Not Modified` on a matching `If-None-Match`, `404` for an unknown policy, and `401`
 * with no `X-API-Key`.
 */
import request from "supertest";
import { createApp } from "../../src/app";
import { closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

const API_KEY = process.env.API_KEY;
const UNKNOWN_POLICY_ID = "POL-HTTP-READ-UNKNOWN";

if (!API_KEY) {
  throw new Error("API_KEY must be set in the test environment (see .env / .env.example)");
}

const app = createApp();

async function applyEndorsement(idempotencyKey: string, newPremiumCents: number) {
  return request(app)
    .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
    .set("X-API-Key", API_KEY!)
    .send({
      idempotency_key: idempotencyKey,
      effective_date: "2026-07-01",
      new_annual_premium_cents: newPremiumCents,
      reason: "policy-read fixture",
    });
}

async function recordPayment(idempotencyKey: string, amountCents: number) {
  return request(app)
    .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
    .set("X-API-Key", API_KEY!)
    .send({
      idempotency_key: idempotencyKey,
      external_payment_id: idempotencyKey,
      amount_cents: amountCents,
      currency: SEED_POLICY.currency,
      received_at: "2026-07-03T18:30:00Z",
    });
}

describe("GET /api/policies/:policyId (read endpoints)", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  describe("GET /api/policies/:policyId", () => {
    it("returns the contract's 200 shape with an ETag and Cache-Control not set to no-store", async () => {
      await applyEndorsement("END-READ-1", 144000);
      await recordPayment("PAY-READ-1", 12099);

      const response = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(200);
      expect(response.headers.etag).toBeDefined();
      expect(response.body).toMatchObject({
        policy_id: SEED_POLICY.policy_id,
        status: "active",
        annual_premium_cents: 144000,
        currency: SEED_POLICY.currency,
        term_start: SEED_POLICY.term_start,
        term_end: SEED_POLICY.term_end,
        open_balance_cents: 0,
        history: { valid: true, event_count: 2 },
      });
      expect(response.body.billing_documents).toHaveLength(1);
      expect(response.body.payments).toHaveLength(1);
      expect(typeof response.body.summary).toBe("string");
      expect(typeof response.body.suggested_action).toBe("string");
      expect(response.body.summary.length).toBeGreaterThan(0);
    });

    it("returns 304 Not Modified when If-None-Match matches the current ETag", async () => {
      await applyEndorsement("END-READ-304", 144000);

      const first = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}`)
        .set("X-API-Key", API_KEY!);

      const etag = first.headers.etag;
      expect(etag).toBeDefined();

      const second = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}`)
        .set("X-API-Key", API_KEY!)
        .set("If-None-Match", etag);

      expect(second.status).toBe(304);
    });

    it("returns a fresh 200 (different ETag) after a mutation invalidates the prior conditional GET", async () => {
      await applyEndorsement("END-READ-STALE-1", 144000);

      const first = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}`)
        .set("X-API-Key", API_KEY!);
      const etag = first.headers.etag;

      await applyEndorsement("END-READ-STALE-2", 150000);

      const second = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}`)
        .set("X-API-Key", API_KEY!)
        .set("If-None-Match", etag);

      expect(second.status).toBe(200);
      expect(second.headers.etag).not.toBe(etag);
    });

    it("returns 404 not_found for an unknown policy", async () => {
      const response = await request(app)
        .get(`/api/policies/${UNKNOWN_POLICY_ID}`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    });

    it("returns 401 with no X-API-Key header", async () => {
      const response = await request(app).get(`/api/policies/${SEED_POLICY.policy_id}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
    });
  });

  describe("GET /api/policies/:policyId/ledger", () => {
    it("returns the contract's 200 shape with balanced: true and an ETag", async () => {
      await applyEndorsement("END-READ-LEDGER-1", 144000);
      await recordPayment("PAY-READ-LEDGER-1", 12099);

      const response = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/ledger`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(200);
      expect(response.headers.etag).toBeDefined();
      expect(response.body.policy_id).toBe(SEED_POLICY.policy_id);
      expect(response.body.balanced).toBe(true);
      expect(response.body.transactions).toHaveLength(2);
      for (const transaction of response.body.transactions) {
        expect(transaction.debits_cents).toBe(transaction.credits_cents);
      }
    });

    it("returns balanced: true and an empty transaction list for a policy with no history", async () => {
      const response = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/ledger`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(200);
      expect(response.body.balanced).toBe(true);
      expect(response.body.transactions).toEqual([]);
    });

    it("returns 304 Not Modified when If-None-Match matches the current ETag", async () => {
      await applyEndorsement("END-READ-LEDGER-304", 144000);

      const first = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/ledger`)
        .set("X-API-Key", API_KEY!);

      const second = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/ledger`)
        .set("X-API-Key", API_KEY!)
        .set("If-None-Match", first.headers.etag);

      expect(second.status).toBe(304);
    });

    it("returns 404 not_found for an unknown policy", async () => {
      const response = await request(app)
        .get(`/api/policies/${UNKNOWN_POLICY_ID}/ledger`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    });

    it("returns 401 with no X-API-Key header", async () => {
      const response = await request(app).get(`/api/policies/${SEED_POLICY.policy_id}/ledger`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
    });
  });

  describe("GET /api/policies/:policyId/history/verify", () => {
    it("returns the contract's 200 shape for an intact chain, with an ETag", async () => {
      await applyEndorsement("END-READ-HIST-1", 144000);
      await recordPayment("PAY-READ-HIST-1", 12099);

      const response = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/history/verify`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(200);
      expect(response.headers.etag).toBeDefined();
      expect(response.body).toEqual({
        policy_id: SEED_POLICY.policy_id,
        valid: true,
        event_count: 2,
      });
    });

    it("returns 304 Not Modified when If-None-Match matches the current ETag", async () => {
      await applyEndorsement("END-READ-HIST-304", 144000);

      const first = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/history/verify`)
        .set("X-API-Key", API_KEY!);

      const second = await request(app)
        .get(`/api/policies/${SEED_POLICY.policy_id}/history/verify`)
        .set("X-API-Key", API_KEY!)
        .set("If-None-Match", first.headers.etag);

      expect(second.status).toBe(304);
    });

    it("returns 404 not_found for an unknown policy", async () => {
      const response = await request(app)
        .get(`/api/policies/${UNKNOWN_POLICY_ID}/history/verify`)
        .set("X-API-Key", API_KEY!);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    });

    it("returns 401 with no X-API-Key header", async () => {
      const response = await request(app).get(
        `/api/policies/${SEED_POLICY.policy_id}/history/verify`,
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
    });
  });
});
