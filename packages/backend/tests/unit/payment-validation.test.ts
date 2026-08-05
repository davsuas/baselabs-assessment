/**
 * T042 [US2]: business-rule validation coverage (FR-008, SC-004) against the real
 * `fn_record_payment` function — currency-mismatch and non-positive-amount rejections, both
 * asserted to have zero side effects (no policy_event/payment/ledger rows on failure —
 * data-model.md: "a rejected request ... never reaches an INSERT"). Mirrors
 * `endorsement-validation.test.ts`'s structure for US1.
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

async function countDomainRows() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM policy_events)::int       AS events,
      (SELECT COUNT(*) FROM payments)::int             AS payments,
      (SELECT COUNT(*) FROM ledger_transactions)::int  AS ledger_transactions,
      (SELECT COUNT(*) FROM ledger_entries)::int       AS ledger_entries
  `);
  return result.rows[0];
}

/** Runs a query expected to fail and returns the thrown error's Postgres SQLSTATE (`err.code`). */
async function expectRejectionCode(queryPromise: Promise<unknown>): Promise<string | undefined> {
  try {
    await queryPromise;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  throw new Error("expected the query to reject, but it resolved");
}

async function recordPayment(
  idempotencyKey: string,
  externalPaymentId: string,
  amountCents: number,
  currency: string,
) {
  return pool.query(`SELECT * FROM fn_record_payment($1, $2, $3, $4, $5, $6)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    externalPaymentId,
    amountCents,
    currency,
    "2026-07-03T18:30:00Z",
  ]);
}

describe("fn_record_payment validation", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("rejects a currency mismatch (BLB05) with no side effects", async () => {
    const before = await countDomainRows();

    const code = await expectRejectionCode(
      recordPayment("PAY-CURRENCY-1", "PAY-CURRENCY-1", 12099, "EUR"),
    );

    expect(code).toBe("BLB05");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });

  it("rejects a zero amount (BLB06) with no side effects", async () => {
    const before = await countDomainRows();

    const code = await expectRejectionCode(
      recordPayment("PAY-ZERO-1", "PAY-ZERO-1", 0, SEED_POLICY.currency),
    );

    expect(code).toBe("BLB06");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });

  it("rejects a negative amount (BLB06) with no side effects", async () => {
    const before = await countDomainRows();

    const code = await expectRejectionCode(
      recordPayment("PAY-NEGATIVE-1", "PAY-NEGATIVE-1", -500, SEED_POLICY.currency),
    );

    expect(code).toBe("BLB06");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });
});
