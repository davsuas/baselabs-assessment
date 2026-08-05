/**
 * T033 [US1]: business-rule validation coverage (FR-002, spec.md Acceptance Scenarios 4-5) against
 * the real `fn_apply_endorsement` function — inactive-policy and effective-date-outside-term
 * rejections, both asserted to have zero side effects (no policy_event/billing_document/ledger rows
 * on failure — data-model.md: "a rejected request ... never reaches an INSERT").
 */
import { pool, closeTestPools, truncateDomainTables, upsertTestPolicy, SEED_POLICY } from "../helpers/db";

async function countDomainRows() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM policy_events)::int      AS events,
      (SELECT COUNT(*) FROM billing_documents)::int  AS billing_documents,
      (SELECT COUNT(*) FROM ledger_transactions)::int AS ledger_transactions,
      (SELECT COUNT(*) FROM ledger_entries)::int      AS ledger_entries
  `);
  return result.rows[0];
}

const CANCELLED_POLICY_ID = "POL-CANCELLED-1";

/** Runs a query expected to fail and returns the thrown error's Postgres SQLSTATE (`err.code`). */
async function expectRejectionCode(queryPromise: Promise<unknown>): Promise<string | undefined> {
  try {
    await queryPromise;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  throw new Error("expected the query to reject, but it resolved");
}

describe("fn_apply_endorsement validation", () => {
  beforeEach(async () => {
    await truncateDomainTables();
    await upsertTestPolicy({
      policy_id: CANCELLED_POLICY_ID,
      homeowner_id: "HOME-999",
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

  it("rejects an endorsement on an inactive policy (BLB02) with no side effects", async () => {
    const before = await countDomainRows();

    const code = await expectRejectionCode(
      pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
        CANCELLED_POLICY_ID,
        "END-INACTIVE-1",
        "2026-07-01",
        120000,
        "should be rejected",
      ]),
    );

    expect(code).toBe("BLB02");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });

  it("rejects an effective_date before the policy term (BLB03) with no side effects", async () => {
    const before = await countDomainRows();

    const code = await expectRejectionCode(
      pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
        SEED_POLICY.policy_id,
        "END-OUTOFTERM-BEFORE",
        "2025-12-31",
        144000,
        "should be rejected",
      ]),
    );

    expect(code).toBe("BLB03");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });

  it("rejects an effective_date after the policy term (BLB03) with no side effects", async () => {
    const before = await countDomainRows();

    const code = await expectRejectionCode(
      pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
        SEED_POLICY.policy_id,
        "END-OUTOFTERM-AFTER",
        "2027-01-02",
        144000,
        "should be rejected",
      ]),
    );

    expect(code).toBe("BLB03");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });
});
