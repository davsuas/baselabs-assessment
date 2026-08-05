/**
 * T040 — covers the four required UI states (FR-022) for the Apply Endorsement form:
 * loading, success (including the idempotent-replay wording), validation error (both a 400
 * `validation_error` and a 422 business-rule rejection), and server error (401/429/404/500 all
 * folding into the same state per spec.md Assumptions).
 *
 * The real `api/client.ts` reads `import.meta.env`, which ts-jest (CommonJS transform) cannot
 * parse, so it is mocked wholesale here — `apiRequest`/`ApiRequestError` are never loaded from
 * source under Jest.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EndorsementResponse } from "@policy-billing-core/shared";
import { EndorsementForm } from "../../src/components/EndorsementForm";
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
const CURRENCY = "USD";

async function fillAndSubmit(
  overrides: Partial<Record<"date" | "premium" | "reason", string>> = {},
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/effective date/i), overrides.date ?? "2026-07-01");
  await user.type(screen.getByLabelText(/new annual premium/i), overrides.premium ?? "1440.00");
  await user.type(
    screen.getByLabelText(/reason/i),
    overrides.reason ?? "Water-shutoff discount removed",
  );
  await user.click(screen.getByRole("button", { name: /apply endorsement/i }));
}

function renderForm(onApplied?: (response: EndorsementResponse) => void) {
  render(<EndorsementForm policyId={POLICY_ID} currency={CURRENCY} onApplied={onApplied} />);
}

function sentIdempotencyKey(callIndex: number): unknown {
  const call = mockApiRequest.mock.calls[callIndex];
  const body = call?.[1]?.body as { idempotency_key?: string } | undefined;
  return body?.idempotency_key;
}

const SUCCESS_RESPONSE: EndorsementResponse = {
  endorsement_id: "END-2001",
  policy_id: POLICY_ID,
  annual_premium_cents: 144000,
  billing_document: {
    id: 3001,
    type: "endorsement_adjustment",
    amount_cents: 12099,
    status: "posted",
  },
  idempotency_result: "applied",
};

describe("EndorsementForm", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("pre-fills an editable idempotency-key input with an auto-generated key", () => {
    renderForm();

    const keyInput = screen.getByLabelText(/idempotency key/i) as HTMLInputElement;
    expect(keyInput).toBeEnabled();
    expect(keyInput.value).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("sends a manually edited idempotency key instead of the auto-generated one", async () => {
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    renderForm();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/idempotency key/i));
    await user.type(screen.getByLabelText(/idempotency key/i), "END-CUSTOM-KEY");
    await fillAndSubmit();

    expect(sentIdempotencyKey(0)).toBe("END-CUSTOM-KEY");
  });

  it("blocks submission client-side with a local error when the idempotency key is cleared", async () => {
    renderForm();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/idempotency key/i));
    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-local-error")).toHaveTextContent(
      /idempotency key is required/i,
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("resends the identical idempotency_key when a failed submission is retried unchanged", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("endorsement-server-error");

    const firstKey = sentIdempotencyKey(0);
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);

    // Retry the same form instance without changing any field.
    await userEvent.setup().click(screen.getByRole("button", { name: /apply endorsement/i }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2));

    const secondKey = sentIdempotencyKey(1);
    expect(secondKey).toBe(firstKey);
    expect(screen.getByTestId("endorsement-idempotency-key-input")).toHaveValue(
      firstKey as string,
    );
  });

  it("shows a new idempotency key after clicking 'Apply another endorsement' following a success", async () => {
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("endorsement-success");
    const firstKey = (
      screen.getByTestId("endorsement-idempotency-key-input") as HTMLInputElement
    ).value;

    await userEvent.setup().click(screen.getByRole("button", { name: /apply another endorsement/i }));

    const secondKeyDisplay = screen.getByTestId("endorsement-idempotency-key-input") as HTMLInputElement;
    expect(secondKeyDisplay.value).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondKeyDisplay.value).not.toBe(firstKey);

    // Fields are cleared after a successful submission; refill them to observe the new key.
    await fillAndSubmit();
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2));

    const secondKeySent = sentIdempotencyKey(1);
    expect(secondKeySent).toBe(secondKeyDisplay.value);
    expect(secondKeySent).not.toBe(firstKey);
  });

  it("keeps the entered fields populated immediately after success, so an unchanged resubmission still replays the exact same request", async () => {
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("endorsement-success");

    expect(screen.getByLabelText(/effective date/i)).toHaveValue("2026-07-01");
    expect(screen.getByLabelText(/new annual premium/i)).toHaveValue("1440.00");
    expect(screen.getByLabelText(/reason/i)).toHaveValue("Water-shutoff discount removed");
  });

  it("auto-hides the success panel after 5 seconds, clearing the fields and regenerating the idempotency key", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("endorsement-success");
    const firstKey = (
      screen.getByTestId("endorsement-idempotency-key-input") as HTMLInputElement
    ).value;

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("endorsement-success")).not.toBeInTheDocument();
    expect(
      (screen.getByTestId("endorsement-idempotency-key-input") as HTMLInputElement).value,
    ).not.toBe(firstKey);
    expect(screen.getByLabelText(/effective date/i)).toHaveValue("");
    expect(screen.getByLabelText(/new annual premium/i)).toHaveValue("");
    expect(screen.getByLabelText(/reason/i)).toHaveValue("");
  });

  it("renders a loading state while the submission is in flight", async () => {
    let resolveRequest!: (value: { data: EndorsementResponse; etag: string | null }) => void;
    mockApiRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-loading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();

    resolveRequest({ data: SUCCESS_RESPONSE, etag: null });
    await waitFor(() =>
      expect(screen.queryByTestId("endorsement-loading")).not.toBeInTheDocument(),
    );
  });

  it("renders a success state with the returned billing document on first application", async () => {
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    const onApplied = jest.fn();
    renderForm(onApplied);

    await fillAndSubmit();

    const success = await screen.findByTestId("endorsement-success");
    expect(success).toHaveTextContent(/endorsement applied/i);
    expect(success).toHaveTextContent("$1,440.00");
    expect(success).toHaveTextContent("$120.99");
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(SUCCESS_RESPONSE);

    expect(mockApiRequest).toHaveBeenCalledWith(
      `/policies/${POLICY_ID}/endorsements`,
      expect.objectContaining({
        method: "POST",
        body: {
          idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          effective_date: "2026-07-01",
          new_annual_premium_cents: 144000,
          reason: "Water-shutoff discount removed",
        },
      }),
    );
  });

  it("renders the duplicate-replay wording distinctly on an idempotent replay", async () => {
    mockApiRequest.mockResolvedValue({
      data: { ...SUCCESS_RESPONSE, idempotency_result: "duplicate_ignored" },
      etag: null,
    });
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-success")).toHaveTextContent(/already applied/i);
  });

  it("renders a validation-error state for a 400 validation_error response with field details", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(400, {
        error: "validation_error",
        details: [{ field: "effective_date", message: "must be a valid date" }],
      }),
    );
    renderForm();

    await fillAndSubmit();

    const validationError = await screen.findByTestId("endorsement-validation-error");
    expect(validationError).toHaveTextContent(/correct the highlighted fields/i);
    expect(validationError).toHaveTextContent("effective_date: must be a valid date");
    expect(screen.queryByTestId("endorsement-server-error")).not.toBeInTheDocument();
  });

  it("renders a validation-error state for a 422 business-rule rejection", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(422, {
        error: "policy_not_active",
        message: "Policy POL-1001 is not active.",
      }),
    );
    renderForm();

    await fillAndSubmit();

    const validationError = await screen.findByTestId("endorsement-validation-error");
    expect(validationError).toHaveTextContent("Policy POL-1001 is not active.");
  });

  it("renders a validation-error state for a 409 idempotency conflict", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(409, {
        error: "idempotency_conflict",
        message: "Idempotency key END-2001 was already used with a different payload.",
      }),
    );
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-validation-error")).toHaveTextContent(
      "Idempotency key END-2001 was already used with a different payload.",
    );
  });

  it("renders a server-error state for a 500 response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-server-error")).toHaveTextContent(
      /server error occurred/i,
    );
    expect(screen.queryByTestId("endorsement-validation-error")).not.toBeInTheDocument();
  });

  it("renders a server-error state for a 401 unauthorized response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(401, { error: "unauthorized" }));
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-server-error")).toBeInTheDocument();
  });

  it("renders a server-error state for a 429 rate-limited response", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(429, { error: "rate_limited", retry_after_seconds: 5 }),
    );
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-server-error")).toBeInTheDocument();
  });

  it("renders a server-error state for a 404 not_found response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(404, { error: "not_found" }));
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("endorsement-server-error")).toHaveTextContent(
      /could not be found/i,
    );
  });

  it("blocks submission client-side with a local error and never calls the API for a malformed premium", async () => {
    renderForm();

    await fillAndSubmit({ premium: "not-a-number" });

    expect(await screen.findByTestId("endorsement-local-error")).toHaveTextContent(
      /dollar amount/i,
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("never renders a raw error body or stack trace on failure", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));
    renderForm();

    await fillAndSubmit();

    await screen.findByTestId("endorsement-server-error");
    expect(screen.queryByText(/stack/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/"error":"server_error"/)).not.toBeInTheDocument();
  });
});
