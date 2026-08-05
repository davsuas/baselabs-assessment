/**
 * zod boundary validation for `POST /api/policies/:policyId/payments` (contracts/rest-api.md
 * endpoint 2). Validates shape/type only — "is this a well-formed request" — before it reaches
 * `fn_record_payment`, which is the only place business-rule invariants (currency match, positive
 * amount) are checked against current DB state (data-model.md "Validation rules"). Thrown
 * `ZodError`s are mapped to the contract's `400 validation_error` shape by
 * `middleware/errorHandler.ts`. Mirrors `endorsementSchema.ts`'s structure for US1.
 */
import { z } from "zod";

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const paymentRequestSchema = z.object({
  idempotency_key: z.string().trim().min(1, "idempotency_key is required"),
  external_payment_id: z.string().trim().min(1, "external_payment_id is required"),
  // Money is integer cents end-to-end (constitution Principle VI) — reject non-integers/floats at
  // the boundary rather than letting them reach BIGINT SQL parameters. The `> 0` business rule
  // (FR-008) is re-validated inside fn_record_payment against DB state; zod only rejects malformed
  // shapes (non-integers) here, letting non-positive-but-well-formed amounts reach the SQL function
  // so the 422 `invalid_amount` business-rule response (not a 400) is what the client sees.
  amount_cents: z.number().int("amount_cents must be an integer number of cents"),
  currency: z
    .string()
    .trim()
    .length(3, "currency must be a 3-letter ISO 4217 code")
    .toUpperCase(),
  received_at: z
    .string()
    .regex(ISO_DATETIME_PATTERN, "received_at must be an ISO 8601 timestamp"),
});

export type PaymentRequestInput = z.infer<typeof paymentRequestSchema>;
