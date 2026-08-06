/**
 * Covers `PolicyPage` composing `usePolicy` (T063) with `PolicyStateView`/`Timeline`/
 * `EndorsementForm`/`PaymentForm` (T066): the loading/success/error states for the read side
 * (FR-019, FR-022), and the ETag-based conditional refetch (`If-None-Match`, keeping existing data
 * on a `304`) that isn't otherwise exercised by `PolicyStateView.test.tsx`/`Timeline.test.tsx`
 * (which test those two components as pure presentational components, not through the hook). Added
 * beyond the T067/T068 task list, mirroring how `useApplyEndorsement`/`useRecordPayment` are
 * exercised only indirectly through their forms' tests rather than in a standalone hook test file.
 *
 * `apiRequest`/`ApiRequestError` mocked wholesale, same pattern as `EndorsementForm.test.tsx`/
 * `PaymentForm.test.tsx`/`App.test.tsx` (`import.meta.env` in the real `api/client.ts` can't be
 * parsed by ts-jest's CommonJS transform).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  EndorsementResponse,
  LedgerSummaryResponse,
  PolicySummaryResponse,
} from "@policy-billing-core/shared";
import { PolicyPage } from "../../src/pages/PolicyPage";
import { apiRequest, ApiRequestError } from "../../src/api/client";

jest.mock("../../src/api/client", () => {
  class MockApiRequestError extends Error {
    constructor(
      public readonly status: number,
      public readonly body: unknown,
    ) {
      super(`API request failed (${status})`);
      this.name = "ApiRequestError";
    }
  }
  return {
    apiRequest: jest.fn(),
    ApiRequestError: MockApiRequestError,
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const POLICY_ID = "POL-1001";

const POLICY: PolicySummaryResponse = {
  policy_id: POLICY_ID,
  status: "active",
  annual_premium_cents: 144000,
  currency: "USD",
  term_start: "2026-01-01",
  term_end: "2027-01-01",
  open_balance_cents: 0,
  billing_documents: [
    { id: 3001, type: "endorsement_adjustment", amount_cents: 12099, status: "posted" },
  ],
  payments: [],
  history: { valid: true, event_count: 1 },
  summary: "Policy POL-1001 is active with an open balance of $0.00.",
  suggested_action: "No action required",
};

const LEDGER: LedgerSummaryResponse = {
  policy_id: POLICY_ID,
  balanced: true,
  transactions: [{ id: 1, source: "END-2001", debits_cents: 12099, credits_cents: 12099 }],
};

describe("PolicyPage", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("renders a loading state before the initial fetch resolves", () => {
    mockApiRequest.mockReturnValue(new Promise(() => {}));

    render(<PolicyPage policyId={POLICY_ID} />);

    expect(screen.getByTestId("policy-page-loading")).toBeInTheDocument();
  });

  it("renders the policy state, timeline, and both forms once the fetch succeeds", async () => {
    mockApiRequest.mockImplementation(async (path) => {
      if (path === `/policies/${POLICY_ID}/ledger`) {
        return { data: LEDGER, etag: null };
      }
      return { data: POLICY, etag: null };
    });

    render(<PolicyPage policyId={POLICY_ID} />);

    expect(await screen.findByTestId("policy-state-view")).toBeInTheDocument();
    expect(screen.getByTestId("timeline")).toBeInTheDocument();
    expect(screen.getByTestId("endorsement-form")).toBeInTheDocument();
    expect(screen.getByTestId("payment-form")).toBeInTheDocument();
    expect(screen.queryByTestId("policy-page-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("policy-page-error")).not.toBeInTheDocument();
  });

  it("renders a readable error state for a 404 not_found response, not a raw error body", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(404, { error: "not_found" }));

    render(<PolicyPage policyId={POLICY_ID} />);

    const error = await screen.findByTestId("policy-page-error");
    expect(error).toHaveTextContent(/could not be found/i);
    expect(screen.queryByText(/"error":"not_found"/)).not.toBeInTheDocument();
  });

  it("renders a server-error state for a 500 response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));

    render(<PolicyPage policyId={POLICY_ID} />);

    const error = await screen.findByTestId("policy-page-error");
    expect(error).toHaveTextContent(/unable to load policy data/i);
  });

  it(
    "sends If-None-Match using each resource's last-seen ETag on refetch, and keeps existing " +
      "data when a resource replies 304",
    async () => {
      const calls: Array<{ path: string; headers?: Record<string, string> }> = [];

      mockApiRequest.mockImplementation(async (path, options) => {
        calls.push({ path, headers: options?.headers });

        if (path === `/policies/${POLICY_ID}/endorsements`) {
          const endorsementResponse: EndorsementResponse = {
            endorsement_id: "END-2001",
            policy_id: POLICY_ID,
            annual_premium_cents: 156099,
            billing_document: {
              id: 3002,
              type: "endorsement_adjustment",
              amount_cents: 12099,
              status: "posted",
            },
            idempotency_result: "applied",
          };
          return { data: endorsementResponse, etag: null };
        }

        const isFirstCallForPath = calls.filter((c) => c.path === path).length === 1;

        if (path === `/policies/${POLICY_ID}/ledger`) {
          return isFirstCallForPath
            ? { data: LEDGER, etag: "etag-ledger-1" }
            // Refetch: ledger changed (new transaction) -> a fresh 200, not a 304.
            : {
                data: {
                  ...LEDGER,
                  transactions: [
                    ...LEDGER.transactions,
                    { id: 2, source: "END-2001", debits_cents: 12099, credits_cents: 12099 },
                  ],
                },
                etag: "etag-ledger-2",
              };
        }

        // `/policies/:id`
        return isFirstCallForPath
          ? { data: POLICY, etag: "etag-policy-1" }
          // Refetch: policy unchanged -> simulate the server replying 304 (no body).
          : { data: null, etag: "etag-policy-1" };
      });

      render(<PolicyPage policyId={POLICY_ID} />);
      await screen.findByTestId("policy-state-view");

      const endorsementForm = within(screen.getByTestId("endorsement-form"));
      const user = userEvent.setup();
      // The idempotency key field is pre-filled with an auto-generated key (BLAB-002 US1), so it's
      // left untouched here — no need to type into it for a normal submission.
      await user.type(endorsementForm.getByLabelText(/effective date/i), "2026-07-01");
      await user.type(endorsementForm.getByLabelText(/new annual premium/i), "1560.99");
      await user.type(endorsementForm.getByLabelText(/reason/i), "Added coverage");
      await user.click(endorsementForm.getByRole("button", { name: /apply endorsement/i }));

      await screen.findByTestId("endorsement-success");

      // The refetch triggered by `onApplied` should have re-requested both GETs.
      await waitFor(() => {
        const policyCalls = calls.filter((c) => c.path === `/policies/${POLICY_ID}`);
        expect(policyCalls.length).toBeGreaterThanOrEqual(2);
      });

      const policyCalls = calls.filter((c) => c.path === `/policies/${POLICY_ID}`);
      const ledgerCalls = calls.filter((c) => c.path === `/policies/${POLICY_ID}/ledger`);

      // First call for each resource carries no If-None-Match (no prior ETag yet).
      expect(policyCalls[0]?.headers?.["If-None-Match"]).toBeUndefined();
      expect(ledgerCalls[0]?.headers?.["If-None-Match"]).toBeUndefined();

      // Refetch sends back exactly the ETag returned by the first response for that resource.
      expect(policyCalls[1]?.headers?.["If-None-Match"]).toBe("etag-policy-1");
      expect(ledgerCalls[1]?.headers?.["If-None-Match"]).toBe("etag-ledger-1");

      // Policy 304'd on refetch -> the originally-fetched premium is still displayed (not blanked).
      expect(screen.getByTestId("policy-state-premium")).toHaveTextContent("$1,440.00");

      // Ledger returned a fresh 200 on refetch -> the new transaction is now shown.
      await waitFor(() =>
        expect(screen.getByTestId("timeline-ledger-transaction-2")).toBeInTheDocument(),
      );
    },
  );
});
