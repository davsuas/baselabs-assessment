/**
 * T052 (US2, P2): drives `PaymentForm` through the real frontend/backend/DB stack — the one thing
 * the backend Jest suite (payment-idempotency.test.ts, payment-validation.test.ts,
 * payments.test.ts) and the frontend RTL suite (PaymentForm.test.tsx) can't prove on their own,
 * since both mock or bypass at least one layer of the real HTTP/UI path. Mirrors
 * `apply-endorsement.spec.ts` (T041)'s structure for US1.
 *
 * Covers:
 *   1. A first submission renders the success state as a newly-recorded payment
 *      (`idempotency_result: "applied"`, per contracts/rest-api.md endpoint 2).
 *   2. Replaying the exact same request (same idempotency key + same form values, i.e. same
 *      payload) renders success again but as a no-op replay (`"duplicate_ignored"`) — same
 *      payment id, same amount/status as the first response, proving no duplicate payment row
 *      was created (FR-009, SC-003).
 *   3. Same idempotency key + a different payload (different amount) is rejected (409
 *      idempotency_conflict, surfaced as a validation error), not silently applied.
 *   4. A wrong-currency payment (POL-1001's seeded currency is USD — data-model.md,
 *      db/migrations/010_seed_data.sql) is rejected as a validation error (422
 *      currency_mismatch), not silently applied — this exercises a distinct branch of
 *      `useRecordPayment`'s `classifyError` (the generic business-rule fallback) that scenarios 2
 *      and 3 don't reach, and proves the atomic wrong-currency rejection required by the
 *      constitution actually surfaces correctly through the real UI path, not just at the SQL
 *      function layer (already covered at the unit layer by
 *      `packages/backend/tests/unit/payment-validation.test.ts`).
 *
 * A fresh, timestamp-based idempotency key is used per scenario so this spec's own submissions
 * are always genuine "applied" results (not leftover replays from a prior run).
 *
 * UPDATE (post-T066): `PaymentForm` is now composed inside `PolicyPage`
 * (`packages/frontend/src/pages/PolicyPage.tsx`), rendered at `/` once `usePolicy`'s initial GET
 * resolves to its success state — `App.tsx` no longer mounts it directly (that was a temporary
 * qa-developer/T041/T052 workaround, since removed). This spec still only depends on
 * `[data-testid="payment-form"]` being reachable at `/`; Playwright's auto-waiting locators absorb
 * the brief loading state in between, so no test logic changed.
 */
import { expect, test } from "@playwright/test";

const POLICY_ID = "POL-1001";
const POLICY_CURRENCY = "USD";
// Arbitrary, within-scope receipt timestamp; not asserted against, just needs to be a valid
// `datetime-local` value (contracts/rest-api.md's `received_at` example uses the same date).
const RECEIVED_AT = "2026-07-03T18:30";

