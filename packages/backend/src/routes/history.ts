/**
 * `GET /api/policies/:policyId/history/verify` (contracts/rest-api.md endpoint 5, tasks.md T062).
 * Calls `fn_verify_policy_history` via `db/repository.ts::verifyPolicyHistory`, which recomputes
 * the hash chain rather than trusting a stored flag (constitution Principle III). A tampered chain
 * is still a successful `200` call reporting `valid: false` with `first_broken_event_id` — not an
 * error response (contracts/rest-api.md). Supports conditional GET (`ETag`/`If-None-Match`,
 * `http/conditionalGet.ts`). Mirrors `routes/policies.ts`/`routes/ledger.ts`'s structure.
 */
import { Router } from "express";
import type { HistoryVerifyResponse } from "@policy-billing-core/shared";
import { verifyPolicyHistory } from "../db/repository";
import { policyIdParamSchema } from "../validation/endorsementSchema";
import { respondNotModifiedIfMatching } from "../http/conditionalGet";

export const historyRouter = Router();

historyRouter.get("/:policyId/history/verify", async (req, res, next) => {
  try {
    const { policyId } = policyIdParamSchema.parse(req.params);

    const history = await verifyPolicyHistory(policyId);

    const body: HistoryVerifyResponse = {
      policy_id: history.policyId,
      valid: history.valid,
      event_count: history.eventCount,
      ...(history.firstBrokenEventId !== undefined && {
        first_broken_event_id: history.firstBrokenEventId,
      }),
    };

    if (respondNotModifiedIfMatching(req, res, body)) {
      return;
    }

    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
});
