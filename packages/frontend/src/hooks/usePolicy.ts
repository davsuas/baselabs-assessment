/**
 * Owns the fetch/conditional-refetch/loading/success/error state machine (FR-019, FR-022) for the
 * read side of User Story 3: `GET /api/policies/:policyId` and `GET /api/policies/:policyId/ledger`
 * (contracts/rest-api.md endpoints 3 and 4). Consumed by `PolicyPage`, which passes the resolved
 * data down to the presentational `PolicyStateView`/`Timeline` components — the fetch logic itself
 * lives here, not duplicated per component (constitution Technology & Architecture Constraints).
 *
 * Deliberate design choices:
 * - `GET /api/policies/:policyId` already embeds `history` (valid/event_count, contracts/rest-api.md
 *   endpoint 3) — the state view's "history-verification status" is read from that embedded field
 *   rather than issuing a separate call to endpoint 5 (`.../history/verify`). Endpoint 5 exists for a
 *   caller that wants to verify in isolation; the aggregate policy view already carries everything
 *   FR-019/FR-023 need, so a second round-trip for the same information would violate YAGNI
 *   (constitution Principle IV). Flagged here as a pragmatic scope decision, not an oversight.
 * - Only three states are modeled (`loading`/`success`/`error`), not four: FR-022's four-state
 *   requirement (loading/success/validation-error/server-error) is about *submissions*, which have
 *   user input that can be invalid. A `GET` here carries no caller-supplied fields to validate — any
 *   rejection (401/404/429/500) is uniformly "the data could not be loaded" and is presented as a
 *   single error state, consistent with how `useApplyEndorsement`/`useRecordPayment` already fold
 *   401/429/404/500 together on the server-error side (spec.md Assumptions).
 * - Conditional caching: each of the two GETs tracks its own last-seen `ETag` and sends it back as
 *   `If-None-Match` on every subsequent fetch for that resource (including background refetches
 *   triggered by a successful form submission). A `304` carries no body (`apiRequest` resolves
 *   `data: null` for it), so the previously-fetched value for that resource is kept rather than
 *   discarded.
 * - A refetch (triggered by `refetch()`, e.g. after a successful endorsement/payment submission)
 *   does not blank the screen back to the `loading` state if data is already displayed — that would
 *   hide the very state the operator just changed. Instead `isRefetching` is exposed alongside the
 *   still-current `success` state so a caller can show a small in-place indicator.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerSummaryResponse, PolicySummaryResponse } from "@policy-billing-core/shared";
import { apiRequest, ApiRequestError } from "../api/client";

export interface PolicyPageData {
  policy: PolicySummaryResponse;
  ledger: LedgerSummaryResponse;
}

export type PolicyQueryState =
  | { status: "loading" }
  | { status: "success"; data: PolicyPageData }
  | { status: "error"; message: string };

export interface UsePolicyResult {
  state: PolicyQueryState;
  /** True while a background refetch is in flight and `state` still holds the previous success data. */
  isRefetching: boolean;
  /** Re-issues both GETs, sending each resource's last-seen ETag as `If-None-Match`. */
  refetch: () => void;
}

function describeError(policyId: string, error: ApiRequestError): string {
  const body = error.body;

  if (body.error === "not_found") {
    return `Policy ${policyId} could not be found. Confirm the policy ID and try again.`;
  }
  if (body.error === "unauthorized" || body.error === "rate_limited") {
    return "The request could not be completed right now. Please try again shortly.";
  }
  // server_error, and any other shape not expected on a GET (validation_error,
  // idempotency_conflict, a business-rule reason) — none of these are attributable to something an
  // operator can fix by re-viewing this page, so they all render as the same generic message.
  return "Unable to load policy data right now. Please try again shortly.";
}

export function usePolicy(policyId: string): UsePolicyResult {
  const [state, setState] = useState<PolicyQueryState>({ status: "loading" });
  const [isRefetching, setIsRefetching] = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);

  const policyEtagRef = useRef<string | null>(null);
  const ledgerEtagRef = useRef<string | null>(null);
  const lastDataRef = useRef<PolicyPageData | null>(null);

  useEffect(() => {
    // Reset conditional-caching state on a genuine policy-id change; a `refetchToken` bump alone
    // (same policy) intentionally keeps the etag refs so the `If-None-Match` conditional GET works.
    policyEtagRef.current = null;
    ledgerEtagRef.current = null;
    lastDataRef.current = null;
  }, [policyId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const hasExistingData = lastDataRef.current !== null;
      if (hasExistingData) {
        setIsRefetching(true);
      } else {
        setState({ status: "loading" });
      }

      try {
        const [policyResult, ledgerResult] = await Promise.all([
          apiRequest<PolicySummaryResponse>(`/policies/${encodeURIComponent(policyId)}`, {
            headers: policyEtagRef.current ? { "If-None-Match": policyEtagRef.current } : {},
          }),
          apiRequest<LedgerSummaryResponse>(
            `/policies/${encodeURIComponent(policyId)}/ledger`,
            {
              headers: ledgerEtagRef.current ? { "If-None-Match": ledgerEtagRef.current } : {},
            },
          ),
        ]);

        if (cancelled) return;

        if (policyResult.etag) policyEtagRef.current = policyResult.etag;
        if (ledgerResult.etag) ledgerEtagRef.current = ledgerResult.etag;

        // `data` is null only on a 304 — keep the previously-fetched value for that resource.
        const policy = policyResult.data ?? lastDataRef.current?.policy ?? null;
        const ledger = ledgerResult.data ?? lastDataRef.current?.ledger ?? null;

        if (policy === null || ledger === null) {
          // A 304 with nothing previously cached shouldn't happen (no ETag would have been sent
          // in the first place), but guarded defensively rather than rendering a broken view.
          setState({ status: "error", message: "Received an unexpected empty response." });
          setIsRefetching(false);
          return;
        }

        const data: PolicyPageData = { policy, ledger };
        lastDataRef.current = data;
        setState({ status: "success", data });
        setIsRefetching(false);
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof ApiRequestError
            ? describeError(policyId, error)
            : "Unexpected error while loading policy data. Please try again.";
        setState({ status: "error", message });
        setIsRefetching(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [policyId, refetchToken]);

  const refetch = useCallback(() => setRefetchToken((token) => token + 1), []);

  return { state, isRefetching, refetch };
}
