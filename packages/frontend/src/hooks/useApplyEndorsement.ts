/**
 * Owns the submit/loading/success/validation-error/server-error state machine (FR-022) for
 * `POST /api/policies/:policyId/endorsements` (contracts/rest-api.md endpoint 1). Consumed by
 * `EndorsementForm` — the state machine itself lives here, not duplicated in the component
 * (constitution Technology & Architecture Constraints: shared stateful logic belongs in custom
 * hooks).
 *
 * State classification (see spec.md Assumptions):
 * - `validation_error` covers every rejection attributable to what the operator submitted: a
 *   malformed request body (400 `validation_error`), a business-rule rejection (422 —
 *   `policy_not_active`, `effective_date_out_of_term`, or any other reason string), and an
 *   idempotency-key conflict (409 `idempotency_conflict`, same key/different payload).
 * - `server_error` covers everything else not attributable to caller input: `401`/`429`
 *   (spec.md Assumptions explicitly folds these into "server error" rather than a fifth UI
 *   state), `404` (the policy itself is not resolvable — not something this form's fields can
 *   fix), and `500`.
 */
import { useCallback, useState } from "react";
import type {
  BusinessRuleErrorResponse,
  EndorsementRequest,
  EndorsementResponse,
  IdempotencyConflictErrorResponse,
  ValidationErrorDetail,
  ValidationErrorResponse,
} from "@policy-billing-core/shared";
import { apiRequest, ApiRequestError } from "../api/client";

export type EndorsementSubmissionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: EndorsementResponse }
  | { status: "validation_error"; message: string; details: ValidationErrorDetail[] }
  | { status: "server_error"; message: string };

export interface UseApplyEndorsementResult {
  state: EndorsementSubmissionState;
  submit: (policyId: string, request: EndorsementRequest) => Promise<void>;
  reset: () => void;
}

/**
 * Deliberately does not switch/narrow on `body.error` via TypeScript's discriminated-union
 * inference: `BusinessRuleErrorReason` (shared/src/types.ts) includes a `string & {}` catch-all
 * so unforeseen 422 reasons still type-check, which widens `BusinessRuleErrorResponse["error"]`
 * to effectively `string` and defeats literal narrowing for every other union member too. Each
 * branch below checks the runtime `.error` value explicitly and casts to the corresponding
 * response type it has just confirmed, rather than relying on `switch` narrowing.
 */
function classifyError(error: ApiRequestError): EndorsementSubmissionState {
  const body = error.body;

  if (body.error === "validation_error") {
    const validation = body as ValidationErrorResponse;
    return {
      status: "validation_error",
      message: "Please correct the highlighted fields.",
      details: validation.details,
    };
  }
  if (body.error === "idempotency_conflict") {
    const conflict = body as IdempotencyConflictErrorResponse;
    return { status: "validation_error", message: conflict.message, details: [] };
  }
  if (body.error === "not_found") {
    return {
      status: "server_error",
      message: "Policy could not be found. Confirm the policy ID and try again.",
    };
  }
  if (body.error === "unauthorized" || body.error === "rate_limited") {
    return {
      status: "server_error",
      message: "The request could not be completed right now. Please try again shortly.",
    };
  }
  if (body.error === "server_error") {
    return { status: "server_error", message: "A server error occurred. Please try again later." };
  }
  // Remaining case is a business-rule rejection (422): policy_not_active,
  // effective_date_out_of_term, or any future machine-readable reason — attributable to the
  // submitted form data, so treated as a validation error rather than a server error.
  const businessRule = body as BusinessRuleErrorResponse;
  return { status: "validation_error", message: businessRule.message, details: [] };
}

export function useApplyEndorsement(): UseApplyEndorsementResult {
  const [state, setState] = useState<EndorsementSubmissionState>({ status: "idle" });

  const submit = useCallback(async (policyId: string, request: EndorsementRequest) => {
    setState({ status: "loading" });
    try {
      const { data } = await apiRequest<EndorsementResponse>(
        `/policies/${encodeURIComponent(policyId)}/endorsements`,
        { method: "POST", body: request },
      );
      if (data === null) {
        // Mutation endpoints are `Cache-Control: no-store` and never return 304 in practice
        // (contracts/rest-api.md); guarded defensively rather than assumed away.
        setState({ status: "server_error", message: "Received an unexpected empty response." });
        return;
      }
      setState({ status: "success", data });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setState(classifyError(error));
      } else {
        setState({ status: "server_error", message: "Unexpected error. Please try again." });
      }
    }
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, submit, reset };
}
