/**
 * Policy state view (FR-019, FR-023). Purely presentational — receives an already-resolved
 * `PolicySummaryResponse` (from `usePolicy` via `PolicyPage`) and renders the policy's ID, status,
 * current annual premium, currency, term dates, open balance, and history-verification status,
 * plus the server-derived plain-English `summary`/`suggested_action` (FR-023 — never inferred
 * client-side; rendered here verbatim).
 */
import type { PolicySummaryResponse } from "@policy-billing-core/shared";
import { formatCents } from "../utils/money";
import styles from "./PolicyStateView.module.css";

export interface PolicyStateViewProps {
  policy: PolicySummaryResponse;
}

export function PolicyStateView({ policy }: PolicyStateViewProps) {
  const { history } = policy;

  return (
    <section
      className={styles.section}
      aria-labelledby="policy-state-heading"
      data-testid="policy-state-view"
    >
      <h2 className={styles.heading} id="policy-state-heading">
        Policy State
      </h2>

      <dl className={styles.grid}>
        <dt>Policy ID</dt>
        <dd data-testid="policy-state-id">{policy.policy_id}</dd>

        <dt>Status</dt>
        <dd data-testid="policy-state-status">{policy.status}</dd>

        <dt>Current annual premium</dt>
        <dd data-testid="policy-state-premium">
          {formatCents(policy.annual_premium_cents, policy.currency)}
        </dd>

        <dt>Currency</dt>
        <dd data-testid="policy-state-currency">{policy.currency}</dd>

        <dt>Term</dt>
        <dd data-testid="policy-state-term">
          {policy.term_start} &ndash; {policy.term_end}
        </dd>

        <dt>Open balance</dt>
        <dd data-testid="policy-state-open-balance">
          {formatCents(policy.open_balance_cents, policy.currency)}
        </dd>

        <dt>History verification</dt>
        <dd data-testid="policy-state-history">
          {history.valid
            ? `Verified intact (${history.event_count} event${history.event_count === 1 ? "" : "s"})`
            : `TAMPERED — chain is invalid (${history.event_count} event${history.event_count === 1 ? "" : "s"})`}
        </dd>
      </dl>

      <p className={styles.summary} data-testid="policy-state-summary">
        {policy.summary}
      </p>
      <p className={styles.suggestedAction} data-testid="policy-state-suggested-action">
        <strong>Suggested action:</strong> {policy.suggested_action}
      </p>
    </section>
  );
}
