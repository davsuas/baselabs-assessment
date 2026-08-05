/**
 * TypeScript types mirroring every request/response/error shape in
 * `docs/BLAB-001-policy-billing-core/contracts/rest-api.md`, shared by the backend (as the
 * source of truth its route handlers serialize to) and the frontend (as the shape its API client
 * and hooks consume). Money fields are always integer cents (`*_cents`) — never floats
 * (constitution Principle VI).
 *
 * Keep this file in sync with contracts/rest-api.md; it is the only place these shapes are
 * defined (DRY — Principle IV).
 */

// ---------------------------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------------------------

/** ISO 4217 currency code, e.g. "USD". */
export type CurrencyCode = string;

/** `YYYY-MM-DD` calendar date, as sent/returned over the wire (contracts/rest-api.md). */
export type IsoDateString = string;

/** ISO 8601 timestamp, e.g. "2026-07-03T18:30:00Z". */
export type IsoDateTimeString = string;

export type IdempotencyResult = "applied" | "duplicate_ignored";

export type PolicyStatus = "active" | "cancelled" | "expired";

// ---------------------------------------------------------------------------------------------
// 1. POST /api/policies/:policyId/endorsements
// ---------------------------------------------------------------------------------------------

export interface EndorsementRequest {
  idempotency_key: string;
  effective_date: IsoDateString;
  new_annual_premium_cents: number;
  reason: string;
}

export interface BillingDocumentSummary {
  id: number;
  type: "endorsement_adjustment";
  amount_cents: number;
  status: string;
}

export interface EndorsementResponse {
  endorsement_id: string;
  policy_id: string;
  annual_premium_cents: number;
  billing_document: BillingDocumentSummary;
  idempotency_result: IdempotencyResult;
}

// ---------------------------------------------------------------------------------------------
// 2. POST /api/policies/:policyId/payments
// ---------------------------------------------------------------------------------------------

export interface PaymentRequest {
  idempotency_key: string;
  external_payment_id: string;
  amount_cents: number;
  currency: CurrencyCode;
  received_at: IsoDateTimeString;
}

export interface PaymentResponse {
  payment_id: number;
  external_payment_id: string;
  policy_id: string;
  amount_cents: number;
  status: string;
  idempotency_result: IdempotencyResult;
}

// ---------------------------------------------------------------------------------------------
// 3. GET /api/policies/:policyId
// ---------------------------------------------------------------------------------------------

export interface PaymentSummary {
  id: number;
  external_payment_id: string;
  amount_cents: number;
  status: string;
}

export interface HistoryVerificationSummary {
  valid: boolean;
  event_count: number;
}

export interface PolicySummaryResponse {
  policy_id: string;
  status: PolicyStatus;
  annual_premium_cents: number;
  currency: CurrencyCode;
  term_start: IsoDateString;
  term_end: IsoDateString;
  open_balance_cents: number;
  billing_documents: BillingDocumentSummary[];
  payments: PaymentSummary[];
  history: HistoryVerificationSummary;
  /** Server-derived plain-English summary (FR-023) — never inferred client-side. */
  summary: string;
  /** Server-derived suggested next action (FR-023) — never inferred client-side. */
  suggested_action: string;
}

// ---------------------------------------------------------------------------------------------
// 4. GET /api/policies/:policyId/ledger
// ---------------------------------------------------------------------------------------------

export interface LedgerTransactionSummary {
  id: number;
  /** The idempotency key of the endorsement/payment that produced this transaction. */
  source: string;
  debits_cents: number;
  credits_cents: number;
}

export interface LedgerSummaryResponse {
  policy_id: string;
  /** true only if every transaction's debits equal its credits (SC-005) — computed by the view. */
  balanced: boolean;
  transactions: LedgerTransactionSummary[];
}

// ---------------------------------------------------------------------------------------------
// 5. GET /api/policies/:policyId/history/verify
// ---------------------------------------------------------------------------------------------

export interface HistoryVerifyResponse {
  policy_id: string;
  valid: boolean;
  event_count: number;
  /** Present only when `valid` is `false`. */
  first_broken_event_id?: number;
}

// ---------------------------------------------------------------------------------------------
// Error shapes (contracts/rest-api.md "Cross-cutting rules")
// ---------------------------------------------------------------------------------------------

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

export interface UnauthorizedErrorResponse {
  error: "unauthorized";
}

export interface RateLimitedErrorResponse {
  error: "rate_limited";
  retry_after_seconds: number;
}

export interface ValidationErrorResponse {
  error: "validation_error";
  details: ValidationErrorDetail[];
}

export interface NotFoundErrorResponse {
  error: "not_found";
}

export interface IdempotencyConflictErrorResponse {
  error: "idempotency_conflict";
  message: string;
}

/**
 * Machine-readable business-rule rejection reasons (422) named explicitly in
 * contracts/rest-api.md. `BusinessRuleErrorResponse.error` is typed as a union of these plus
 * `string` so the API layer isn't blocked on this list if a future rule is added, while these
 * known values still autocomplete for reviewers writing tests against the contract.
 */
export type BusinessRuleErrorReason =
  | "policy_not_active"
  | "effective_date_out_of_term"
  | "currency_mismatch"
  | "invalid_amount"
  | (string & {});

export interface BusinessRuleErrorResponse {
  error: BusinessRuleErrorReason;
  message: string;
}

export interface ServerErrorResponse {
  error: "server_error";
}

export type ApiErrorResponse =
  | UnauthorizedErrorResponse
  | RateLimitedErrorResponse
  | ValidationErrorResponse
  | NotFoundErrorResponse
  | IdempotencyConflictErrorResponse
  | BusinessRuleErrorResponse
  | ServerErrorResponse;
