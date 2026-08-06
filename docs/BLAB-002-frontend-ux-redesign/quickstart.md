# Quickstart: Validating Frontend Visual Polish & Auto-Generated Idempotency Keys

Prerequisites: the BLAB-001 stack running locally (backend + Postgres reachable), per that feature's
own quickstart. This feature adds no new prerequisites.

## 1. Run the frontend

```bash
cd packages/frontend
npm install   # only if dependencies changed — this feature adds none
npm run dev
```

Open the printed local URL and load an existing policy (any seeded `policy_id` from BLAB-001's
`policy.json` fixture).

## 2. Verify the idempotency key is gone from the UI as an input (US1, SC-001)

- On the Apply Endorsement form: confirm there is no "Idempotency key" text input.
- Confirm a read-only key value is visible near the submit button
  (`data-testid="endorsement-idempotency-key-display"`).
- Fill in the remaining fields and submit; confirm the request succeeds without ever having typed a key.
- Repeat for Record Received Payment (`payment-idempotency-key-display`).

## 3. Verify key stability across a retry (US1 scenario 2, SC-002)

- With the browser devtools Network tab open, submit an endorsement with valid data but temporarily
  block/offline the network (devtools "Offline" throttling) so the request fails.
- Note the displayed key value and the `idempotency_key` sent in the failed request payload.
- Re-enable the network and resubmit without changing any field.
- Confirm the displayed key value and the outgoing `idempotency_key` are identical to the first attempt.
- Confirm the backend records exactly one billing document/event for this endorsement (check
  `GET /api/policies/:policyId` or the ledger endpoint — no duplicate).

## 4. Verify key regeneration on a new submission (US1 scenario 3)

- Successfully submit an endorsement, then click "Apply another endorsement."
- Confirm the displayed key value changes from the prior submission's key.

## 5. Verify the visual pass (US2, SC-003, SC-004, SC-005)

- Visually confirm the Policy page (state view, timeline, both forms) shares consistent spacing,
  typography, and color rather than unstyled browser defaults.
- Trigger each of the four UI states (loading, success, validation error, server error) on both forms
  and confirm each is visually distinct.
- Resize the browser (or devtools device toolbar) to 375px width; confirm no horizontal scrollbar
  appears and all controls remain visible/operable.
- Diff `packages/frontend/package.json` against the pre-feature version; confirm no new
  `dependencies`/`devDependencies` were added for styling or UI components.

## 6. Run the automated suite

```bash
cd packages/frontend
npm test
```

Confirm the full suite passes, including:
- `tests/unit/useIdempotencyKey.test.ts` (new)
- `tests/unit/EndorsementForm.test.tsx` / `PaymentForm.test.tsx` (updated: key-input assertions replaced
  with auto-generation/display assertions; all other existing assertions in these files pass unmodified)
- `tests/unit/PolicyStateView.test.tsx`, `Timeline.test.tsx`, `PolicyPage.test.tsx`, `App.test.tsx`
  (unmodified — passing confirms the visual pass did not touch any existing testid/role hook)
