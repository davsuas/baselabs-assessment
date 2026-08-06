/**
 * The only module in `packages/backend/src` that names a SQL function/view (constitution
 * Principle VI). Route handlers call these typed functions instead of touching `pool`/SQL
 * directly — every call here is a single parameterized call to a hand-written PostgreSQL
 * function/view, never an inline ad-hoc INSERT/UPDATE/multi-statement SELECT.
 *
 * Error mapping: `fn_apply_endorsement` (db/migrations/007_create_functions.sql) raises with
 * custom 5-char SQLSTATEs (`BLB01`..`BLB04`) instead of relying on free-text message parsing, so
 * this module can translate a thrown `DatabaseError` into the exact typed `ApiError` the contract
 * requires without string-matching a human-readable message.
 */
import { DatabaseError } from "pg";
import type {
  BillingDocumentSummary,
  EndorsementResponse,
  LedgerTransactionSummary,
  PaymentResponse,
  PaymentSummary,
  PolicyStatus,
} from "@policy-billing-core/shared";
import { pool } from "./pool";
import {
  BusinessRuleApiError,
  IdempotencyConflictApiError,
  NotFoundApiError,
  ServerApiError,
} from "../errors";

/** SQLSTATEs raised by fn_apply_endorsement (007_create_functions.sql) mapped to typed ApiErrors. */
function mapEndorsementDatabaseError(err: DatabaseError): never {
  switch (err.code) {
    case "BLB01":
      throw new NotFoundApiError();
    case "BLB02":
      throw new BusinessRuleApiError("policy_not_active", err.message);
    case "BLB03":
      throw new BusinessRuleApiError("effective_date_out_of_term", err.message);
    case "BLB04":
      throw new IdempotencyConflictApiError(err.message);
    default:
      throw new ServerApiError(err);
  }
}

/** SQLSTATEs raised by fn_record_payment (007_create_functions.sql) mapped to typed ApiErrors. */
function mapPaymentDatabaseError(err: DatabaseError): never {
  switch (err.code) {
    case "BLB01":
      throw new NotFoundApiError();
    case "BLB04":
      throw new IdempotencyConflictApiError(err.message);
    case "BLB05":
      throw new BusinessRuleApiError("currency_mismatch", err.message);
    case "BLB06":
      throw new BusinessRuleApiError("invalid_amount", err.message);
    default:
      throw new ServerApiError(err);
  }
}

export interface ApplyEndorsementParams {
  policyId: string;
  idempotencyKey: string;
  effectiveDate: string;
  newAnnualPremiumCents: number;
  reason: string;
}

interface FnApplyEndorsementRow {
  policy_id: string;
  annual_premium_cents: string; // BIGINT comes back as a string from `pg` — see note below.
  billing_document_id: string;
  billing_document_type: "endorsement_adjustment";
  billing_document_amount_cents: string;
  billing_document_status: string;
  idempotency_result: "applied" | "duplicate_ignored";
}

export async function applyEndorsement(
  params: ApplyEndorsementParams,
): Promise<EndorsementResponse> {
  try {
    const result = await pool.query<FnApplyEndorsementRow>(
      `SELECT * FROM fn_apply_endorsement($1, $2, $3, $4, $5)`,
      [
        params.policyId,
        params.idempotencyKey,
        params.effectiveDate,
        params.newAnnualPremiumCents,
        params.reason,
      ],
    );

    const row = result.rows[0];

    return {
      // The endorsement's public identifier is its idempotency key (contracts/rest-api.md example:
      // "endorsement_id": "END-2001", the same value as the request's idempotency_key).
      endorsement_id: params.idempotencyKey,
      policy_id: row.policy_id,
      // BIGINT columns are returned as strings by node-postgres to avoid silent precision loss;
      // cents amounts in this domain are always far below Number.MAX_SAFE_INTEGER, so Number(...)
      // is safe here and keeps the wire format an integer per contracts/rest-api.md.
      annual_premium_cents: Number(row.annual_premium_cents),
      billing_document: {
        id: Number(row.billing_document_id),
        type: row.billing_document_type,
        amount_cents: Number(row.billing_document_amount_cents),
        status: row.billing_document_status,
      },
      idempotency_result: row.idempotency_result,
    };
  } catch (err) {
    if (err instanceof DatabaseError) {
      mapEndorsementDatabaseError(err);
    }
    throw new ServerApiError(err);
  }
}

