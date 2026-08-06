/**
 * T043 [US2]: idempotent-replay and conflicting-payload coverage (constitution Principle I/II,
 * FR-009, SC-003) against the real `fn_record_payment` function. Idempotency is database-level (a
 * unique constraint on `(policy_id, operation_type, idempotency_key)` — data-model.md), never an
 * app-level check-then-write, so this test exercises the function directly rather than mocking
 * anything. Mirrors `endorsement-idempotency.test.ts`'s structure for US1.
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

async function recordPayment(
  idempotencyKey: string,
  externalPaymentId: string,
  amountCents: number,
  currency: string = SEED_POLICY.currency,
) {
  const result = await pool.query(`SELECT * FROM fn_record_payment($1, $2, $3, $4, $5, $6)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    externalPaymentId,
    amountCents,
    currency,
    "2026-07-03T18:30:00Z",
  ]);
  return result.rows[0];
}

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

describe("fn_record_payment idempotency", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("same key + same payload returns the original result with no new rows or balance effect", async () => {
    const first = await recordPayment("PAY-IDEMP-1", "PAY-IDEMP-1", 12099);
    expect(first.idempotency_result).toBe("applied");

    const before = await countDomainRows();

    const second = await recordPayment("PAY-IDEMP-1", "PAY-IDEMP-1", 12099);

    const after = await countDomainRows();

    expect(second.idempotency_result).toBe("duplicate_ignored");
    expect(Number(second.payment_id)).toBe(Number(first.payment_id));
    expect(Number(second.amount_cents)).toBe(Number(first.amount_cents));
    expect(after).toEqual(before);
  });

  it("same key + different payload is rejected (BLB04) with no new rows", async () => {
    await recordPayment("PAY-IDEMP-2", "PAY-IDEMP-2", 12099);
    const before = await countDomainRows();

    let code: string | undefined;
    try {
      await recordPayment("PAY-IDEMP-2", "PAY-IDEMP-2", 500000);
    } catch (err) {
      code = (err as { code?: string }).code;
    }

    expect(code).toBe("BLB04");
    const after = await countDomainRows();
    expect(after).toEqual(before);
  });

  it("a different idempotency key produces a genuinely new event (not treated as a duplicate)", async () => {
    const first = await recordPayment("PAY-IDEMP-3A", "PAY-IDEMP-3A", 12099);
    const second = await recordPayment("PAY-IDEMP-3B", "PAY-IDEMP-3B", 5000);

    expect(first.idempotency_result).toBe("applied");
    expect(second.idempotency_result).toBe("applied");
    expect(Number(second.payment_id)).not.toBe(Number(first.payment_id));
  });
});
