/**
 * `GET /api/policies/:policyId/ledger` (contracts/rest-api.md endpoint 4, tasks.md T061). Reads
 * from `v_ledger_summary` via `db/repository.ts::getLedgerSummary` — `balanced` is computed by the
 * view, never asserted by this handler. Supports conditional GET (`ETag`/`If-None-Match`,
 * `http/conditionalGet.ts`). Mirrors `routes/policies.ts`'s structure.
 */
import { Router } from "express";
import type { LedgerSummaryResponse } from "@policy-billing-core/shared";
import { getLedgerSummary } from "../db/repository";
import { policyIdParamSchema } from "../validation/endorsementSchema";
import { respondNotModifiedIfMatching } from "../http/conditionalGet";

export const ledgerRouter = Router();

ledgerRouter.get("/:policyId/ledger", async (req, res, next) => {
  try {
    const { policyId } = policyIdParamSchema.parse(req.params);

    const ledger = await getLedgerSummary(policyId);

    const body: LedgerSummaryResponse = {
      policy_id: ledger.policyId,
      balanced: ledger.balanced,
      transactions: ledger.transactions,
    };

    if (respondNotModifiedIfMatching(req, res, body)) {
      return;
    }

    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
});
