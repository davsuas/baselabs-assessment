/**
 * T041 (US1, P1): drives `EndorsementForm` through the real frontend/backend/DB stack — the one
 * thing the backend Jest suite (endorsement-idempotency.test.ts) and the frontend RTL suite
 * (EndorsementForm.test.tsx) can't prove on their own, since both mock or bypass at least one
 * layer of the real HTTP/UI path.
 *
 * Covers:
 *   1. A first submission renders the success state as a newly-applied endorsement
 *      (`idempotency_result: "applied"`, per contracts/rest-api.md endpoint 1).
 *   2. Replaying the exact same request (same idempotency key + same form values, i.e. same
 *      payload) renders success again but as a no-op replay (`"duplicate_ignored"`) — same
 *      endorsement id, same billing document amount/status as the first response, proving no
 *      duplicate billing document/event was created (FR-005, FR-006, SC-002).
 *
 * Deliberately does not assert the exact prorated cents amount (e.g. docs/assessment.md's 12099
 * example): POL-1001's `annual_premium_cents` is a shared, mutable fixture across this repo's
 * test surfaces (backend Jest resets it via `truncateDomainTables` per-test, but only up to the
 * *last* test that runs; Postman/manual quickstart runs also mutate it) and there is no read
 * endpoint yet (US3/T060) to fetch its current value up front. The proration math to the cent is
 * already covered by `packages/backend/tests/unit/proration.test.ts` (T031) at the unit layer —
 * this spec's job is proving the real UI path renders success + idempotent no-op correctly, not
 * re-proving the arithmetic. A fresh, timestamp-based idempotency key is used on every run so
 * this spec's own first submission is always a genuine "applied" (not a leftover replay from a
 * prior run).
 *
 * UPDATE (post-T066): `EndorsementForm` is now composed inside `PolicyPage`
 * (`packages/frontend/src/pages/PolicyPage.tsx`), rendered at `/` once `usePolicy`'s initial GET
 * resolves to its success state — `App.tsx` no longer mounts it directly (that was a temporary
 * qa-developer/T041 workaround, since removed). This spec still only depends on
 * `[data-testid="endorsement-form"]` being reachable at `/`; Playwright's auto-waiting locators
 * absorb the brief loading state in between, so no test logic changed.
 */
import { expect, test } from "@playwright/test";

const POLICY_ID = "POL-1001";
// Within POL-1001's seeded term (2026-01-01 to 2027-01-01, db/migrations/010_seed_data.sql) and
// matching quickstart.md's documented example, so this spec's request shape mirrors the
// documented manual-walkthrough case even though the resulting dollar amount isn't asserted here.
const EFFECTIVE_DATE = "2026-07-01";
const NEW_PREMIUM_DOLLARS = "1440.00";
const REASON = "Playwright E2E: apply-endorsement spec";

test.describe("Apply Endorsement", () => {
  test("first submission applies; replaying the same request is a no-op", async ({ page }) => {
    const idempotencyKey = `E2E-ENDORSE-${Date.now()}`;

    await page.goto("/");

    const form = page.getByTestId("endorsement-form");
    await expect(form).toBeVisible();

    await form.getByLabel("Idempotency key").fill(idempotencyKey);
    await form.getByLabel("Effective date").fill(EFFECTIVE_DATE);
    await form.getByLabel(`New annual premium (USD)`).fill(NEW_PREMIUM_DOLLARS);
    await form.getByLabel("Reason").fill(REASON);

    const submitButton = form.getByRole("button", { name: "Apply Endorsement", exact: true });

    // --- First submission: expect a genuinely new application ---
    await submitButton.click();

    const success = page.getByTestId("endorsement-success");
    await expect(success).toBeVisible();
    await expect(page.getByTestId("endorsement-validation-error")).toHaveCount(0);
    await expect(page.getByTestId("endorsement-server-error")).toHaveCount(0);
    await expect(success.getByText("Endorsement applied.", { exact: true })).toBeVisible();

    const firstEndorsementId = await success.locator("dd").nth(0).textContent();
    const firstNewPremium = await success.locator("dd").nth(1).textContent();
    const firstBillingAmount = await success.locator("dd").nth(2).textContent();
    const firstBillingStatus = await success.locator("dd").nth(3).textContent();

    expect(firstEndorsementId).toBe(idempotencyKey);
    expect(firstNewPremium).toBe("$1,440.00");

    // --- Replay: same idempotency key, same form values (same payload) submitted again ---
    // Fields are intentionally left untouched from the first submission so this click issues the
    // byte-identical request.
    await submitButton.click();

    await expect(success).toBeVisible();
    await expect(page.getByTestId("endorsement-validation-error")).toHaveCount(0);
    await expect(page.getByTestId("endorsement-server-error")).toHaveCount(0);
    await expect(
      success.getByText(
        "This endorsement was already applied — no new billing document or event was created.",
        { exact: true },
      ),
    ).toBeVisible();

    // No duplicate effect: the replay must describe the exact same endorsement/billing document,
    // not a newly created one.
    const secondEndorsementId = await success.locator("dd").nth(0).textContent();
    const secondNewPremium = await success.locator("dd").nth(1).textContent();
    const secondBillingAmount = await success.locator("dd").nth(2).textContent();
    const secondBillingStatus = await success.locator("dd").nth(3).textContent();

    expect(secondEndorsementId).toBe(firstEndorsementId);
    expect(secondNewPremium).toBe(firstNewPremium);
    expect(secondBillingAmount).toBe(firstBillingAmount);
    expect(secondBillingStatus).toBe(firstBillingStatus);
  });

  test("submitting the same idempotency key with a different payload is rejected, not silently applied", async ({
    page,
  }) => {
    const idempotencyKey = `E2E-ENDORSE-CONFLICT-${Date.now()}`;

    await page.goto("/");
    const form = page.getByTestId("endorsement-form");

    await form.getByLabel("Idempotency key").fill(idempotencyKey);
    await form.getByLabel("Effective date").fill(EFFECTIVE_DATE);
    await form.getByLabel("New annual premium (USD)").fill(NEW_PREMIUM_DOLLARS);
    await form.getByLabel("Reason").fill(REASON);

    const submitButton = form.getByRole("button", { name: "Apply Endorsement", exact: true });
    await submitButton.click();
    await expect(page.getByTestId("endorsement-success")).toBeVisible();

    // Same key, different payload (different new premium) -> must be rejected (409
    // idempotency_conflict, surfaced by the hook as a validation_error), not silently applied.
    await form.getByLabel("New annual premium (USD)").fill("1500.00");
    await submitButton.click();

    await expect(page.getByTestId("endorsement-validation-error")).toBeVisible();
    await expect(page.getByTestId("endorsement-success")).toHaveCount(0);
    await expect(page.getByTestId("endorsement-server-error")).toHaveCount(0);
  });
});
