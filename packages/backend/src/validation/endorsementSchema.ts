/**
 * zod boundary validation for `POST /api/policies/:policyId/endorsements`
 * (contracts/rest-api.md endpoint 1). Validates shape/type only — "is this a well-formed
 * request" — before it reaches `fn_apply_endorsement`, which is the only place business-rule
 * invariants (policy active, date-in-term) are checked against current DB state
 * (data-model.md "Validation rules"). Thrown `ZodError`s are mapped to the contract's
 * `400 validation_error` shape by `middleware/errorHandler.ts`.
 */
import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const policyIdParamSchema = z.object({
  policyId: z.string().trim().min(1, "policyId is required"),
});

export const endorsementRequestSchema = z.object({
  idempotency_key: z.string().trim().min(1, "idempotency_key is required"),
  effective_date: z
    .string()
    .regex(ISO_DATE_PATTERN, "effective_date must be an ISO 8601 date (YYYY-MM-DD)"),
  // Money is integer cents end-to-end (constitution Principle VI) — reject non-integers/floats at
  // the boundary rather than letting them reach BIGINT SQL parameters.
  new_annual_premium_cents: z
    .number()
    .int("new_annual_premium_cents must be an integer number of cents")
    .nonnegative("new_annual_premium_cents must not be negative"),
  reason: z.string().trim().min(1, "reason is required"),
});

export type EndorsementRequestInput = z.infer<typeof endorsementRequestSchema>;
