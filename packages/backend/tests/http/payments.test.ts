/**
 * T045 [US2]: supertest HTTP-boundary contract test for `POST /api/policies/:policyId/payments`
 * (contracts/rest-api.md endpoint 2) — exercised in-process against the Express app object (no
 * network hop), distinct from Postman's black-box role (research.md "Testing tool wiring").
 * Covers: 200 success shape (incl. `Cache-Control: no-store`), 422 currency-mismatch/invalid-amount
 * shapes, and 401 with no `X-API-Key`. Mirrors `endorsements.test.ts`'s structure for US1.
 */
import request from "supertest";
import { createApp } from "../../src/app";
import { closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY must be set in the test environment (see .env / .env.example)");
}

const app = createApp();

describe("POST /api/policies/:policyId/payments", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("returns 200 with the contract's success shape and Cache-Control: no-store", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "PAY-HTTP-1",
        external_payment_id: "PAY-HTTP-1",
        amount_cents: 12099,
        currency: "USD",
        received_at: "2026-07-03T18:30:00Z",
      });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      external_payment_id: "PAY-HTTP-1",
      policy_id: SEED_POLICY.policy_id,
      amount_cents: 12099,
      status: "applied",
      idempotency_result: "applied",
    });
    expect(typeof response.body.payment_id).toBe("number");
  });

  it("returns 401 with no X-API-Key header", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .send({
        idempotency_key: "PAY-HTTP-401",
        external_payment_id: "PAY-HTTP-401",
        amount_cents: 12099,
        currency: "USD",
        received_at: "2026-07-03T18:30:00Z",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("returns 400 with a validation_error shape for a malformed body", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "PAY-HTTP-400",
        external_payment_id: "PAY-HTTP-400",
        amount_cents: "not-a-number",
        currency: "US",
        // received_at omitted
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(Array.isArray(response.body.details)).toBe(true);
    expect(response.body.details.length).toBeGreaterThan(0);
  });

  it("returns 422 currency_mismatch for a payment in the wrong currency", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "PAY-HTTP-CURRENCY",
        external_payment_id: "PAY-HTTP-CURRENCY",
        amount_cents: 12099,
        currency: "EUR",
        received_at: "2026-07-03T18:30:00Z",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("currency_mismatch");
  });

  it("returns 422 invalid_amount for a non-positive amount", async () => {
    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "PAY-HTTP-AMOUNT",
        external_payment_id: "PAY-HTTP-AMOUNT",
        amount_cents: 0,
        currency: "USD",
        received_at: "2026-07-03T18:30:00Z",
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("invalid_amount");
  });

  it("returns 409 idempotency_conflict for the same key with a different payload", async () => {
    await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "PAY-HTTP-CONFLICT",
        external_payment_id: "PAY-HTTP-CONFLICT",
        amount_cents: 12099,
        currency: "USD",
        received_at: "2026-07-03T18:30:00Z",
      });

    const response = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send({
        idempotency_key: "PAY-HTTP-CONFLICT",
        external_payment_id: "PAY-HTTP-CONFLICT",
        amount_cents: 999900,
        currency: "USD",
        received_at: "2026-07-03T18:30:00Z",
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("idempotency_conflict");
  });

  it("returns 200 with idempotency_result duplicate_ignored on an identical replay", async () => {
    const body = {
      idempotency_key: "PAY-HTTP-REPLAY",
      external_payment_id: "PAY-HTTP-REPLAY",
      amount_cents: 12099,
      currency: "USD",
      received_at: "2026-07-03T18:30:00Z",
    };

    const first = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send(body);

    const second = await request(app)
      .post(`/api/policies/${SEED_POLICY.policy_id}/payments`)
      .set("X-API-Key", API_KEY)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotency_result).toBe("duplicate_ignored");
    expect(second.body.payment_id).toBe(first.body.payment_id);
  });
});
