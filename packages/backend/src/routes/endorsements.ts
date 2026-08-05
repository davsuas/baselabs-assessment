/**
 * `POST /api/policies/:policyId/endorsements` (contracts/rest-api.md endpoint 1, tasks.md T037).
 * A thin single-responsibility handler (Principle IV): validate at the boundary (zod), delegate
 * the actual mutation to `db/repository.ts::applyEndorsement` (which is the only thing that knows
 * about `fn_apply_endorsement`), shape the HTTP response. All business-rule/atomicity/idempotency
 * logic lives in the SQL function, not here.
 */
import { Router } from "express";
import { applyEndorsement } from "../db/repository";
import { endorsementRequestSchema, policyIdParamSchema } from "../validation/endorsementSchema";

export const endorsementsRouter = Router();

endorsementsRouter.post("/:policyId/endorsements", async (req, res, next) => {
  try {
    const { policyId } = policyIdParamSchema.parse(req.params);
    const body = endorsementRequestSchema.parse(req.body);

    const response = await applyEndorsement({
      policyId,
      idempotencyKey: body.idempotency_key,
      effectiveDate: body.effective_date,
      newAnnualPremiumCents: body.new_annual_premium_cents,
      reason: body.reason,
    });

    // Financial mutation endpoints are never cached (constitution Principle V, research.md
    // "Response caching") — never risk serving a stale pre-mutation state on a subsequent read.
    res.set("Cache-Control", "no-store");
    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});
