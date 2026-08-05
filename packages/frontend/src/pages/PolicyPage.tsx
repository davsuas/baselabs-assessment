/**
 * The real operator UI (T066), replacing the temporary direct-mount workaround previously in
 * `App.tsx` (qa-developer/T041, T052). Composes the read side (`usePolicy` -> `PolicyStateView` +
 * `Timeline`) with the write side (`EndorsementForm`, `PaymentForm`) into a single page, and renders
 * the fetch's loading/success/error states distinctly (FR-022).
 *
 * A successful endorsement or payment submission triggers `refetch()` so the policy state, timeline,
 * and ledger summary reflect the just-applied change without a manual page reload.
 */
import { EndorsementForm } from "../components/EndorsementForm";
import { PaymentForm } from "../components/PaymentForm";
import { PolicyStateView } from "../components/PolicyStateView";
import { Timeline } from "../components/Timeline";
import { usePolicy } from "../hooks/usePolicy";
import styles from "./PolicyPage.module.css";

export interface PolicyPageProps {
  policyId: string;
}

export function PolicyPage({ policyId }: PolicyPageProps) {
  const { state, isRefetching, refetch } = usePolicy(policyId);

  return (
    <main className={styles.page} data-testid="policy-page">
      <h1 className={styles.heading}>Policy Billing &amp; Ledger Core</h1>

      {state.status === "loading" && (
        <p className={styles.status} role="status" data-testid="policy-page-loading">
          Loading policy…
        </p>
      )}

      {state.status === "error" && (
        <div className={styles.error} role="alert" data-testid="policy-page-error">
          <p>{state.message}</p>
        </div>
      )}

      {state.status === "success" && (
        <>
          {isRefetching && (
            <p className={styles.refreshing} role="status" data-testid="policy-page-refreshing">
              Refreshing…
            </p>
          )}

          <PolicyStateView policy={state.data.policy} />
          <Timeline policy={state.data.policy} ledger={state.data.ledger} />

          <div className={styles.forms}>
            <EndorsementForm
              policyId={policyId}
              currency={state.data.policy.currency}
              onApplied={refetch}
            />
            <PaymentForm
              policyId={policyId}
              currency={state.data.policy.currency}
              onRecorded={refetch}
            />
          </div>
        </>
      )}
    </main>
  );
}
