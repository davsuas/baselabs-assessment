/**
 * T067 — covers `PolicyStateView` (FR-019, FR-023): policy ID, status, current annual premium,
 * currency, term dates, open balance, and history-verification status, plus the server-derived
 * `summary`/`suggested_action` text. Purely presentational (no hook/API interaction to mock) —
 * exercises rendering for both an intact and a tampered history-verification result.
 */
import { render, screen } from "@testing-library/react";
import type { PolicySummaryResponse } from "@policy-billing-core/shared";
import { PolicyStateView } from "../../src/components/PolicyStateView";

const BASE_POLICY: PolicySummaryResponse = {
  policy_id: "POL-1001",
  status: "active",
  annual_premium_cents: 144000,
  currency: "USD",
  term_start: "2026-01-01",
  term_end: "2027-01-01",
  open_balance_cents: 0,
  billing_documents: [],
  payments: [],
  history: { valid: true, event_count: 2 },
  summary: "Policy POL-1001 is active with an open balance of $0.00.",
  suggested_action: "No action required",
};

describe("PolicyStateView", () => {
  it("renders policy ID, status, premium, currency, term dates, and open balance", () => {
    render(<PolicyStateView policy={BASE_POLICY} />);

    expect(screen.getByTestId("policy-state-id")).toHaveTextContent("POL-1001");
    expect(screen.getByTestId("policy-state-status")).toHaveTextContent("active");
    expect(screen.getByTestId("policy-state-premium")).toHaveTextContent("$1,440.00");
    expect(screen.getByTestId("policy-state-currency")).toHaveTextContent("USD");
    expect(screen.getByTestId("policy-state-term")).toHaveTextContent("2026-01-01");
    expect(screen.getByTestId("policy-state-term")).toHaveTextContent("2027-01-01");
    expect(screen.getByTestId("policy-state-open-balance")).toHaveTextContent("$0.00");
  });

  it("renders a plain 'verified intact' history status for a valid chain", () => {
    render(<PolicyStateView policy={BASE_POLICY} />);

    const history = screen.getByTestId("policy-state-history");
    expect(history).toHaveTextContent(/verified intact/i);
    expect(history).toHaveTextContent("2 events");
    expect(history).not.toHaveTextContent(/tampered/i);
  });

  it("renders a distinct 'tampered' history status for an invalid chain, never silently passing", () => {
    const tampered: PolicySummaryResponse = {
      ...BASE_POLICY,
      history: { valid: false, event_count: 2 },
    };
    render(<PolicyStateView policy={tampered} />);

    const history = screen.getByTestId("policy-state-history");
    expect(history).toHaveTextContent(/tampered/i);
    expect(history).not.toHaveTextContent(/verified intact/i);
  });

  it("renders the server-derived summary and suggested action verbatim, not inferred client-side", () => {
    const withBalance: PolicySummaryResponse = {
      ...BASE_POLICY,
      open_balance_cents: 12099,
      summary: "Policy POL-1001 is active with an open balance of $120.99.",
      suggested_action: "Payment is still due.",
    };
    render(<PolicyStateView policy={withBalance} />);

    expect(screen.getByTestId("policy-state-summary")).toHaveTextContent(
      "Policy POL-1001 is active with an open balance of $120.99.",
    );
    expect(screen.getByTestId("policy-state-suggested-action")).toHaveTextContent(
      "Payment is still due.",
    );
  });

  it("handles a singular event count without a trailing 's'", () => {
    const single: PolicySummaryResponse = {
      ...BASE_POLICY,
      history: { valid: true, event_count: 1 },
    };
    render(<PolicyStateView policy={single} />);

    expect(screen.getByTestId("policy-state-history")).toHaveTextContent("1 event)");
  });
});