export interface RecordPaymentParams {
  policyId: string;
  idempotencyKey: string;
  externalPaymentId: string;
  amountCents: number;
  currency: string;
  receivedAt: string;
}

interface FnRecordPaymentRow {
  payment_id: string; // BIGINT comes back as a string from `pg` — see note in applyEndorsement.
  external_payment_id: string;
  policy_id: string;
  amount_cents: string;
  status: string;
  idempotency_result: "applied" | "duplicate_ignored";
}

export async function recordPayment(params: RecordPaymentParams): Promise<PaymentResponse> {
  try {
    const result = await pool.query<FnRecordPaymentRow>(
      `SELECT * FROM fn_record_payment($1, $2, $3, $4, $5, $6)`,
      [
        params.policyId,
        params.idempotencyKey,
        params.externalPaymentId,
        params.amountCents,
        params.currency,
        params.receivedAt,
      ],
    );

    const row = result.rows[0];

    return {
      payment_id: Number(row.payment_id),
      external_payment_id: row.external_payment_id,
      policy_id: row.policy_id,
      amount_cents: Number(row.amount_cents),
      status: row.status,
      idempotency_result: row.idempotency_result,
    };
  } catch (err) {
    if (err instanceof DatabaseError) {
      mapPaymentDatabaseError(err);
    }
    throw new ServerApiError(err);
  }
}

// -------------------------------------------------------------------------------------------
// T059 (US3): read-side repository functions backing the three GET endpoints
// (contracts/rest-api.md endpoints 3-5). Each is a single parameterized SELECT against a
// hand-written view/function (008_create_views.sql, 007_create_functions.sql) — never an ad-hoc
// join of the base tables (constitution Principle VI).
// -------------------------------------------------------------------------------------------

/** SQLSTATEs raised by fn_verify_policy_history (007_create_functions.sql) mapped to typed ApiErrors. */
function mapHistoryDatabaseError(err: DatabaseError): never {
  switch (err.code) {
    case "BLB01":
      throw new NotFoundApiError();
    default:
      throw new ServerApiError(err);
  }
}

interface VPolicySummaryRow {
  policy_id: string;
  status: PolicyStatus;
  annual_premium_cents: string; // BIGINT comes back as a string from `pg` — see applyEndorsement.
  currency: string;
  term_start: string; // DATE comes back as an ISO date string ("YYYY-MM-DD") with `pg`'s defaults.
  term_end: string;
  updated_at: string;
  open_balance_cents: string;
}

interface VPolicyBillingDocumentRow {
  id: string;
  type: "endorsement_adjustment";
  amount_cents: string;
  status: string;
}

interface VPolicyPaymentRow {
  id: string;
  external_payment_id: string;
  amount_cents: string;
  status: string;
}

export interface PolicySummaryData {
  policyId: string;
  status: PolicyStatus;
  annualPremiumCents: number;
  currency: string;
  termStart: string;
  termEnd: string;
  openBalanceCents: number;
  /** Not part of the API response body; folded into the route's ETag basis (research.md). */
  updatedAt: string;
  billingDocuments: BillingDocumentSummary[];
  payments: PaymentSummary[];
}

/**
 * Backs `GET /api/policies/:policyId` (minus history verification and the derived
 * summary/suggested_action text, which the route composes separately — `verifyPolicyHistory` below
 * is also independently reused by `GET .../history/verify`, so it isn't folded into this function).
 * Throws `NotFoundApiError` when `v_policy_summary` returns no row for `policyId` (unknown policy).
 */
