/**
 * T044 [US2]: balanced double-entry ledger coverage (FR-012, SC-005) reproducing
 * docs/assessment.md's canonical bill-12099/pay-12099/balance-0 example: apply an endorsement via
 * `fn_apply_endorsement` (US1, already built), then record a matching payment via
 * `fn_record_payment` (US2), and assert the policy's open balance (computed from `ledger_entries`
 * for the `premium_receivable` account, per data-model.md's "money is single-sourced from the
 * ledger" design note — no `v_policy_summary`/`v_ledger_summary` views exist yet, those are US3)
 * reaches zero, and every ledger transaction's debits equal its credits.
 */
import { pool, closeTestPools, truncateDomainTables, SEED_POLICY } from "../helpers/db";

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

/** Net premium_receivable balance (debits - credits) across the whole policy — the open balance. */
async function getOpenBalanceCents(policyId: string): Promise<number> {
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

/** Every ledger_transaction's debit total must equal its credit total (SC-005). */
async function getUnbalancedTransactionCount(policyId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
       FROM (
         SELECT lt.id,
                SUM(CASE WHEN le.direction = 'debit' THEN le.amount_cents ELSE 0 END) AS debits,
                SUM(CASE WHEN le.direction = 'credit' THEN le.amount_cents ELSE 0 END) AS credits
           FROM ledger_transactions lt
           JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
          WHERE lt.policy_id = $1
          GROUP BY lt.id
         ) per_transaction
      WHERE debits <> credits`,
    [policyId],
  );
  return Number(result.rows[0].count);
}

describe("balanced ledger writes across endorsement + payment", () => {
  beforeEach(async () => {
    await truncateDomainTables();
  });

  afterAll(async () => {
    await closeTestPools();
  });

  it("reaches a zero open balance and every transaction stays balanced (bill-12099/pay-12099/balance-0)", async () => {
    const endorsement = await applyEndorsement("END-LEDGER-1", 144000);
    expect(Number(endorsement.billing_document_amount_cents)).toBe(12099);

    expect(await getOpenBalanceCents(SEED_POLICY.policy_id)).toBe(12099);

    const payment = await recordPayment("PAY-LEDGER-1", "PAY-LEDGER-1", 12099);
    expect(Number(payment.amount_cents)).toBe(12099);

    expect(await getOpenBalanceCents(SEED_POLICY.policy_id)).toBe(0);
    expect(await getUnbalancedTransactionCount(SEED_POLICY.policy_id)).toBe(0);
  });
});
