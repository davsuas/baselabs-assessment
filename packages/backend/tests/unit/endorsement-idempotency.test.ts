/**
 * T032 [US1]: idempotent-replay and conflicting-payload coverage (constitution Principle I/II,
 * FR-005, FR-006, SC-002) against the real `fn_apply_endorsement` function. Idempotency is
 * database-level (a unique constraint on `(policy_id, operation_type, idempotency_key)` —
 * data-model.md), never an app-level check-then-write, so this test exercises the function
 * directly rather than mocking anything.
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

async function applyEndorsement(idempotencyKey: string, newPremiumCents: number, reason: string) {
  const result = await pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    "2026-07-01",
    newPremiumCents,
    reason,
  ]);
  return result.rows[0];
}

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

describe("fn_apply_endorsement idempotency", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("same key + same payload returns the original result with no new rows", async () => {
    const first = await applyEndorsement("END-IDEMP-1", 144000, "same reason");
    expect(first.idempotency_result).toBe("applied");

    const before = await countDomainRows();

    const second = await applyEndorsement("END-IDEMP-1", 144000, "same reason");

    const after = await countDomainRows();

    expect(second.idempotency_result).toBe("duplicate_ignored");
    expect(Number(second.billing_document_id)).toBe(Number(first.billing_document_id));
    expect(Number(second.billing_document_amount_cents)).toBe(Number(first.billing_document_amount_cents));
    expect(after).toEqual(before);
  });

  it("same key + different payload is rejected (BLB04) with no new rows", async () => {
    await applyEndorsement("END-IDEMP-2", 144000, "original reason");
    const before = await countDomainRows();

    let code: string | undefined;
    try {
      await applyEndorsement("END-IDEMP-2", 999900, "different reason");
    } catch (err) {
      code = (err as { code?: string }).code;
    }

    expect(code).toBe("BLB04");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });

  it("a different idempotency key produces a genuinely new event (not treated as a duplicate)", async () => {
    const first = await applyEndorsement("END-IDEMP-3A", 144000, "reason a");
    const second = await applyEndorsement("END-IDEMP-3B", 150000, "reason b");

    expect(first.idempotency_result).toBe("applied");
    expect(second.idempotency_result).toBe("applied");
    expect(Number(second.billing_document_id)).not.toBe(Number(first.billing_document_id));
  });
});
