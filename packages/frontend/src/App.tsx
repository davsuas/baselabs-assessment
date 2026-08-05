/**
 * Root component. Renders the real operator UI (`PolicyPage`, T066), which composes the policy
 * state view, timeline/ledger summary, endorsement form, and payment form together.
 *
 * The temporary direct-mount of `EndorsementForm`/`PaymentForm` that previously stood in here
 * (qa-developer/T041, T052 — kept ahead of T066 so `playwright/tests/apply-endorsement.spec.ts` and
 * `playwright/tests/record-payment.spec.ts` had a real page to drive) has been removed now that
 * `PolicyPage` exists.
 *
 * `POL-1001` is hardcoded: there is no routing/policy-picker requirement in scope for this
 * assessment (docs/assessment.md, spec.md — a single seeded policy is the reference fixture).
 */
import { PolicyPage } from "./pages/PolicyPage";
import styles from "./App.module.css";

const POLICY_ID = "POL-1001";

export default function App() {
  return (
    <div className={styles.shell}>
      <PolicyPage policyId={POLICY_ID} />
    </div>
  );
}
