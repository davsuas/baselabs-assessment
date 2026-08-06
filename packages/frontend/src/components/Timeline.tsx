/**
 * Timeline/summary view (FR-019). Purely presentational — receives already-resolved
 * `PolicySummaryResponse`/`LedgerSummaryResponse` (from `usePolicy` via `PolicyPage`) and renders
 * the policy's billing documents, payments, and ledger summary (including whether the books are
 * balanced, SC-005).
 *
 * Pragmatic scope note: `contracts/rest-api.md` endpoints 3/4 do not include a timestamp on
 * `BillingDocumentSummary`/`PaymentSummary`/`LedgerTransactionSummary` (no `created_at`/`occurred_at`
 * field), so there is no client-side data to sort a true chronological timeline by. Each list is
 * rendered in the order the API returns it (assumed insertion/chronological order server-side)
 * rather than the frontend fabricating an ordering it cannot actually verify. Flagged for the
 * README's "what I'd improve" section rather than left silent.
 */
import type { LedgerSummaryResponse, PolicySummaryResponse } from "@policy-billing-core/shared";
import { formatCents } from "../utils/money";
import styles from "./Timeline.module.css";

export interface TimelineProps {
  policy: PolicySummaryResponse;
  ledger: LedgerSummaryResponse;
}

export function Timeline({ policy, ledger }: TimelineProps) {
  const currency = policy.currency;

  return (
    <section className={styles.section} aria-labelledby="timeline-heading" data-testid="timeline">
      <h2 className={styles.heading} id="timeline-heading">
        Timeline &amp; Ledger Summary
      </h2>

      <section className={styles.subsection} aria-labelledby="timeline-billing-documents-heading">
        <h3 className={styles.subheading} id="timeline-billing-documents-heading">
          Billing Documents
        </h3>
        {policy.billing_documents.length === 0 ? (
          <p className={styles.emptyText} data-testid="timeline-billing-documents-empty">
            No billing documents yet.
          </p>
        ) : (
          <ul className={styles.list} data-testid="timeline-billing-documents">
            {policy.billing_documents.map((doc) => (
              <li
                className={styles.listItem}
                key={doc.id}
                data-testid={`timeline-billing-document-${doc.id}`}
              >
                #{doc.id} &mdash; {doc.type} &mdash; {formatCents(doc.amount_cents, currency)} &mdash;{" "}
                {doc.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.subsection} aria-labelledby="timeline-payments-heading">
        <h3 className={styles.subheading} id="timeline-payments-heading">
          Payments
        </h3>
        {policy.payments.length === 0 ? (
          <p className={styles.emptyText} data-testid="timeline-payments-empty">
            No payments recorded yet.
          </p>
        ) : (
          <ul className={styles.list} data-testid="timeline-payments">
            {policy.payments.map((payment) => (
              <li
                className={styles.listItem}
                key={payment.id}
                data-testid={`timeline-payment-${payment.id}`}
              >
                #{payment.id} ({payment.external_payment_id}) &mdash;{" "}
                {formatCents(payment.amount_cents, currency)} &mdash; {payment.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.subsection} aria-labelledby="timeline-ledger-heading">
        <h3 className={styles.subheading} id="timeline-ledger-heading">
          Ledger Summary
        </h3>
        <p
          className={ledger.balanced ? styles.balanced : styles.notBalanced}
          data-testid="timeline-ledger-balanced"
        >
          {ledger.balanced ? "Balanced — every transaction's debits equal its credits." : "NOT BALANCED — review immediately."}
        </p>
        {ledger.transactions.length === 0 ? (
          <p className={styles.emptyText} data-testid="timeline-ledger-empty">
            No ledger transactions yet.
          </p>
        ) : (
          <table className={styles.table} data-testid="timeline-ledger-transactions">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Debits</th>
                <th scope="col">Credits</th>
              </tr>
            </thead>
            <tbody>
              {ledger.transactions.map((transaction) => (
                <tr key={transaction.id} data-testid={`timeline-ledger-transaction-${transaction.id}`}>
                  <td>{transaction.source}</td>
                  <td>{formatCents(transaction.debits_cents, currency)}</td>
                  <td>{formatCents(transaction.credits_cents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
