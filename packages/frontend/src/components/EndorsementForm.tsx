/**
 * Apply Endorsement form (FR-020). Submits the JSON-equivalent of `EndorsementRequest`
 * (contracts/rest-api.md endpoint 1) via `useApplyEndorsement`, and renders one of the four
 * required UI states distinctly (FR-022): loading, success, validation error, server error. Local
 * (client-side) field validation is a separate, purely presentational concern layered on top of
 * that state machine — it never fabricates a fake "validation_error" state from the hook, it just
 * prevents a submission the API would reject anyway.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { EndorsementResponse } from "@policy-billing-core/shared";
import { useApplyEndorsement } from "../hooks/useApplyEndorsement";
import { useIdempotencyKey } from "../hooks/useIdempotencyKey";
import { formatCents, parseDollarsToCents } from "../utils/money";
import styles from "./EndorsementForm.module.css";

/** How long the success panel stays visible before auto-resetting the form. */
const SUCCESS_DISPLAY_MS = 5000;

export interface EndorsementFormProps {
  policyId: string;
  /** The policy's fixed currency (data-model.md), used only to format displayed amounts. */
  currency: string;
  /** Notified after a successful submission (applied or idempotent replay) so a parent can refetch policy state. */
  onApplied?: (response: EndorsementResponse) => void;
}

export function EndorsementForm({ policyId, currency, onApplied }: EndorsementFormProps) {
  const { state, submit, reset } = useApplyEndorsement();
  const {
    value: idempotencyKey,
    regenerate: regenerateIdempotencyKey,
    setValue: setIdempotencyKey,
  } = useIdempotencyKey();
  const [effectiveDate, setEffectiveDate] = useState("");
  const [premiumInput, setPremiumInput] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isSubmitting = state.status === "loading";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!idempotencyKey.trim()) {
      setLocalError("Idempotency key is required.");
      return;
    }
    if (!effectiveDate) {
      setLocalError("Effective date is required.");
      return;
    }
    if (!reason.trim()) {
      setLocalError("Reason is required.");
      return;
    }
    const newAnnualPremiumCents = parseDollarsToCents(premiumInput);
    if (newAnnualPremiumCents === null) {
      setLocalError("New annual premium must be a dollar amount, e.g. 1440.00.");
      return;
    }

    setLocalError(null);
    void submit(policyId, {
      idempotency_key: idempotencyKey.trim(),
      effective_date: effectiveDate,
      new_annual_premium_cents: newAnnualPremiumCents,
      reason: reason.trim(),
    });
  }

  // Notify the parent (e.g. to refetch policy state) exactly once per successful submission.
  // Deliberately does NOT clear the entered fields here: a byte-identical resubmission (same
  // idempotency key + same field values) must still be possible immediately after success to
  // prove the idempotent-replay invariant (see apply-endorsement.spec.ts) — fields only clear via
  // `handleReset`, below. Tracked via a ref rather than an effect dependency on `onApplied` alone,
  // so a parent passing a fresh inline callback identity on every render doesn't re-fire this for
  // the same response.
  const lastNotifiedRef = useRef<EndorsementResponse | null>(null);
  useEffect(() => {
    if (state.status === "success" && state.data !== lastNotifiedRef.current) {
      lastNotifiedRef.current = state.data;
      onApplied?.(state.data);
    }
  }, [state, onApplied]);

  const handleReset = useCallback(() => {
    reset();
    setLocalError(null);
    lastNotifiedRef.current = null;
    regenerateIdempotencyKey();
    setEffectiveDate("");
    setPremiumInput("");
    setReason("");
  }, [reset, regenerateIdempotencyKey]);

  // Auto-hide the success panel after a few seconds so it doesn't linger indefinitely; reuses the
  // same reset path as the "Apply another endorsement" button, so a manual click just pre-empts it.
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
      aria-labelledby="endorsement-form-heading"
      data-testid="endorsement-form"
    >
      <h2 className={styles.heading} id="endorsement-form-heading">
        Apply Endorsement
      </h2>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="endorsement-idempotency-key">Idempotency key</label>
          <input
            id="endorsement-idempotency-key"
            className={styles.keyInput}
            type="text"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            disabled={isSubmitting}
            data-testid="endorsement-idempotency-key-input"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="endorsement-effective-date">Effective date</label>
          <input
            id="endorsement-effective-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="endorsement-new-premium">New annual premium ({currency})</label>
          <input
            id="endorsement-new-premium"
            type="text"
            inputMode="decimal"
            placeholder="1440.00"
            value={premiumInput}
            onChange={(e) => setPremiumInput(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="endorsement-reason">Reason</label>
          <input
            id="endorsement-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Applying…" : "Apply Endorsement"}
        </button>
      </form>

      {localError && (
        <p className={styles.localError} role="alert" data-testid="endorsement-local-error">
          {localError}
        </p>
      )}

      {state.status === "loading" && (
        <p className={styles.loading} role="status" data-testid="endorsement-loading">
          Applying endorsement…
        </p>
      )}

      {state.status === "success" && (
        <div className={styles.success} role="status" data-testid="endorsement-success">
          <p>
            {state.data.idempotency_result === "duplicate_ignored"
              ? "This endorsement was already applied — no new billing document or event was created."
              : "Endorsement applied."}
          </p>
          <dl>
            <dt>Endorsement ID</dt>
            <dd>{state.data.endorsement_id}</dd>
            <dt>New annual premium</dt>
            <dd>{formatCents(state.data.annual_premium_cents, currency)}</dd>
            <dt>Billing document amount</dt>
            <dd>{formatCents(state.data.billing_document.amount_cents, currency)}</dd>
            <dt>Billing document status</dt>
            <dd>{state.data.billing_document.status}</dd>
          </dl>
          <button className={styles.resetButton} type="button" onClick={handleReset}>
            Apply another endorsement
          </button>
        </div>
      )}

      {state.status === "validation_error" && (
        <div
          className={styles.validationError}
          role="alert"
          data-testid="endorsement-validation-error"
        >
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
        <div className={styles.serverError} role="alert" data-testid="endorsement-server-error">
          <p>{state.message}</p>
        </div>
      )}
    </section>
  );
}
