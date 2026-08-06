/**
 * T053 [US3]: history-chain verification coverage (constitution Principle III/I, FR-015, spec.md
 * Acceptance Scenario 4) against the real `fn_verify_policy_history` function. An intact chain must
 * report `valid: true`; a chain tampered directly at the database level (bypassing `app_user`'s
 * revoked UPDATE grant on `policy_events` via the privileged `adminPool` — see
 * `tests/helpers/db.ts` and quickstart.md §7) must report `valid: false` with the exact event id
 * where the break was first detected.
 */
import {
  pool,
  adminPool,
  closeTestPools,
  truncateDomainTables,
  SEED_POLICY,
} from "../helpers/db";

interface VerifyHistoryRow {
  policy_id: string;
  valid: boolean;
  event_count: string;
  first_broken_event_id: string | null;
}

async function verifyPolicyHistory(policyId: string): Promise<VerifyHistoryRow> {
  const result = await pool.query<VerifyHistoryRow>(
    `SELECT * FROM fn_verify_policy_history($1)`,
    [policyId],
  );
  return result.rows[0];
}

async function applyEndorsement(idempotencyKey: string, newPremiumCents: number) {
  const result = await pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    "2026-07-01",
    newPremiumCents,
    "history verification fixture",
  ]);
  return result.rows[0];
}

async function recordPayment(idempotencyKey: string, externalPaymentId: string, amountCents: number) {
  const result = await pool.query(`SELECT * FROM fn_record_payment($1, $2, $3, $4, $5, $6)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    externalPaymentId,
    amountCents,
    SEED_POLICY.currency,
    "2026-07-03T18:30:00Z",
  ]);
  return result.rows[0];
}

describe("fn_verify_policy_history", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("reports valid: true and the correct event_count for an intact chain", async () => {
    await applyEndorsement("END-HIST-1", 144000);
    await recordPayment("PAY-HIST-1", "PAY-HIST-1", 12099);

    const result = await verifyPolicyHistory(SEED_POLICY.policy_id);

    expect(result.valid).toBe(true);
    expect(Number(result.event_count)).toBe(2);
    expect(result.first_broken_event_id).toBeNull();
  });

  it("reports valid: true with event_count 0 for a policy with no events yet", async () => {
    const result = await verifyPolicyHistory(SEED_POLICY.policy_id);

    expect(result.valid).toBe(true);
    expect(Number(result.event_count)).toBe(0);
    expect(result.first_broken_event_id).toBeNull();
  });

  it("reports valid: false with the tampered event's id after a privileged direct mutation", async () => {
    await applyEndorsement("END-HIST-2", 144000);
    await recordPayment("PAY-HIST-2", "PAY-HIST-2", 12099);
    // A third, untouched event so we can also assert the break isn't misreported as the last event.
    await recordPayment("PAY-HIST-3", "PAY-HIST-3", 100);

    // app_user has no UPDATE grant on policy_events (009_grants.sql) — only the privileged
    // adminPool (test-only escape hatch, tests/helpers/db.ts) can simulate tampering here.
    const eventIdResult = await adminPool.query<{ id: string }>(
      `SELECT pe.id FROM policy_events pe
         JOIN payments p ON p.policy_event_id = pe.id
        WHERE p.external_payment_id = $1`,
      ["PAY-HIST-2"],
    );
    const tamperedEventId = Number(eventIdResult.rows[0].id);

    await adminPool.query(
      `UPDATE policy_events SET payload_canonical = payload_canonical || '-tampered' WHERE id = $1`,
      [tamperedEventId],
    );

    const result = await verifyPolicyHistory(SEED_POLICY.policy_id);

    expect(result.valid).toBe(false);
    expect(Number(result.event_count)).toBe(3);
    expect(Number(result.first_broken_event_id)).toBe(tamperedEventId);
  });

  it("throws a not-found error for an unknown policy", async () => {
    await expect(verifyPolicyHistory("POL-DOES-NOT-EXIST")).rejects.toMatchObject({
      code: "BLB01",
    });
  });
});
