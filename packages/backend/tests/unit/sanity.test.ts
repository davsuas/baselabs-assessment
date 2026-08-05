/**
 * Sanity check for the backend Jest/ts-jest wiring (T024) — no database required. Replaced in
 * spirit by the real Phase 3+ suites (proration, idempotency, currency, ledger-balance,
 * history-chain); kept here to prove the toolchain itself works independent of the DB being up.
 */
describe("backend jest config", () => {
  it("compiles and runs TypeScript specs via ts-jest", () => {
    expect(1 + 1).toBe(2);
  });
});
