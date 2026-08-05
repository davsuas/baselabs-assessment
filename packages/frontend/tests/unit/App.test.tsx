/**
 * Sanity check for the frontend Jest + React Testing Library wiring (T025), now exercising the
 * real `App` -> `PolicyPage` composition (T066). Real component behavior (loading/success/
 * validation-error/server-error states) is covered by `PolicyStateView.test.tsx`,
 * `Timeline.test.tsx`, `EndorsementForm.test.tsx`, and `PaymentForm.test.tsx` — this file only
 * confirms the app shell renders and boots the fetch.
 *
 * `App` -> `PolicyPage` -> `usePolicy`/`EndorsementForm`/`PaymentForm` all import the real
 * `api/client.ts`, which reads `import.meta.env` — syntax ts-jest's CommonJS transform cannot
 * parse. Mocked wholesale here, the same way `EndorsementForm.test.tsx`/`PaymentForm.test.tsx`
 * mock it, so the module is never loaded from source under Jest.
 */
import { render, screen } from "@testing-library/react";
import App from "../../src/App";
import { apiRequest } from "../../src/api/client";

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

describe("frontend jest + RTL config", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("renders the app shell and shows a loading state while policy data is fetched", () => {
    // Never resolves within this test — asserts the initial synchronous render only.
    mockApiRequest.mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByText(/Policy Billing & Ledger Core/i)).toBeInTheDocument();
    expect(screen.getByTestId("policy-page-loading")).toBeInTheDocument();
  });
});