test.describe("Record Received Payment", () => {
  test("first submission records the payment; replaying the same request is a no-op", async ({
    page,
  }) => {
    const idempotencyKey = `E2E-PAY-${Date.now()}`;

    await page.goto("/");

    const form = page.getByTestId("payment-form");
    await expect(form).toBeVisible();

    await form.getByLabel("Idempotency key").fill(idempotencyKey);
    await form.getByLabel("External payment ID").fill(idempotencyKey);
    await form.getByLabel(`Amount (${POLICY_CURRENCY})`).fill("150.75");
    await form.getByLabel("Currency").fill(POLICY_CURRENCY);
    await form.getByLabel("Received at").fill(RECEIVED_AT);

    const submitButton = form.getByRole("button", { name: "Record Payment", exact: true });

    // --- First submission: expect a genuinely new payment ---
    await submitButton.click();

    const success = page.getByTestId("payment-success");
    await expect(success).toBeVisible();
    await expect(page.getByTestId("payment-validation-error")).toHaveCount(0);
    await expect(page.getByTestId("payment-server-error")).toHaveCount(0);
    await expect(success.getByText("Payment recorded.", { exact: true })).toBeVisible();

    const firstPaymentId = await success.locator("dd").nth(0).textContent();
    const firstExternalId = await success.locator("dd").nth(1).textContent();
    const firstAmount = await success.locator("dd").nth(2).textContent();
    const firstStatus = await success.locator("dd").nth(3).textContent();

    expect(firstExternalId).toBe(idempotencyKey);
    expect(firstAmount).toBe("$150.75");
    expect(firstStatus).toBe("applied");

    // --- Replay: same idempotency key, same form values (same payload) submitted again ---
    // Fields are intentionally left untouched from the first submission so this click issues the
    // byte-identical request.
    await submitButton.click();

    await expect(success).toBeVisible();
    await expect(page.getByTestId("payment-validation-error")).toHaveCount(0);
    await expect(page.getByTestId("payment-server-error")).toHaveCount(0);
    await expect(
      success.getByText("This payment was already recorded — no new payment was created.", {
        exact: true,
      }),
    ).toBeVisible();

    // No duplicate effect: the replay must describe the exact same payment, not a newly created
    // one.
    const secondPaymentId = await success.locator("dd").nth(0).textContent();
    const secondAmount = await success.locator("dd").nth(2).textContent();
    const secondStatus = await success.locator("dd").nth(3).textContent();

    expect(secondPaymentId).toBe(firstPaymentId);
    expect(secondAmount).toBe(firstAmount);
    expect(secondStatus).toBe(firstStatus);
  });

  test("submitting the same idempotency key with a different payload is rejected, not silently applied", async ({
    page,
  }) => {
    const idempotencyKey = `E2E-PAY-CONFLICT-${Date.now()}`;

    await page.goto("/");
    const form = page.getByTestId("payment-form");

    await form.getByLabel("Idempotency key").fill(idempotencyKey);
    await form.getByLabel("External payment ID").fill(idempotencyKey);
    await form.getByLabel(`Amount (${POLICY_CURRENCY})`).fill("75.00");
    await form.getByLabel("Currency").fill(POLICY_CURRENCY);
    await form.getByLabel("Received at").fill(RECEIVED_AT);

    const submitButton = form.getByRole("button", { name: "Record Payment", exact: true });
    await submitButton.click();
    await expect(page.getByTestId("payment-success")).toBeVisible();

    // Same key, different payload (different amount) -> must be rejected (409
    // idempotency_conflict, surfaced by the hook as a validation_error), not silently applied.
    await form.getByLabel(`Amount (${POLICY_CURRENCY})`).fill("999.00");
    await submitButton.click();

    await expect(page.getByTestId("payment-validation-error")).toBeVisible();
    await expect(page.getByTestId("payment-success")).toHaveCount(0);
    await expect(page.getByTestId("payment-server-error")).toHaveCount(0);
  });

  test("a wrong-currency payment is rejected as a validation error, not silently applied", async ({
    page,
  }) => {
    const idempotencyKey = `E2E-PAY-WRONGCCY-${Date.now()}`;

    await page.goto("/");
    const form = page.getByTestId("payment-form");

    await form.getByLabel("Idempotency key").fill(idempotencyKey);
    await form.getByLabel("External payment ID").fill(idempotencyKey);
    // POL-1001's seeded currency is USD (db/migrations/010_seed_data.sql) — EUR must be rejected
    // atomically (constitution: wrong-currency payments fail atomically, no partial persistence).
    await form.getByLabel(/^Amount/).fill("50.00");
    await form.getByLabel("Currency").fill("EUR");
    await form.getByLabel("Received at").fill(RECEIVED_AT);

    const submitButton = form.getByRole("button", { name: "Record Payment", exact: true });
    await submitButton.click();

    const validationError = page.getByTestId("payment-validation-error");
    await expect(validationError).toBeVisible();
    await expect(page.getByTestId("payment-success")).toHaveCount(0);
    await expect(page.getByTestId("payment-server-error")).toHaveCount(0);
    await expect(validationError.getByText(/currency/i)).toBeVisible();
  });
});
