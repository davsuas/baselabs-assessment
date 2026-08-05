/**
 * T034 [US1]: supertest HTTP-boundary contract test for `POST /api/policies/:policyId/endorsements`
 * (contracts/rest-api.md endpoint 1) — exercised in-process against the Express app object (no
 * network hop), distinct from Postman's black-box role (research.md "Testing tool wiring").
 * Covers: 200 success shape (incl. `Cache-Control: no-store`), 400 malformed-body validation shape,
 * 422 business-rule rejection shapes, 409 idempotency-conflict shape, and 401 with no `X-API-Key`.
 */
import request from "supertest";
import { createApp } from "../../src/app";
import { closeTestPools, truncateDomainTables, upsertTestPolicy, SEED_POLICY } from "../helpers/db";

const API_KEY = process.env.API_KEY;
const CANCELLED_POLICY_ID = "POL-HTTP-CANCELLED-1";

if (!API_KEY) {
  throw new Error("API_KEY must be set in the test environment (see .env / .env.example)");
}

const app = createApp();

describe("POST /api/policies/:policyId/endorsements", () => {
  beforeEach(async () => {
    await truncateDomainTables();
    await upsertTestPolicy({
      policy_id: CANCELLED_POLICY_ID,
      homeowner_id: "HOME-HTTP-1",
      status: "cancelled",
      term_start: "2026-01-01",
      term_end: "2027-01-01",
      annual_premium_cents: 100000,
      currency: "USD",
    });
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("returns 200 with the contract's success shape and Cache-Control: no-store", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "END-HTTP-1",
        effective_date: "2026-07-01",
        new_annual_premium_cents: 144000,
        reason: "Water-shutoff discount removed",
      });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      endorsement_id: "END-HTTP-1",
      policy_id: SEED_POLICY.policy_id,
      annual_premium_cents: 144000,
      billing_document: {
        type: "endorsement_adjustment",
        amount_cents: 12099,
        status: "posted",
      },
      idempotency_result: "applied",
    });
    expect(typeof response.body.billing_document.id).toBe("number");
  });

  it("returns 401 with no X-API-Key header", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .send({
        idempotency_key: "END-HTTP-401",
        effective_date: "2026-07-01",
        new_annual_premium_cents: 144000,
        reason: "should be rejected before validation even runs",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("returns 400 with a validation_error shape for a malformed body", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "END-HTTP-400",
        effective_date: "not-a-date",
        new_annual_premium_cents: -5,
        // reason omitted
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(Array.isArray(response.body.details)).toBe(true);
    expect(response.body.details.length).toBeGreaterThan(0);
  });

  it("returns 422 policy_not_active for an inactive policy", async () => {
    const response = await request(app)
      .post(`/api/policies/${CANCELLED_POLICY_ID}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "END-HTTP-INACTIVE",
        effective_date: "2026-07-01",
        new_annual_premium_cents: 120000,
        reason: "should be rejected",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("policy_not_active");
  });

  it("returns 422 effective_date_out_of_term for a date outside the policy term", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "END-HTTP-OUTOFTERM",
        effective_date: "2027-06-01",
        new_annual_premium_cents: 144000,
        reason: "should be rejected",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("effective_date_out_of_term");
  });

  it("returns 409 idempotency_conflict for the same key with a different payload", async () => {
    await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "END-HTTP-CONFLICT",
        effective_date: "2026-07-01",
        new_annual_premium_cents: 144000,
        reason: "original",
      });

    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "END-HTTP-CONFLICT",
        effective_date: "2026-07-01",
        new_annual_premium_cents: 999900,
        reason: "different",
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("idempotency_conflict");
  });

  it("returns 200 with idempotency_result duplicate_ignored on an identical replay", async () => {
    const body = {
      idempotency_key: "END-HTTP-REPLAY",
      effective_date: "2026-07-01",
      new_annual_premium_cents: 144000,
      reason: "same payload both times",
    };

    const first = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send(body);

    const second = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/endorsements`)
      .set("X-API-Key", API_KEY)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotency_result).toBe("duplicate_ignored");
    expect(second.body.billing_document.id).toBe(first.body.billing_document.id);
  });
});
