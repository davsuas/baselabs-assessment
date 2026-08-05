/**
 * FR-023: "produce, for a policy, a plain-English summary and a suggested next action derived from
 * its current open balance and history-verification status" — never left to the frontend to infer
 * (contracts/rest-api.md endpoint 3). A pure function, independently testable and reused by
 * `routes/policies.ts` only (the one caller that has both an open balance and a history-verification
 * result in hand).
 */
import type { PolicyStatus } from "@policy-billing-core/shared";

/** Formats integer cents as a signed `$D.DD` string — never floating-point money math (Principle VI). */
function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absCents = Math.abs(cents);
  const dollars = Math.trunc(absCents / 100);
  const remainderCents = absCents % 100;
  return `${sign}$${dollars}.${String(remainderCents).padStart(2, "0")}`;
}

export interface PolicySummaryTextInput {
  policyId: string;
  status: PolicyStatus;
  openBalanceCents: number;
  historyValid: boolean;
}

export interface PolicySummaryText {
  summary: string;
  suggested_action: string;
}

export function buildPolicySummaryText(input: PolicySummaryTextInput): PolicySummaryText {
  const { policyId, status, openBalanceCents, historyValid } = input;
  const balanceText = formatCents(openBalanceCents);

  if (!historyValid) {
    return {
      summary: `Policy ${policyId} is ${status} with an open balance of ${balanceText}, but its event history failed tamper verification.`,
      suggested_action:
        "Investigate the policy's event history immediately before relying on its balance.",
    };
  }

  const summary = `Policy ${policyId} is ${status} with an open balance of ${balanceText}.`;

  if (openBalanceCents > 0) {
    return {
      summary,
      suggested_action: `Follow up with the homeowner to collect the outstanding balance of ${balanceText}.`,
    };
  }

  if (openBalanceCents < 0) {
    return {
      summary,
      suggested_action: `Review the overpayment of ${formatCents(-openBalanceCents)} for a possible refund or credit.`,
    };
  }

  return {
    summary,
    suggested_action: "No action required",
  };
}
