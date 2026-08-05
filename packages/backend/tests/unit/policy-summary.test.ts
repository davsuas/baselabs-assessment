/**
 * T054 [US3]: `v_policy_summary`'s `open_balance_cents` coverage (FR-016, data-model.md's "money is
 * single-sourced from the ledger" design note). Reproduces the same bill-12099/pay-12099 sequence
 * `tests/unit/ledger-balance.test.ts` (US2) proves via ad-hoc `ledger_entries` aggregation, and
 * asserts `v_policy_summary` computes the identical number, so the view can't silently drift from
 * the ledger it's derived from.
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

interface PolicySummaryRow {
  policy_id: string;
  status: string;
  annual_premium_cents: string;
  currency: string;
  term_start: string;
  term_end: string;
  open_balance_cents: string;
}

async function getPolicySummary(policyId: string): Promise<PolicySummaryRow | undefined> {
  const result = await pool.query<PolicySummaryRow>(
    `SELECT * FROM v_policy_summary WHERE policy_id = $1`,
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
    "reproduces assessment example",
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

/** The same "sum debits minus credits for premium_receivable" computation as ledger-balance.test.ts. */
async function getLedgerDerivedOpenBalanceCents(policyId: string): Promise<number> {
  const result = await pool.query<{ open_balance_cents: string }>(
    `SELECT COALESCE(SUM(
       CASE WHEN le.direction = 'debit' THEN le.amount_cents ELSE -le.amount_cents END
     ), 0)::BIGINT AS open_balance_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
      WHERE lt.policy_id = $1
        AND le.account = 'premium_receivable'`,
    [policyId],
  );
  return Number(result.rows[0].open_balance_cents);
}

describe("v_policy_summary", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("reports open_balance_cents of 0 for a freshly seeded policy with no events", async () => {
    const summary = await getPolicySummary(SEED_POLICY.policy_id);

    expect(summary).toBeDefined();
    expect(Number(summary!.open_balance_cents)).toBe(0);
    expect(summary!.status).toBe(SEED_POLICY.status);
    expect(Number(summary!.annual_premium_cents)).toBe(SEED_POLICY.annual_premium_cents);
    expect(summary!.currency).toBe(SEED_POLICY.currency);
  });

  it("matches the ledger's directly-computed premium_receivable balance after an endorsement", async () => {
    await applyEndorsement("END-SUMMARY-1", 144000);

    const summary = await getPolicySummary(SEED_POLICY.policy_id);
    const ledgerDerived = await getLedgerDerivedOpenBalanceCents(SEED_POLICY.policy_id);

    expect(Number(summary!.open_balance_cents)).toBe(ledgerDerived);
    expect(Number(summary!.open_balance_cents)).toBe(12099);
    expect(Number(summary!.annual_premium_cents)).toBe(144000);
  });

  it("matches the ledger's directly-computed balance (zero) after a matching payment (bill-12099/pay-12099/balance-0)", async () => {
    await applyEndorsement("END-SUMMARY-2", 144000);
    await recordPayment("PAY-SUMMARY-2", "PAY-SUMMARY-2", 12099);

    const summary = await getPolicySummary(SEED_POLICY.policy_id);
    const ledgerDerived = await getLedgerDerivedOpenBalanceCents(SEED_POLICY.policy_id);

    expect(Number(summary!.open_balance_cents)).toBe(ledgerDerived);
    expect(Number(summary!.open_balance_cents)).toBe(0);
  });

  it("returns no row for an unknown policy_id", async () => {
    const summary = await getPolicySummary("POL-DOES-NOT-EXIST");
    expect(summary).toBeUndefined();
  });
});
