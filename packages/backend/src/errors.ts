/**
 * Typed application errors that `middleware/errorHandler.ts` maps 1:1 onto the response shapes in
 * contracts/rest-api.md. Route handlers and `db/repository.ts` throw these instead of writing
 * response-shaping logic inline (single responsibility — Principle IV) — the error handler is the
 * only place that knows how a thrown error becomes an HTTP response.
 */
import type {
  ApiErrorResponse,
  BusinessRuleErrorReason,
  ValidationErrorDetail,
} from "@policy-billing-core/shared";

export abstract class ApiError extends Error {
  abstract readonly statusCode: number;
  abstract readonly body: ApiErrorResponse;
}

export class ValidationApiError extends ApiError {
  readonly statusCode = 400;
  readonly body: ApiErrorResponse;

  constructor(details: ValidationErrorDetail[]) {
    super("validation_error");
    this.name = "ValidationApiError";
    this.body = { error: "validation_error", details };
  }
}

export class NotFoundApiError extends ApiError {
  readonly statusCode = 404;
  readonly body: ApiErrorResponse = { error: "not_found" };

  constructor() {
    super("not_found");
    this.name = "NotFoundApiError";
  }
}

export class IdempotencyConflictApiError extends ApiError {
  readonly statusCode = 409;
  readonly body: ApiErrorResponse;

  constructor(message: string) {
    super("idempotency_conflict");
    this.name = "IdempotencyConflictApiError";
    this.body = { error: "idempotency_conflict", message };
  }
}

/** 422 business-rule rejection: inactive policy, date outside term, currency mismatch, etc. */
export class BusinessRuleApiError extends ApiError {
  readonly statusCode = 422;
  readonly body: ApiErrorResponse;

  constructor(reason: BusinessRuleErrorReason, message: string) {
    super(String(reason));
    this.name = "BusinessRuleApiError";
    this.body = { error: reason, message };
  }
}

export class ServerApiError extends ApiError {
  readonly statusCode = 500;
  readonly body: ApiErrorResponse = { error: "server_error" };

  constructor(cause?: unknown) {
    super("server_error");
    this.name = "ServerApiError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
