# Implementation Plan: Frontend Visual Polish & Auto-Generated Idempotency Keys

**Branch**: `BLAB-002-frontend-ux-redesign` | **Date**: 2026-08-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/BLAB-002-frontend-ux-redesign/spec.md`

## Summary

Two changes to the existing minimal frontend (`packages/frontend`): (1) replace the manually-typed
"Idempotency key" text input on `EndorsementForm` and `PaymentForm` with a client-generated key (`crypto.randomUUID()`),
displayed read-only, held stable across retries of the same form instance and regenerated only on
reset/new submission; (2) a light, hand-authored CSS pass (CSS Modules + a small shared design-token
file, no component library/framework) across the whole Policy page — shell, state view, timeline, and
both forms — for visual hierarchy, spacing, and typography, while preserving every existing
`data-testid`/`role`/`aria-*` hook the current Jest/RTL suite depends on. No backend, contract, or
data-model change: `idempotency_key` continues to be sent as the same opaque string field already
defined in `contracts/rest-api.md`.

## Technical Context

**Language/Version**: TypeScript 5.5 (strict), React 19, targeting the same toolchain already in
`packages/frontend/package.json` — no version bumps required.

**Primary Dependencies**: React 19 (existing). No new runtime npm dependency is introduced — the UUID
key comes from the standard `crypto.randomUUID()` Web API already available in evergreen browsers; CSS
Modules are a Vite/Jest built-in (Vite handles `*.module.css` natively; Jest already maps
`\.(css|less|scss|sass)$` to `identity-obj-proxy` in `jest.config.ts:12`, i.e. this path was already
anticipated and needs no config change).

**Storage**: N/A — the idempotency key is ephemeral client-side component state, never persisted
beyond the form instance's lifecycle (not localStorage/sessionStorage).

**Testing**: Jest + React Testing Library (existing `tests/unit/*.test.tsx` suite). New/updated cases
for: key auto-generation on mount, key stability across a failed-then-retried submission, key
regeneration after a successful submission (via the existing "Apply/Record another" reset button), and
absence of any idempotency-key `<input>` in the DOM. Existing tests' `data-testid`/`role` queries MUST
keep passing unmodified per FR-008 — this plan does not rewrite existing test assertions, only adds to
them.

**Target Platform**: Same as today — evergreen desktop/mobile browsers (Chrome/Firefox/Safari/Edge)
serving the single local operator UI; no server-rendering or new deployment target.

**Project Type**: Web application, frontend-only slice of the existing `packages/frontend` workspace
package (monorepo, per `CLAUDE.md`'s confirmed repository layout). No backend or shared-package change.

**Performance Goals**: N/A — not a performance-sensitive feature. Constraint is *no regression*: zero
new runtime dependencies, no measurable bundle-size increase beyond the CSS itself.

**Constraints**:
- Zero new runtime npm dependencies (constitution: "No UI component library or design system beyond
  the minimal Frontend requirement"; user-clarified as "light polish, no design system").
- All CSS is hand-authored, scoped per-component via CSS Modules — no global framework stylesheet, no
  installable/reusable design-system package.
- Every existing `data-testid`, `role`, and `aria-*` attribute referenced by current tests is preserved
  verbatim (FR-008).
- No functional/validation/field changes to either form beyond the idempotency-key change (FR-009); no
  card/bank credential fields (constitution Principle V/VII, unchanged from BLAB-001).
- Layout usable with no horizontal overflow at 375px viewport width (FR-010, SC-005).

**Scale/Scope**: 1 new hook (`useIdempotencyKey`), edits to 2 existing form components
(`EndorsementForm`, `PaymentForm`) to consume it, a CSS Module per existing component/page (6 files:
`App`, `PolicyPage`, `PolicyStateView`, `Timeline`, `EndorsementForm`, `PaymentForm`) plus one shared
`tokens.css` for spacing/type/color custom properties. No new pages, routes, or backend surface.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Result |
|---|---|---|
| I. TDD (NON-NEGOTIABLE) | New behavior (key generation/stability/regeneration) gets RTL tests written alongside the hook/component changes; existing required-coverage tests (proration, duplicate delivery, wrong-currency, ledger balance, hash-chain) are backend-owned and untouched by this frontend-only feature. | PASS |
| II. Financial Integrity (Atomicity, Idempotency, Balance) | The idempotency *contract* is unchanged — same key + same payload still yields the original result server-side. This feature only changes *who/what* produces the key (browser crypto API instead of a human), and guarantees the client-side stability property (same key across retries of one logical submission) the backend already assumes. No backend/ledger code touched. | PASS |
| III. Append-Only Auditable History | N/A — no policy-event or ledger code touched by this feature. | N/A |
| IV. Simplicity (SOLID/KISS/DRY/YAGNI) | One small hook (`useIdempotencyKey`) reused by both forms (DRY without over-abstracting); CSS Modules per component keep styles co-located and easy to explain; no new state-machine, no new abstraction layers over the existing `useApplyEndorsement`/`useRecordPayment` hooks. | PASS |
| V. Security by Default | `crypto.randomUUID()` is a standard, cryptographically-strong browser API — no new input surface, no new secret, no new SQL/API surface. Read-only display of the key introduces no new user-editable field. | PASS |
| VI. Raw SQL & Integer-Cents Money | N/A — no backend/database code touched. | N/A |
| VII. Scoped, Timeboxed Delivery | Directly governs this feature's central constraint: "a polished design system... MUST NOT be built." This plan's CSS-Modules-only, zero-new-dependency approach is the user-confirmed reading of that constraint ("light polish, no design system") — see spec.md Assumptions. | PASS (by design) |

No violations requiring the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
docs/BLAB-002-frontend-ux-redesign/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── ui-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/frontend/
├── src/
│   ├── App.tsx                          # unchanged logic; gains App.module.css
│   ├── App.module.css                   # NEW — page-shell layout
│   ├── styles/
│   │   └── tokens.css                   # NEW — shared spacing/type/color custom properties
│   ├── hooks/
│   │   ├── useIdempotencyKey.ts         # NEW — generate/hold/regenerate a UUID key
│   │   ├── useApplyEndorsement.ts       # unchanged
│   │   ├── usePolicy.ts                 # unchanged
│   │   └── useRecordPayment.ts          # unchanged
│   ├── components/
│   │   ├── EndorsementForm.tsx          # edited — drop key input, use useIdempotencyKey, read-only display
│   │   ├── EndorsementForm.module.css   # NEW
│   │   ├── PaymentForm.tsx              # edited — same pattern
│   │   ├── PaymentForm.module.css       # NEW
│   │   ├── PolicyStateView.tsx          # edited — apply CSS Module classes only, no markup/testid change
│   │   ├── PolicyStateView.module.css   # NEW
│   │   ├── Timeline.tsx                 # edited — apply CSS Module classes only, no markup/testid change
│   │   └── Timeline.module.css          # NEW
│   └── pages/
│       ├── PolicyPage.tsx               # edited — apply CSS Module classes only, no markup/testid change
│       └── PolicyPage.module.css        # NEW
└── tests/unit/
    ├── EndorsementForm.test.tsx         # edited — replace key-input assertions with auto-gen assertions
    ├── PaymentForm.test.tsx             # edited — same
    └── useIdempotencyKey.test.ts        # NEW — generation, stability, regeneration
```

**Structure Decision**: Frontend-only change inside the existing `packages/frontend` workspace package
(monorepo layout already established by BLAB-001). No new package, no backend/shared-package edits. CSS
Modules keep styles co-located with the component they style (one `.module.css` per component/page)
plus a single shared `src/styles/tokens.css` for the handful of values (spacing scale, type scale,
color palette) that must be consistent across components — this is the smallest structure that avoids
both global-CSS collisions and a "design system package," matching Principle IV/VII.

## Complexity Tracking

*No Constitution Check violations — table intentionally omitted.*
