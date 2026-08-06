/**
 * T069 (US3, P3): loads the real composed `PolicyPage` (`packages/frontend/src/pages/PolicyPage.tsx`,
 * T066) and proves the *read side* — `PolicyStateView` (state/history) and `Timeline`
 * (billing documents, payments, ledger summary) — renders correctly against the real
 * frontend/backend/DB stack. This is the one thing neither the backend Jest suite (which asserts
 * `v_policy_summary`/`v_ledger_summary`/`fn_verify_policy_history` row shapes directly, never
 * through HTTP+DOM) nor the frontend RTL suites (`PolicyStateView.test.tsx`, `Timeline.test.tsx`,
 * `PolicyPage.test.tsx`, which mock the fetch layer) can prove on their own.
 *
 * Covers two things:
 *   1. A first load renders every required field of the policy-state view and timeline/ledger
 *      summary (FR-019, FR-023) with well-formed content — not just that the DOM contains some
 *      text.
 *   2. After a real write (an applied endorsement followed by a matching payment, driven through
 *      the composed `EndorsementForm`/`PaymentForm` exactly as an operator would), `PolicyPage`'s
 *      `refetch()` (triggered by each form's `onApplied`/`onRecorded`) causes the timeline, ledger
 *      summary, and policy state to visibly reflect the new billing document/payment/ledger
 *      transaction/history event — proving the read side is wired to real data, not a stale
 *      snapshot from initial load.
 *
 * Deliberately does not assert an exact proration dollar amount up front (see
 * `apply-endorsement.spec.ts`'s note: POL-1001's `annual_premium_cents` is a shared, mutable
 * fixture across this repo's test surfaces). Instead, scenario 2 reads the billing document amount
 * from the endorsement form's own success panel — already proven correct against the real API
 * response by `apply-endorsement.spec.ts` — and uses that as the expected value for the timeline/
 * ledger/state assertions that follow, so this spec's job is proving the *read* path renders that
 * value correctly, not re-deriving the proration math itself (already covered at the unit layer by
 * `packages/backend/tests/unit/proration.test.ts`, T031).
 *
 * A fresh, timestamp-based idempotency key is used for both the endorsement and the payment so
 * this spec's own writes are always genuine new events (not leftover replays from a prior run).
 */
import { expect, type Locator, test } from "@playwright/test";

const POLICY_ID = "POL-1001";
const EFFECTIVE_DATE = "2026-07-01";
const RECEIVED_AT = "2026-07-03T18:30";

/** Parses a `formatCents`-rendered string (e.g. "$1,440.00") back into integer cents. */
function parseCurrencyToCents(text: string): number {
  const numeric = text.replace(/[^0-9.-]/g, "");
  const dollars = Number.parseFloat(numeric);
  if (Number.isNaN(dollars)) {
    throw new Error(`Could not parse currency text: "${text}"`);
  }
  return Math.round(dollars * 100);
}

/** Parses the `policy-state-history` dd's rendered "... (N events)" / "... (1 event)" suffix. */
function parseHistoryEventCount(text: string): number {
  const match = text.match(/\((\d+) events?\)/);
  if (!match) {
    throw new Error(`Could not parse event count from history text: "${text}"`);
  }
  return Number.parseInt(match[1], 10);
}

async function listItemCount(locator: Locator): Promise<number> {
  return locator.count();
}

