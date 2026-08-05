/**
 * `GET /api/policies/:policyId` (contracts/rest-api.md endpoint 3, tasks.md T060). Composes
 * `v_policy_summary` + `v_policy_billing_documents` + `v_policy_payments` (via
 * `db/repository.ts::getPolicySummary`) with `fn_verify_policy_history` (via
 * `db/repository.ts::verifyPolicyHistory`) and the FR-023 plain-English summary/suggested_action
 * text (`http/policySummaryText.ts`). Supports conditional GET (`ETag`/`If-None-Match`,
 * `http/conditionalGet.ts`) — a thin single-responsibility handler (Principle IV): all business
 * logic lives in the SQL views/function or the small pure text helper, not here.
 */
import { Router } from "express";
import type { PolicySummaryResponse } from "@policy-billing-core/shared";
import { getPolicySummary, verifyPolicyHistory } from "../db/repository";
import { policyIdParamSchema } from "../validation/endorsementSchema";
import { respondNotModifiedIfMatching } from "../http/conditionalGet";
import { buildPolicySummaryText } from "../http/policySummaryText";

export const policiesRouter = Router();

policiesRouter.get("/:policyId", async (req, res, next) => {
  try {
    const { policyId } = policyIdParamSchema.parse(req.params);

    const [summary, history] = await Promise.all([
      getPolicySummary(policyId),
      verifyPolicyHistory(policyId),
    ]);

    const { summary: summaryText, suggested_action } = buildPolicySummaryText({
      policyId: summary.policyId,
      status: summary.status,
      openBalanceCents: summary.openBalanceCents,
      historyValid: history.valid,
    });

    const body: PolicySummaryResponse = {
      policy_id: summary.policyId,
      status: summary.status,
      annual_premium_cents: summary.annualPremiumCents,
      currency: summary.currency,
      term_start: summary.termStart,
      term_end: summary.termEnd,
      open_balance_cents: summary.openBalanceCents,
      billing_documents: summary.billingDocuments,
      payments: summary.payments,
      history: { valid: history.valid, event_count: history.eventCount },
      summary: summaryText,
      suggested_action,
    };

    if (respondNotModifiedIfMatching(req, res, body)) {
      return;
    }

    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
});
