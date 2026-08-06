/**
 * T068 — covers `Timeline` (FR-019): billing documents, payments, and ledger summary (including
 * whether the books are balanced, SC-005). Purely presentational (no hook/API interaction to
 * mock) — exercises both populated and empty lists, and both a balanced and an unbalanced ledger.
 */
import { render, screen } from "@testing-library/react";
import type { LedgerSummaryResponse, PolicySummaryResponse } from "@policy-billing-core/shared";
import { Timeline } from "../../src/components/Timeline";

const POLICY: PolicySummaryResponse = {
  policy_id: "POL-1001",
  status: "active",
  annual_premium_cents: 144000,
  currency: "USD",
  term_start: "2026-01-01",
  term_end: "2027-01-01",
  open_balance_cents: 0,
  billing_documents: [
    { id: 3001, type: "endorsement_adjustment", amount_cents: 12099, status: "posted" },
  ],
  payments: [
    { id: 9001, external_payment_id: "PAY-9001", amount_cents: 12099, status: "applied" },
  ],
  history: { valid: true, event_count: 2 },
  summary: "Policy POL-1001 is active with an open balance of $0.00.",
  suggested_action: "No action required",
};

const BALANCED_LEDGER: LedgerSummaryResponse = {
  policy_id: "POL-1001",
  balanced: true,
  transactions: [
    { id: 1, source: "END-2001", debits_cents: 12099, credits_cents: 12099 },
    { id: 2, source: "PAY-9001", debits_cents: 12099, credits_cents: 12099 },
  ],
};

describe("Timeline", () => {
  it("renders billing documents with amount and status", () => {
    render(<Timeline policy={POLICY} ledger={BALANCED_LEDGER} />);

    const doc = screen.getByTestId("timeline-billing-document-3001");
    expect(doc).toHaveTextContent("endorsement_adjustment");
    expect(doc).toHaveTextContent("$120.99");
    expect(doc).toHaveTextContent("posted");
  });

  it("renders payments with external payment ID, amount, and status", () => {
    render(<Timeline policy={POLICY} ledger={BALANCED_LEDGER} />);

    const payment = screen.getByTestId("timeline-payment-9001");
    expect(payment).toHaveTextContent("PAY-9001");
    expect(payment).toHaveTextContent("$120.99");
    expect(payment).toHaveTextContent("applied");
  });

  it("renders a plain 'balanced' statement and every transaction's debits/credits when balanced", () => {
    render(<Timeline policy={POLICY} ledger={BALANCED_LEDGER} />);

    expect(screen.getByTestId("timeline-ledger-balanced")).toHaveTextContent(/balanced/i);
    expect(screen.getByTestId("timeline-ledger-balanced")).not.toHaveTextContent(/not balanced/i);

    const transaction = screen.getByTestId("timeline-ledger-transaction-1");
    expect(transaction).toHaveTextContent("END-2001");
    expect(transaction).toHaveTextContent("$120.99");
  });

  it("renders a distinct, visible warning when the ledger is not balanced", () => {
    const unbalanced: LedgerSummaryResponse = {
      ...BALANCED_LEDGER,
      balanced: false,
    };
    render(<Timeline policy={POLICY} ledger={unbalanced} />);

    expect(screen.getByTestId("timeline-ledger-balanced")).toHaveTextContent(/not balanced/i);
  });

  it("renders readable empty states rather than blank sections when there is no activity yet", () => {
    const emptyPolicy: PolicySummaryResponse = {
      ...POLICY,
      billing_documents: [],
      payments: [],
    };
    const emptyLedger: LedgerSummaryResponse = {
      policy_id: "POL-1001",
      balanced: true,
      transactions: [],
    };
    render(<Timeline policy={emptyPolicy} ledger={emptyLedger} />);

    expect(screen.getByTestId("timeline-billing-documents-empty")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-payments-empty")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-ledger-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-ledger-transactions")).not.toBeInTheDocument();
  });
});
