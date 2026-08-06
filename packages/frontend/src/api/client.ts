/**
 * Thin fetch wrapper (T026). Injects the `X-API-Key` header and base URL from build-time Vite
 * config (`VITE_API_BASE_URL`, `VITE_API_KEY`) on every call, and normalizes non-2xx responses
 * into `ApiRequestError` so custom hooks (research.md's frontend decision — not a data-fetching
 * library) can distinguish validation/business-rule/server failures for the four required UI
 * states (FR-022).
 *
 * `VITE_API_BASE_URL` defaults to the same-origin relative path `/api` (qa-developer fix for the
 * test-e2e containerized-profile blocker) rather than an absolute `http://localhost:3000/api` —
 * the browser always calls same-origin, and `vite.config.ts`'s dev-server proxy forwards `/api/*`
 * to the real backend, wherever it is reachable from the dev-server process (host vs. Compose
 * network). See `vite.config.ts` for the proxy target logic.
 */
import type { ApiErrorResponse } from "@policy-billing-core/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorResponse,
  ) {
    super(`API request failed (${status}): ${body.error}`);
    this.name = "ApiRequestError";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiResult<TResponse> {
  data: TResponse;
  /** Present on GET responses that support conditional caching (ETag/If-None-Match). */
  etag: string | null;
}

/**
 * Issues one API request. Returns `{ data: null, etag }` only for a `304 Not Modified` response
 * to a conditional GET (caller already holds the current data); every other response either
 * resolves with parsed JSON or throws `ApiRequestError`.
 */
export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<TResponse | null>> {
  const { method = "GET", body, headers = {} } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const etag = response.headers.get("ETag");

  if (response.status === 304) {
    return { data: null, etag };
  }

  if (!response.ok) {
    const errorBody = (await response
      .json()
      .catch((): ApiErrorResponse => ({ error: "server_error" }))) as ApiErrorResponse;
    throw new ApiRequestError(response.status, errorBody);
  }

  const data = (await response.json()) as TResponse;
  return { data, etag };
}