test.describe("Policy Review (state, timeline, ledger, history)", () => {
  test("renders the policy's state, timeline, and ledger summary on load", async ({ page }) => {
    await page.goto("/");

    const pageRoot = page.getByTestId("policy-page");
    await expect(pageRoot).toBeVisible();

    // --- Policy state view (FR-019, FR-023) ---
    const stateView = page.getByTestId("policy-state-view");
    await expect(stateView).toBeVisible();

    await expect(page.getByTestId("policy-state-id")).toHaveText(POLICY_ID);
    await expect(page.getByTestId("policy-state-status")).toHaveText(/^(active|cancelled|expired)$/);

    const currencyText = (await page.getByTestId("policy-state-currency").textContent())?.trim();
    expect(currencyText).toMatch(/^[A-Z]{3}$/);

    const premiumText = await page.getByTestId("policy-state-premium").textContent();
    expect(() => parseCurrencyToCents(premiumText ?? "")).not.toThrow();

    await expect(page.getByTestId("policy-state-term")).toHaveText(/^\d{4}-\d{2}-\d{2}.+\d{4}-\d{2}-\d{2}$/);

    const openBalanceText = await page.getByTestId("policy-state-open-balance").textContent();
    expect(() => parseCurrencyToCents(openBalanceText ?? "")).not.toThrow();

    const historyText = (await page.getByTestId("policy-state-history").textContent()) ?? "";
    expect(historyText).toMatch(/^(Verified intact|TAMPERED — chain is invalid) \(\d+ events?\)$/);
    // The seeded POL-1001 chain is never tampered by anything this containerized/host stack runs
    // (tampering requires the privileged `adminPool` escape hatch used only by the isolated backend
    // Jest suite, per `packages/backend/tests/helpers/db.ts` and quickstart.md §7) — so on a normal
    // stack this must read as intact.
    expect(historyText).toContain("Verified intact");

    await expect(page.getByTestId("policy-state-summary")).not.toBeEmpty();
    await expect(page.getByTestId("policy-state-suggested-action")).not.toBeEmpty();

    // --- Timeline / ledger summary (FR-019) ---
    const timeline = page.getByTestId("timeline");
    await expect(timeline).toBeVisible();

    // Either a populated list or an explicit empty-state message must render, one or the other,
    // for each of the three sub-sections.
    const billingDocItems = page.locator('[data-testid^="timeline-billing-document-"]');
    const billingDocCount = await listItemCount(billingDocItems);
    if (billingDocCount === 0) {
      await expect(page.getByTestId("timeline-billing-documents-empty")).toBeVisible();
    } else {
      await expect(page.getByTestId("timeline-billing-documents")).toBeVisible();
    }

    const paymentItems = page.locator('[data-testid^="timeline-payment-"]');
    const paymentCount = await listItemCount(paymentItems);
    if (paymentCount === 0) {
      await expect(page.getByTestId("timeline-payments-empty")).toBeVisible();
    } else {
      await expect(page.getByTestId("timeline-payments")).toBeVisible();
    }

    const ledgerBalancedText = await page.getByTestId("timeline-ledger-balanced").textContent();
    expect(ledgerBalancedText).toMatch(/^(Balanced|NOT BALANCED)/);
    // The seeded/local stack's ledger is only ever written to through `fn_apply_endorsement`/
    // `fn_record_payment`, both of which write balanced debit/credit pairs in a single transaction
    // (constitution: atomicity) — so a normal stack must read as balanced (SC-005).
    expect(ledgerBalancedText).toContain("Balanced");

    const ledgerRows = page.locator('[data-testid^="timeline-ledger-transaction-"]');
    const ledgerRowCount = await listItemCount(ledgerRows);
    if (ledgerRowCount === 0) {
      await expect(page.getByTestId("timeline-ledger-empty")).toBeVisible();
    } else {
      await expect(page.getByTestId("timeline-ledger-transactions")).toBeVisible();
      // Every rendered transaction row has equal debits/credits (SC-005) — proven visually, not
      // just by the `balanced` flag above.
      for (let i = 0; i < ledgerRowCount; i += 1) {
        const row = ledgerRows.nth(i);
        const debitsText = await row.locator("td").nth(1).textContent();
        const creditsText = await row.locator("td").nth(2).textContent();
        expect(parseCurrencyToCents(debitsText ?? "")).toBe(parseCurrencyToCents(creditsText ?? ""));
      }
    }
  });

  test("after applying an endorsement and recording a matching payment, the timeline/ledger/state update to reflect them", async ({
    page,
  }) => {
    const endorsementKey = `E2E-REVIEW-ENDORSE-${Date.now()}`;
    const paymentKey = `E2E-REVIEW-PAY-${Date.now()}`;

    await page.goto("/");
    await expect(page.getByTestId("policy-state-view")).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();

    // --- Capture the read side's baseline before any write ---
    const initialOpenBalanceCents = parseCurrencyToCents(
      (await page.getByTestId("policy-state-open-balance").textContent()) ?? "",
    );
    const initialHistoryEventCount = parseHistoryEventCount(
      (await page.getByTestId("policy-state-history").textContent()) ?? "",
    );
    const initialBillingDocCount = await listItemCount(
      page.locator('[data-testid^="timeline-billing-document-"]'),
    );
    const initialPaymentCount = await listItemCount(page.locator('[data-testid^="timeline-payment-"]'));
    const initialLedgerRowCount = await listItemCount(
      page.locator('[data-testid^="timeline-ledger-transaction-"]'),
    );
    const currentPremiumCents = parseCurrencyToCents(
      (await page.getByTestId("policy-state-premium").textContent()) ?? "",
    );

    // --- Apply a new endorsement (a modest, clearly non-zero premium increase) ---
    const endorsementForm = page.getByTestId("endorsement-form");
    await endorsementForm.getByLabel("Idempotency key").fill(endorsementKey);
    await endorsementForm.getByLabel("Effective date").fill(EFFECTIVE_DATE);
    await endorsementForm
      .getByLabel("New annual premium (USD)")
      .fill(((currentPremiumCents + 5000) / 100).toFixed(2));
    await endorsementForm.getByLabel("Reason").fill("Playwright E2E: policy-review spec");
    await endorsementForm.getByRole("button", { name: "Apply Endorsement", exact: true }).click();

    const endorsementSuccess = page.getByTestId("endorsement-success");
    await expect(endorsementSuccess).toBeVisible();
    const billingDocumentAmountText = await endorsementSuccess.locator("dd").nth(2).textContent();
    const billingDocumentAmountCents = parseCurrencyToCents(billingDocumentAmountText ?? "");
    expect(billingDocumentAmountCents).toBeGreaterThan(0);

    // --- Timeline/ledger/state must reflect the new billing document after PolicyPage's refetch ---
    await expect(page.locator('[data-testid^="timeline-billing-document-"]')).toHaveCount(
      initialBillingDocCount + 1,
    );
    await expect(page.locator('[data-testid^="timeline-ledger-transaction-"]')).toHaveCount(
      initialLedgerRowCount + 1,
    );
    await expect(page.getByTestId("timeline-ledger-balanced")).toContainText("Balanced");

    // `v_policy_billing_documents` (data-model.md) orders newest-first, and `Timeline` renders in
    // API order (its own doc comment), so the just-applied billing document is the *first* `<li>`,
    // not the last.
    const newestBillingDoc = page.locator('[data-testid^="timeline-billing-document-"]').first();
    await expect(newestBillingDoc).toContainText(billingDocumentAmountText ?? "");
    await expect(newestBillingDoc).toContainText("posted");

    await expect(async () => {
      const openBalanceText = await page.getByTestId("policy-state-open-balance").textContent();
      expect(parseCurrencyToCents(openBalanceText ?? "")).toBe(
        initialOpenBalanceCents + billingDocumentAmountCents,
      );
    }).toPass();

    await expect(async () => {
      const historyText = await page.getByTestId("policy-state-history").textContent();
      expect(historyText).toContain("Verified intact");
      expect(parseHistoryEventCount(historyText ?? "")).toBe(initialHistoryEventCount + 1);
    }).toPass();

    // --- Record a payment for exactly the new billing document's amount, zeroing the balance back out ---
    const paymentForm = page.getByTestId("payment-form");
    await paymentForm.getByLabel("Idempotency key").fill(paymentKey);
    await paymentForm.getByLabel("External payment ID").fill(paymentKey);
    await paymentForm.getByLabel(/^Amount/).fill((billingDocumentAmountCents / 100).toFixed(2));
    await paymentForm.getByLabel("Currency").fill("USD");
    await paymentForm.getByLabel("Received at").fill(RECEIVED_AT);
    await paymentForm.getByRole("button", { name: "Record Payment", exact: true }).click();

    const paymentSuccess = page.getByTestId("payment-success");
    await expect(paymentSuccess).toBeVisible();

    // --- Timeline/ledger/state must reflect the new payment after PolicyPage's refetch ---
    await expect(page.locator('[data-testid^="timeline-payment-"]')).toHaveCount(
      initialPaymentCount + 1,
    );
    await expect(page.locator('[data-testid^="timeline-ledger-transaction-"]')).toHaveCount(
      initialLedgerRowCount + 2,
    );
    await expect(page.getByTestId("timeline-ledger-balanced")).toContainText("Balanced");

    // `v_policy_payments` (data-model.md) is also newest-first — see the billing-document note above.
    const newestPayment = page.locator('[data-testid^="timeline-payment-"]').first();
    await expect(newestPayment).toContainText(paymentKey);
    await expect(newestPayment).toContainText("applied");

    // The endorsement billed `billingDocumentAmountCents` and the payment exactly covers it, so the
    // open balance must return to its pre-endorsement value.
    await expect(async () => {
      const openBalanceText = await page.getByTestId("policy-state-open-balance").textContent();
      expect(parseCurrencyToCents(openBalanceText ?? "")).toBe(initialOpenBalanceCents);
    }).toPass();

    await expect(async () => {
      const historyText = await page.getByTestId("policy-state-history").textContent();
      expect(historyText).toContain("Verified intact");
      expect(parseHistoryEventCount(historyText ?? "")).toBe(initialHistoryEventCount + 2);
    }).toPass();
  });
});
