/**
 * T055 [US3]: `v_ledger_summary`'s per-transaction `balanced` flag (FR-017, SC-005). Every
 * transaction `fn_apply_endorsement`/`fn_record_payment` write is balanced by construction, so this
 * asserts the view reports `balanced: true` for each of them (and for a policy with none yet), and
 * that a zero-delta endorsement — which posts no ledger_entries at all (007_create_functions.sql) —
 * is still trivially reported as balanced rather than surfacing as a false negative.
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

interface LedgerSummaryRow {
  policy_id: string;
  transaction_id: string | null;
  source: string | null;
  debits_cents: string;
  credits_cents: string;
  balanced: boolean;
}

async function getLedgerSummary(policyId: string): Promise<LedgerSummaryRow[]> {
  const result = await pool.query<LedgerSummaryRow>(
    `SELECT * FROM v_ledger_summary WHERE policy_id = $1 ORDER BY transaction_id`,
    [policyId],
  );
  return result.rows;
}

async function applyEndorsement(idempotencyKey: string, newPremiumCents: number) {
  const result = await pool.query(`SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`, [
    SEED_POLICY.policy_id,
    idempotencyKey,
    "2026-07-01",
    newPremiumCents,
    "ledger summary fixture",
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

describe("v_ledger_summary", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("returns a single phantom row (no real transaction) for a policy with no history yet", async () => {
    const rows = await getLedgerSummary(SEED_POLICY.policy_id);

    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_id).toBeNull();
    expect(Number(rows[0].debits_cents)).toBe(0);
    expect(Number(rows[0].credits_cents)).toBe(0);
    expect(rows[0].balanced).toBe(true);
  });

  it("reports balanced: true for every real transaction (endorsement + payment)", async () => {
    await applyEndorsement("END-LSV-1", 144000);
    await recordPayment("PAY-LSV-1", "PAY-LSV-1", 12099);

    const rows = await getLedgerSummary(SEED_POLICY.policy_id);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.balanced).toBe(true);
      expect(Number(row.debits_cents)).toBe(Number(row.credits_cents));
    }

    const endorsementRow = rows.find((row) => row.source === "END-LSV-1");
    const paymentRow = rows.find((row) => row.source === "PAY-LSV-1");
    expect(Number(endorsementRow!.debits_cents)).toBe(12099);
    expect(Number(paymentRow!.debits_cents)).toBe(12099);
  });

  it("still reports balanced: true for a zero-delta endorsement (no ledger_entries posted)", async () => {
    // Same premium as the seed -> delta_cents = 0 -> fn_apply_endorsement posts zero ledger_entries.
    await applyEndorsement("END-LSV-ZERO", SEED_POLICY.annual_premium_cents);

    const rows = await getLedgerSummary(SEED_POLICY.policy_id);

    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_id).not.toBeNull();
    expect(rows[0].source).toBe("END-LSV-ZERO");
    expect(Number(rows[0].debits_cents)).toBe(0);
    expect(Number(rows[0].credits_cents)).toBe(0);
    expect(rows[0].balanced).toBe(true);
  });
});
