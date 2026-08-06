/**
 * T051 — covers the four required UI states (FR-022) for the Record Received Payment form:
 * loading, success (including the idempotent-replay wording), validation error (a 400
 * `validation_error`, a 422 `currency_mismatch` business-rule rejection, and a 409 idempotency
 * conflict), and server error (401/429/404/500 all folding into the same state per spec.md
 * Assumptions). Also asserts the form never renders a card-number or bank-credential field
 * (FR-021 — explicit out-of-scope security regression to guard against).
 *
 * The real `api/client.ts` reads `import.meta.env`, which ts-jest (CommonJS transform) cannot
 * parse, so it is mocked wholesale here — `apiRequest`/`ApiRequestError` are never loaded from
 * source under Jest.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaymentResponse } from "@policy-billing-core/shared";
import { PaymentForm } from "../../src/components/PaymentForm";
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
  overrides: Partial<
    Record<"externalId" | "amount" | "currency" | "receivedAt", string>
  > = {},
) {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText(/external payment id/i),
    overrides.externalId ?? "PAY-9001",
  );
  await user.type(screen.getByLabelText(/^amount/i), overrides.amount ?? "120.99");

  const currencyField = screen.getByLabelText(/^currency$/i);
  if (overrides.currency !== undefined) {
    await user.clear(currencyField);
    if (overrides.currency) {
      await user.type(currencyField, overrides.currency);
    }
  }

  await user.type(
    screen.getByLabelText(/received at/i),
    overrides.receivedAt ?? "2026-07-03T18:30",
  );
  await user.click(screen.getByRole("button", { name: /record payment/i }));
}

function renderForm(onRecorded?: (response: PaymentResponse) => void) {
  render(<PaymentForm policyId={POLICY_ID} currency={CURRENCY} onRecorded={onRecorded} />);
}

function sentIdempotencyKey(callIndex: number): unknown {
  const call = mockApiRequest.mock.calls[callIndex];
  const body = call?.[1]?.body as { idempotency_key?: string } | undefined;
  return body?.idempotency_key;
}

const SUCCESS_RESPONSE: PaymentResponse = {
  payment_id: 9001,
  external_payment_id: "PAY-9001",
  policy_id: POLICY_ID,
  amount_cents: 12099,
  status: "applied",
  idempotency_result: "applied",
};

describe("PaymentForm", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("never renders a card-number or bank-credential field (FR-021)", () => {
    renderForm();

    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/routing number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/account number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cvv|cvc/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/expir/i)).not.toBeInTheDocument();
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
    await user.type(screen.getByLabelText(/idempotency key/i), "PAY-CUSTOM-KEY");
    await fillAndSubmit();

    expect(sentIdempotencyKey(0)).toBe("PAY-CUSTOM-KEY");
  });

  it("blocks submission client-side with a local error when the idempotency key is cleared", async () => {
    renderForm();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/idempotency key/i));
    await fillAndSubmit();

    expect(await screen.findByTestId("payment-local-error")).toHaveTextContent(
      /idempotency key is required/i,
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("resends the identical idempotency_key when a failed submission is retried unchanged", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("payment-server-error");

    const firstKey = sentIdempotencyKey(0);
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);

    // Retry the same form instance without changing any field.
    await userEvent.setup().click(screen.getByRole("button", { name: /record payment/i }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2));

    const secondKey = sentIdempotencyKey(1);
    expect(secondKey).toBe(firstKey);
    expect(screen.getByTestId("payment-idempotency-key-input")).toHaveValue(firstKey as string);
  });

  it("shows a new idempotency key after clicking 'Record another payment' following a success", async () => {
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("payment-success");
    const firstKey = (
      screen.getByTestId("payment-idempotency-key-input") as HTMLInputElement
    ).value;

    await userEvent.setup().click(screen.getByRole("button", { name: /record another payment/i }));

    const secondKeyDisplay = screen.getByTestId("payment-idempotency-key-input") as HTMLInputElement;
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
    await screen.findByTestId("payment-success");

    expect(screen.getByLabelText(/external payment id/i)).toHaveValue("PAY-9001");
    expect(screen.getByLabelText(/^amount/i)).toHaveValue("120.99");
    expect(screen.getByLabelText(/^currency$/i)).toHaveValue(CURRENCY);
    expect(screen.getByLabelText(/received at/i)).toHaveValue("2026-07-03T18:30");
  });

  it("auto-hides the success panel after 5 seconds, clearing the fields and regenerating the idempotency key", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    renderForm();

    await fillAndSubmit();
    await screen.findByTestId("payment-success");
    const firstKey = (
      screen.getByTestId("payment-idempotency-key-input") as HTMLInputElement
    ).value;

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId("payment-success")).not.toBeInTheDocument();
    expect(
      (screen.getByTestId("payment-idempotency-key-input") as HTMLInputElement).value,
    ).not.toBe(firstKey);
    expect(screen.getByLabelText(/external payment id/i)).toHaveValue("");
    expect(screen.getByLabelText(/^amount/i)).toHaveValue("");
    expect(screen.getByLabelText(/^currency$/i)).toHaveValue(CURRENCY);
    expect(screen.getByLabelText(/received at/i)).toHaveValue("");
  });

  it("renders a loading state while the submission is in flight", async () => {
    let resolveRequest!: (value: { data: PaymentResponse; etag: string | null }) => void;
    mockApiRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("payment-loading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recording/i })).toBeDisabled();

    resolveRequest({ data: SUCCESS_RESPONSE, etag: null });
    await waitFor(() => expect(screen.queryByTestId("payment-loading")).not.toBeInTheDocument());
  });

  it("renders a success state with the returned payment on first submission", async () => {
    mockApiRequest.mockResolvedValue({ data: SUCCESS_RESPONSE, etag: null });
    const onRecorded = jest.fn();
    renderForm(onRecorded);

    await fillAndSubmit();

    const success = await screen.findByTestId("payment-success");
    expect(success).toHaveTextContent(/payment recorded/i);
    expect(success).toHaveTextContent("$120.99");
    expect(success).toHaveTextContent("9001");
    expect(success).toHaveTextContent("applied");
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(onRecorded).toHaveBeenCalledWith(SUCCESS_RESPONSE);

    expect(mockApiRequest).toHaveBeenCalledWith(
      `/policies/${POLICY_ID}/payments`,
      expect.objectContaining({
        method: "POST",
        body: {
          idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          external_payment_id: "PAY-9001",
          amount_cents: 12099,
          currency: "USD",
          received_at: "2026-07-03T18:30:00Z",
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

    expect(await screen.findByTestId("payment-success")).toHaveTextContent(/already recorded/i);
  });

  it("renders a validation-error state for a 400 validation_error response with field details", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(400, {
        error: "validation_error",
        details: [{ field: "amount_cents", message: "must be a positive integer" }],
      }),
    );
    renderForm();

    await fillAndSubmit();

    const validationError = await screen.findByTestId("payment-validation-error");
    expect(validationError).toHaveTextContent(/correct the highlighted fields/i);
    expect(validationError).toHaveTextContent("amount_cents: must be a positive integer");
    expect(screen.queryByTestId("payment-server-error")).not.toBeInTheDocument();
  });

  it("renders a validation-error state for a 422 currency_mismatch business-rule rejection", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(422, {
        error: "currency_mismatch",
        message: "Payment currency EUR does not match policy currency USD.",
      }),
    );
    renderForm();

    await fillAndSubmit({ currency: "EUR" });

    const validationError = await screen.findByTestId("payment-validation-error");
    expect(validationError).toHaveTextContent(
      "Payment currency EUR does not match policy currency USD.",
    );
  });

  it("renders a validation-error state for a 409 idempotency conflict", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(409, {
        error: "idempotency_conflict",
        message: "Idempotency key PAY-9001 was already used with a different payload.",
      }),
    );
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("payment-validation-error")).toHaveTextContent(
      "Idempotency key PAY-9001 was already used with a different payload.",
    );
  });

  it("renders a server-error state for a 500 response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("payment-server-error")).toHaveTextContent(
      /server error occurred/i,
    );
    expect(screen.queryByTestId("payment-validation-error")).not.toBeInTheDocument();
  });

  it("renders a server-error state for a 401 unauthorized response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(401, { error: "unauthorized" }));
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("payment-server-error")).toBeInTheDocument();
  });

  it("renders a server-error state for a 429 rate-limited response", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiRequestError(429, { error: "rate_limited", retry_after_seconds: 5 }),
    );
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("payment-server-error")).toBeInTheDocument();
  });

  it("renders a server-error state for a 404 not_found response", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(404, { error: "not_found" }));
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByTestId("payment-server-error")).toHaveTextContent(
      /could not be found/i,
    );
  });

  it("blocks submission client-side with a local error and never calls the API for a malformed amount", async () => {
    renderForm();

    await fillAndSubmit({ amount: "not-a-number" });

    expect(await screen.findByTestId("payment-local-error")).toHaveTextContent(
      /positive dollar amount/i,
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("blocks submission client-side for a zero amount", async () => {
    renderForm();

    await fillAndSubmit({ amount: "0" });

    expect(await screen.findByTestId("payment-local-error")).toHaveTextContent(
      /positive dollar amount/i,
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("never renders a raw error body or stack trace on failure", async () => {
    mockApiRequest.mockRejectedValue(new ApiRequestError(500, { error: "server_error" }));
    renderForm();

    await fillAndSubmit();

    await screen.findByTestId("payment-server-error");
    expect(screen.queryByText(/stack/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/"error":"server_error"/)).not.toBeInTheDocument();
  });
});
