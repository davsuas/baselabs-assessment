# Phase 0 Research: Frontend Visual Polish & Auto-Generated Idempotency Keys

No `NEEDS CLARIFICATION` markers remain in `plan.md`'s Technical Context (the three scope-defining
questions were resolved interactively during `/speckit-specify`). This document records the concrete
technical decisions needed to move from that resolved scope into Phase 1 design.

## 1. Idempotency key generation mechanism

**Decision**: Generate the key with `crypto.randomUUID()`. Provide a fallback generator (RFC-4122-ish
v4 UUID assembled from `crypto.getRandomValues()`) for the edge case identified in spec.md
("very old browser without `crypto.randomUUID`"), rather than blocking submission.

**Rationale**: `crypto.randomUUID()` is a standard Web Crypto API, available in all evergreen browsers
this project targets (no new dependency, no polyfill package). It produces a token in the exact shape
(a UUID string) the backend idempotency contract already expects as an opaque `idempotency_key` string
(`contracts/rest-api.md`), so there is zero backend-facing change. The `getRandomValues()` fallback
still uses the Web Crypto API (not `Math.random()`), preserving the "overwhelmingly unique" property
(FR-005) even on the fallback path.

**Alternatives considered**:
- A small `uuid` npm package — rejected: adds a runtime dependency for something the platform already
  provides, and this feature's explicit constraint is *zero new runtime dependencies*.
- `Date.now()` + counter — rejected: not collision-resistant across two tabs/instances open at once
  (an identified edge case this feature must not regress).

## 2. Key lifecycle: when to (re)generate

**Decision**: Generate once when the form's `useIdempotencyKey()` hook first mounts. Hold that value in
`useState` (not re-derived on every render). Regenerate only when the form's existing `reset()` path
runs — i.e. the same moment `EndorsementForm`/`PaymentForm` already clear `localError` and
`lastNotifiedRef` after a successful submission (`handleReset`, see `EndorsementForm.tsx:73-77` /
`PaymentForm.tsx:87-91`). A failed submission does **not** trigger `reset()` today (the hook's
`state.status` becomes `"validation_error"`/`"server_error"`, not cleared), so a retry from that same
form instance naturally reuses the same key with no extra logic — this is the mechanism that
satisfies FR-004.

**Rationale**: Piggy-backing on the existing reset boundary (rather than inventing a new one) keeps the
change minimal and avoids a second source of truth for "is this a new logical submission." It exactly
matches the acceptance scenarios in spec.md (US1, scenarios 2–3).

**Alternatives considered**:
- Regenerate a new key on every keystroke/field change — rejected: defeats the purpose of retry-safety;
  a user correcting a typo after a validation error would silently get a different key on resubmit,
  which is the exact hazard this feature exists to eliminate for the *manual* version of the field.
- Regenerate on a timer (e.g. every N minutes) — rejected: unrequested complexity (YAGNI/Principle IV),
  no scenario in spec.md calls for time-based expiry, and the backend contract does not define
  key-expiry semantics to align with.

## 3. Styling approach

**Decision**: CSS Modules (`*.module.css`, one per component/page) plus a single shared
`src/styles/tokens.css` of CSS custom properties (spacing scale, type scale, a small neutral +
one-accent color palette) imported once at the app root (`App.tsx` or `main.tsx`) and referenced via
`var(--token-name)` from each module.

**Rationale**: Zero new dependencies — Vite has built-in `*.module.css` support, and
`jest.config.ts:11-13` already maps CSS imports to `identity-obj-proxy`, meaning this path was
pre-wired before this feature existed. Scoped class names avoid any risk of one component's polish
leaking into another's layout. A shared token file is the smallest possible way to keep spacing/type/
color consistent across 6 files without building a component library (Principle VII) — it's a handful
of CSS variables, not an installable/reusable package, and stays inside "light polish."

**Alternatives considered**:
- Tailwind CSS or a CSS-in-JS library (styled-components, Emotion) — rejected outright by the
  user-confirmed "no design system" scope decision; also each is a new runtime/build dependency.
- One global (non-Module) stylesheet — rejected: class-name collisions across 6 components sharing one
  namespace are exactly the kind of accidental coupling CSS Modules exist to prevent, for no benefit
  over Modules at this scale.
- A component library (Radix, MUI, shadcn/ui) — explicitly rejected per spec.md's clarified scope and
  the constitution's standing constraint.

## 4. Preserving existing test hooks during the visual pass

**Decision**: Every `data-testid`, `role`, and `aria-*` attribute in `PolicyStateView.tsx`,
`Timeline.tsx`, `PolicyPage.tsx` stays on the exact same DOM element it's on today; CSS Module
`className`s are additive only. `EndorsementForm.tsx`/`PaymentForm.tsx` lose the
`#endorsement-idempotency-key`/`#payment-idempotency-key` `<input>` and its `<label>` (per FR-001) and
gain a read-only display element with a new, analogous `data-testid`
(`endorsement-idempotency-key-display` / `payment-idempotency-key-display`) — this is the one
intentional, spec-mandated DOM change; every other existing hook is preserved verbatim.

**Rationale**: FR-008 is explicit that the redesign must not require rewriting existing test
assertions. Treating "preserve hooks, add classNames" as a hard rule during implementation is what
makes that requirement mechanically checkable (run the existing suite unmodified except for the two
tests directly covering the removed key input).

## 5. Responsive behavior at 375px

**Decision**: Use `max-width: 100%` on layout containers, a single-column flex/stack layout for the
page shell (no CSS grid areas that could force overflow), and avoid any fixed pixel widths wider than
375px on interactive controls. No dedicated mobile breakpoint/media-query system is introduced beyond
what's needed to prevent overflow.

**Rationale**: FR-010/SC-005 require no horizontal overflow at 375px, not a tailored mobile experience
(spec.md Edge Cases explicitly says a dedicated responsive experience is not a stated goal). A
fluid, single-column-friendly layout satisfies the requirement without introducing a breakpoint system,
keeping scope aligned with "light polish."

**Alternatives considered**:
- A responsive grid with defined breakpoints — rejected as more than this feature's stated goal
  requires (YAGNI).