export async function getPolicySummary(policyId: string): Promise<PolicySummaryData> {
  const summaryResult = await pool.query<VPolicySummaryRow>(
    `SELECT * FROM v_policy_summary WHERE policy_id = $1`,
    [policyId],
  );
  const summaryRow = summaryResult.rows[0];

  if (!summaryRow) {
    throw new NotFoundApiError();
  }

  const [billingDocumentsResult, paymentsResult] = await Promise.all([
    pool.query<VPolicyBillingDocumentRow>(
      `SELECT * FROM v_policy_billing_documents WHERE policy_id = $1`,
      [policyId],
    ),
    pool.query<VPolicyPaymentRow>(`SELECT * FROM v_policy_payments WHERE policy_id = $1`, [
      policyId,
    ]),
  ]);

  return {
    policyId: summaryRow.policy_id,
    status: summaryRow.status,
    annualPremiumCents: Number(summaryRow.annual_premium_cents),
    currency: summaryRow.currency,
    termStart: summaryRow.term_start,
    termEnd: summaryRow.term_end,
    openBalanceCents: Number(summaryRow.open_balance_cents),
    updatedAt: summaryRow.updated_at,
    billingDocuments: billingDocumentsResult.rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      amount_cents: Number(row.amount_cents),
      status: row.status,
    })),
    payments: paymentsResult.rows.map((row) => ({
      id: Number(row.id),
      external_payment_id: row.external_payment_id,
      amount_cents: Number(row.amount_cents),
      status: row.status,
    })),
  };
}

interface VLedgerSummaryRow {
  transaction_id: string | null;
  source: string | null;
  debits_cents: string;
  credits_cents: string;
  balanced: boolean;
}

export interface LedgerSummaryData {
  policyId: string;
  balanced: boolean;
  transactions: LedgerTransactionSummary[];
}

/**
 * Backs `GET /api/policies/:policyId/ledger`. `v_ledger_summary` always returns exactly one row
 * per existing `policy_id` (with `transaction_id IS NULL` when there's no history yet) and zero
 * rows for an unknown policy — see 008_create_views.sql's view comment — so a single query tells
 * this function apart from a 404 without a separate existence check.
 */
export async function getLedgerSummary(policyId: string): Promise<LedgerSummaryData> {
  const result = await pool.query<VLedgerSummaryRow>(
    `SELECT * FROM v_ledger_summary WHERE policy_id = $1 ORDER BY transaction_id`,
    [policyId],
  );

  if (result.rows.length === 0) {
    throw new NotFoundApiError();
  }

  const transactions = result.rows
    .filter((row) => row.transaction_id !== null)
    .map((row) => ({
      id: Number(row.transaction_id),
      source: row.source as string,
      debits_cents: Number(row.debits_cents),
      credits_cents: Number(row.credits_cents),
    }));

  return {
    policyId,
    balanced: result.rows.every((row) => row.balanced),
    transactions,
  };
}

interface FnVerifyPolicyHistoryRow {
  policy_id: string;
  valid: boolean;
  event_count: string;
  first_broken_event_id: string | null;
}

export interface HistoryVerificationData {
  policyId: string;
  valid: boolean;
  eventCount: number;
  firstBrokenEventId?: number;
}

/** Backs `GET /api/policies/:policyId/history/verify`, and the embedded `history` field of endpoint 3. */
export async function verifyPolicyHistory(policyId: string): Promise<HistoryVerificationData> {
  try {
    const result = await pool.query<FnVerifyPolicyHistoryRow>(
      `SELECT * FROM fn_verify_policy_history($1)`,
      [policyId],
    );
    const row = result.rows[0];

    return {
      policyId: row.policy_id,
      valid: row.valid,
      eventCount: Number(row.event_count),
      firstBrokenEventId:
        row.first_broken_event_id === null ? undefined : Number(row.first_broken_event_id),
    };
  } catch (err) {
    if (err instanceof DatabaseError) {
      mapHistoryDatabaseError(err);
    }
    throw new ServerApiError(err);
  }
}
