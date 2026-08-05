# UI Contract: Frontend Visual Polish & Auto-Generated Idempotency Keys

No REST API contract change — `contracts/rest-api.md` (BLAB-001) is untouched by this feature. This
document is this application-type feature's substitute for an API contract (per `/speckit-plan`'s
Phase 1 guidance: "UI contracts for applications") — the stable surface other work (tests, Playwright
specs, future features) can depend on.

## `useIdempotencyKey()` hook contract

```ts
export function useIdempotencyKey(): {
  value: string;               // non-empty UUID string, present from first render
  regenerate: () => void;
  setValue: (value: string) => void;
};
```

- Consumed by `EndorsementForm` and `PaymentForm` only (no other component needs an idempotency key).
- Callers pass `value` as the `idempotency_key` field of the existing `EndorsementRequest`/
  `PaymentRequest` payloads (`@policy-billing-core/shared` types, unchanged) — the wire contract with
  the backend is identical to today's.
- Callers invoke `regenerate()` from their existing `handleReset` function (the same function already
  invoked by the "Apply another endorsement" / "Record another payment" buttons after a success, and
  by the success-panel auto-hide timer), and from nowhere else.
- **AMENDMENT (post-implementation)**: the original design in this document made the key a read-only
  display with no `setValue`. That broke `playwright/tests/apply-endorsement.spec.ts` and
  `record-payment.spec.ts`, which rely on `page.getByLabel("Idempotency key").fill(...)` to drive
  idempotency-replay/conflict scenarios directly — a `<label>`-less read-only `<output>` isn't
  reachable via `getByLabel`. Reverted to an editable `<input>` (retaining the `<label
  htmlFor="...">` association) pre-filled by `value` and wired to `setValue` via `onChange`, so the
  auto-generation UX is preserved (nothing to type for the common case) while manual override/e2e
  automation still works.

## DOM/testing contract changes

| Component | Field | testid | Notes |
|---|---|---|---|
| `EndorsementForm` | `#endorsement-idempotency-key` `<input>` + `<label>` (unchanged element, pre-filled/editable) | `endorsement-idempotency-key-input` | Value auto-generated on mount via `useIdempotencyKey()`; user may edit it; regenerated on reset. |
| `PaymentForm` | `#payment-idempotency-key` `<input>` + `<label>` (unchanged element, pre-filled/editable) | `payment-idempotency-key-input` | Same as above. |
| both | — | `endorsement-local-error` / `payment-local-error` | Now also renders "Idempotency key is required." if the field is cleared before submit (restored client-side check). |
| `PolicyStateView`, `Timeline`, `PolicyPage` | — | — | Every existing `data-testid`/`role`/`aria-labelledby` (full list: `PolicyStateView.tsx`, `Timeline.tsx`, `PolicyPage.tsx`) — visual pass only, no markup contract change. |

Playwright specs continue to target the field via `getByLabel("Idempotency key")` — unaffected by
this amendment.

## CSS contract

- One `*.module.css` file per component/page listed in plan.md's Project Structure; class names are
  local to that file (CSS Modules scoping) and MUST NOT be imported/reused across components.
- `src/styles/tokens.css` custom properties (data-model.md) are the only values shared across modules;
  no component may hardcode a spacing/color/font-size value already defined as a token.
- No global stylesheet resets beyond a minimal box-sizing/margin reset in `tokens.css` — no CSS
  framework, no component-library stylesheet import.
