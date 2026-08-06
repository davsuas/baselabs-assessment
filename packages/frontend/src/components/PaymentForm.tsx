/**
 * Record Received Payment form (FR-021). Submits the JSON-equivalent of `PaymentRequest`
 * (contracts/rest-api.md endpoint 2) via `useRecordPayment`, and renders one of the four required
 * UI states distinctly (FR-022): loading, success, validation error, server error. Local
 * (client-side) field validation is a separate, purely presentational concern layered on top of
 * that state machine — it never fabricates a fake "validation_error" state from the hook, it just
 * prevents a submission the API would reject anyway.
 *
 * CRITICAL (FR-021, assessment out-of-scope list): this form records payment *metadata* only —
 * amount, currency, an external payment identifier, and when it was received. It MUST NEVER
 * collect a card number, bank account/routing number, or any other payment-credential field. Do
 * not add one, even behind a "future work" flag.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PaymentResponse } from "@policy-billing-core/shared";
import { useRecordPayment } from "../hooks/useRecordPayment";
import { useIdempotencyKey } from "../hooks/useIdempotencyKey";
import { formatCents, parseDollarsToCents } from "../utils/money";
import styles from "./PaymentForm.module.css";

/** How long the success panel stays visible before auto-resetting the form. */
const SUCCESS_DISPLAY_MS = 5000;

export interface PaymentFormProps {
  policyId: string;
  /** The policy's fixed currency (data-model.md), pre-filled as the default currency input value. */
  currency: string;
  /** Notified after a successful submission (recorded or idempotent replay) so a parent can refetch policy state. */
  onRecorded?: (response: PaymentResponse) => void;
}

export function PaymentForm({ policyId, currency, onRecorded }: PaymentFormProps) {
  const { state, submit, reset } = useRecordPayment();
  const {
    value: idempotencyKey,
    regenerate: regenerateIdempotencyKey,
    setValue: setIdempotencyKey,
  } = useIdempotencyKey();
  const [externalPaymentId, setExternalPaymentId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [currencyInput, setCurrencyInput] = useState(currency);
  const [receivedAt, setReceivedAt] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isSubmitting = state.status === "loading";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!idempotencyKey.trim()) {
      setLocalError("Idempotency key is required.");
      return;
    }
    if (!externalPaymentId.trim()) {
      setLocalError("External payment ID is required.");
      return;
    }
    if (!currencyInput.trim()) {
      setLocalError("Currency is required.");
      return;
    }
    if (!receivedAt) {
      setLocalError("Received-at date/time is required.");
      return;
    }
    const amountCents = parseDollarsToCents(amountInput);
    if (amountCents === null || amountCents <= 0) {
      setLocalError("Amount must be a positive dollar amount, e.g. 120.99.");
      return;
    }

    setLocalError(null);
    void submit(policyId, {
      idempotency_key: idempotencyKey.trim(),
      external_payment_id: externalPaymentId.trim(),
      amount_cents: amountCents,
      currency: currencyInput.trim().toUpperCase(),
      // `<input type="datetime-local">` yields "YYYY-MM-DDTHH:mm" with no timezone; treated as
      // UTC by appending "Z" so the wire value is an unambiguous ISO 8601 timestamp
      // (contracts/rest-api.md `received_at`).
      received_at: `${receivedAt}:00Z`,
    });
  }

  // Notify the parent (e.g. to refetch policy state) exactly once per successful submission.
  // Deliberately does NOT clear the entered fields here: a byte-identical resubmission (same
  // idempotency key + same field values) must still be possible immediately after success to
  // prove the idempotent-replay invariant (see record-payment.spec.ts) — fields only clear via
  // `handleReset`, below. Tracked via a ref rather than an effect dependency on `onRecorded`
  // alone, so a parent passing a fresh inline callback identity on every render doesn't re-fire
  // this for the same response.
  const lastNotifiedRef = useRef<PaymentResponse | null>(null);
  useEffect(() => {
    if (state.status === "success" && state.data !== lastNotifiedRef.current) {
      lastNotifiedRef.current = state.data;
      onRecorded?.(state.data);
    }
  }, [state, onRecorded]);

  const handleReset = useCallback(() => {
    reset();
    setLocalError(null);
    lastNotifiedRef.current = null;
    regenerateIdempotencyKey();
    setExternalPaymentId("");
    setAmountInput("");
    setCurrencyInput(currency);
    setReceivedAt("");
  }, [reset, regenerateIdempotencyKey, currency]);

  // Auto-hide the success panel after a few seconds so it doesn't linger indefinitely; reuses the
  // same reset path as the "Record another payment" button, so a manual click just pre-empts it.
  useEffect(() => {
    if (state.status !== "success") {
      return;
    }
    const timer = setTimeout(handleReset, SUCCESS_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [state, handleReset]);

  return (
    <section
      className={styles.section}
      aria-labelledby="payment-form-heading"
      data-testid="payment-form"
    >
      <h2 className={styles.heading} id="payment-form-heading">
        Record Received Payment
      </h2>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="payment-idempotency-key">Idempotency key</label>
          <input
            id="payment-idempotency-key"
            className={styles.keyInput}
            type="text"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            disabled={isSubmitting}
            data-testid="payment-idempotency-key-input"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="payment-external-id">External payment ID</label>
          <input
            id="payment-external-id"
            type="text"
            value={externalPaymentId}
            onChange={(e) => setExternalPaymentId(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="payment-amount">Amount ({currencyInput || currency})</label>
          <input
            id="payment-amount"
            type="text"
            inputMode="decimal"
            placeholder="120.99"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="payment-currency">Currency</label>
          <input
            id="payment-currency"
            type="text"
            value={currencyInput}
            onChange={(e) => setCurrencyInput(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="payment-received-at">Received at</label>
          <input
            id="payment-received-at"
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Recording…" : "Record Payment"}
        </button>
      </form>

      {localError && (
        <p className={styles.localError} role="alert" data-testid="payment-local-error">
          {localError}
        </p>
      )}

      {state.status === "loading" && (
        <p className={styles.loading} role="status" data-testid="payment-loading">
          Recording payment…
        </p>
      )}

      {state.status === "success" && (
        <div className={styles.success} role="status" data-testid="payment-success">
          <p>
            {state.data.idempotency_result === "duplicate_ignored"
              ? "This payment was already recorded — no new payment was created."
              : "Payment recorded."}
          </p>
          <dl>
            <dt>Payment ID</dt>
            <dd>{state.data.payment_id}</dd>
            <dt>External payment ID</dt>
            <dd>{state.data.external_payment_id}</dd>
            <dt>Amount</dt>
            <dd>{formatCents(state.data.amount_cents, currencyInput || currency)}</dd>
            <dt>Status</dt>
            <dd>{state.data.status}</dd>
          </dl>
          <button className={styles.resetButton} type="button" onClick={handleReset}>
            Record another payment
          </button>
        </div>
      )}

      {state.status === "validation_error" && (
        <div className={styles.validationError} role="alert" data-testid="payment-validation-error">
          <p>{state.message}</p>
          {state.details.length > 0 && (
            <ul>
              {state.details.map((detail) => (
                <li key={detail.field}>
                  {detail.field}: {detail.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.status === "server_error" && (
        <div className={styles.serverError} role="alert" data-testid="payment-server-error">
          <p>{state.message}</p>
        </div>
      )}
    </section>
  );
}
