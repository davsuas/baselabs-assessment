/**
 * T031 [US1]: proration/rounding coverage (constitution Principle I minimum coverage list, FR-003,
 * SC-001). Per tasks.md's note on what "unit test" means here, this calls the real
 * `fn_apply_endorsement` PostgreSQL function (not a reimplementation of the formula in TypeScript)
 * so the test exercises the actual write path, including its integer/BIGINT-only arithmetic
 * (constitution Principle VI — no numeric/float/double precision anywhere in the calculation).
 *
 * Formula under test (business-rules.txt / data-model.md):
 *   term_days = term_end - term_start
 *   remaining_days = term_end - effective_date
 *   delta_cents = round_half_away_from_0((new - old) * remaining_days / term_days)
 *
 * Seeded POL-1001: term_start 2026-01-01, term_end 2027-01-01 (term_days = 365),
 * annual_premium_cents = 120000 (db/migrations/010_seed_data.sql).
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

async function applyEndorsement(idempotencyKey: string, effectiveDate: string, newPremiumCents: number) {
  const result = await pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    effectiveDate,
    newPremiumCents,
    "test reason",
  ]);
  return result.rows[0];
}

describe("fn_apply_endorsement proration/rounding", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("matches the documented 12099 example (120000 -> 144000, effective 2026-07-01)", async () => {
    // remaining_days = 2027-01-01 - 2026-07-01 = 184; term_days = 365
    // delta = round_half_away_from_0((144000-120000) * 184 / 365) = round(4416000/365) = round(12098.63...) = 12099
    const row = await applyEndorsement("END-PRORATION-1", "2026-07-01", 144000);

    expect(Number(row.billing_document_amount_cents)).toBe(12099);
    expect(row.billing_document_type).toBe("endorsement_adjustment");
    expect(row.billing_document_status).toBe("posted");
    expect(Number(row.annual_premium_cents)).toBe(144000);
    expect(row.idempotency_result).toBe("applied");
  });

  it("produces a zero delta when the new premium equals the current premium", async () => {
    const row = await applyEndorsement(
      "END-PRORATION-ZERO",
      "2026-07-01",
      SEED_POLICY.annual_premium_cents,
    );

    expect(Number(row.billing_document_amount_cents)).toBe(0);
    expect(Number(row.annual_premium_cents)).toBe(SEED_POLICY.annual_premium_cents);
  });

  it("produces a negative delta for a premium decrease (round-half-away-from-zero on a negative value)", async () => {
    // delta = round_half_away_from_0((100000-120000) * 184 / 365) = round(-3680000/365) = round(-10082.19...) = -10082
    const row = await applyEndorsement("END-PRORATION-NEG", "2026-07-01", 100000);

    expect(Number(row.billing_document_amount_cents)).toBe(-10082);
    expect(Number(row.annual_premium_cents)).toBe(100000);
  });
});
