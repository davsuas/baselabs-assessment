/**
 * `POST /api/policies/:policyId/payments` (contracts/rest-api.md endpoint 2, tasks.md T048).
 * A thin single-responsibility handler (Principle IV): validate at the boundary (zod), delegate
 * the actual mutation to `db/repository.ts::recordPayment` (which is the only thing that knows
 * about `fn_record_payment`), shape the HTTP response. All business-rule/atomicity/idempotency
 * logic lives in the SQL function, not here. Mirrors `routes/endorsements.ts`'s structure for US1.
 */
import { Router } from "express";
import { recordPayment } from "../db/repository";
import { policyIdParamSchema } from "../validation/endorsementSchema";
import { paymentRequestSchema } from "../validation/paymentSchema";

export const paymentsRouter = Router();

paymentsRouter.post("/:policyId/payments", async (req, res, next) => {
  try {
    const { policyId } = policyIdParamSchema.parse(req.params);
    const body = paymentRequestSchema.parse(req.body);

    const response = await recordPayment({
      policyId,
      idempotencyKey: body.idempotency_key,
      externalPaymentId: body.external_payment_id,
      amountCents: body.amount_cents,
      currency: body.currency,
      receivedAt: body.received_at,
    });

    // Financial mutation endpoints are never cached (constitution Principle V, research.md
    // "Response caching") — never risk serving a stale pre-mutation state on a subsequent read.
    res.set("Cache-Control", "no-store");
    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});
