# Tasks: Frontend Visual Polish & Auto-Generated Idempotency Keys

**Input**: Design documents from `docs/BLAB-002-frontend-ux-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included — plan.md's Technical Context and Testing section explicitly name the test files
this feature adds/updates, so tests are in scope (not optional) for this feature.

**Organization**: Tasks are grouped by user story (spec.md: US1 = idempotency key auto-generation, P1;
US2 = visual polish, P2) so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 or US2, per spec.md priorities
- All paths are relative to `packages/frontend/`

## Phase 1: Setup

No setup tasks required. This feature adds no new package, no new runtime/dev dependency, and no
build/test config change — `packages/frontend` already exists with Vite + Jest wired exactly as
research.md §3 describes (Jest's `jest.config.ts:11-13` already maps CSS imports to
`identity-obj-proxy`; Vite handles `*.module.css` natively). Work starts directly at Phase 3.

## Phase 2: Foundational

No cross-story blocking prerequisites. `useIdempotencyKey` (US1) and the CSS/token work (US2) touch
disjoint concerns of the same files and neither blocks the other's *start* — US1 is sequenced first
only because it's the P1/MVP story and because US2's form styling tasks apply on top of US1's edited
JSX (see Dependencies below), not because of a shared infrastructure requirement.

---

## Phase 3: User Story 1 - Submit a form without inventing an idempotency key (Priority: P1) 🎯 MVP

**Goal**: Both forms generate and hold their own idempotency key client-side; the user never types one.

**Independent Test**: Open either form, confirm no idempotency-key input exists, submit successfully.
Force a retry of the same submission and confirm the same key is reused (no duplicate backend effect).
Submit again for a new entry and confirm a new key is generated. (spec.md, US1 Independent Test)

### Tests for User Story 1

- [X] T001 [P] [US1] Write `useIdempotencyKey` hook tests in `tests/unit/useIdempotencyKey.test.ts`: generates a non-empty UUID-shaped `value` on first render; `value` is stable across re-renders without calling `regenerate()`; calling `regenerate()` replaces `value` with a different UUID-shaped string. Per the contract in `contracts/ui-contract.md` and `data-model.md`'s IdempotencyKey state-transition diagram.
- [X] T003 [P] [US1] Update `tests/unit/EndorsementForm.test.tsx`: remove the `idempotency key` field interaction from the `fillAndSubmit` helper; add an assertion that no element matches `getByLabelText(/idempotency key/i)`; add an assertion that a read-only key is shown via `getByTestId("endorsement-idempotency-key-display")`; change every existing `body: { idempotency_key: "END-2001", ... }` assertion to `idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/i)`; add a new test that a failed submission retried without changing fields resends the identical `idempotency_key`, and a new test that clicking "Apply another endorsement" after success changes the displayed/sent key on the next submission.
- [X] T004 [P] [US1] Update `tests/unit/PaymentForm.test.tsx`: apply the same set of changes as T003 (remove key-field interaction, assert no key input and a read-only `payment-idempotency-key-display`, assert `idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/i)`, add retry-stability and post-reset-regeneration tests) — mirrors T003 for the payment form.

### Implementation for User Story 1

- [X] T002 [US1] Implement `useIdempotencyKey` hook in `src/hooks/useIdempotencyKey.ts`: generate via `crypto.randomUUID()` with a `crypto.getRandomValues()`-based v4-UUID fallback (research.md §1) on first render, expose `{ value, regenerate }` per `contracts/ui-contract.md`. Depends on T001 (test written and failing first).
- [X] T005 [US1] Update `src/components/EndorsementForm.tsx`: remove the `idempotency-key` `<input>`/`<label>` and its `localError` check; call `useIdempotencyKey()`; render its `value` as read-only text with `data-testid="endorsement-idempotency-key-display"`; send `value` as `idempotency_key` in the submit payload; call `regenerate()` from the existing `handleReset` function. Depends on T002, T003.
- [X] T006 [US1] Update `src/components/PaymentForm.tsx`: apply the same changes as T005 — remove the key input/label, use `useIdempotencyKey()`, render `data-testid="payment-idempotency-key-display"`, send `value` as `idempotency_key`, call `regenerate()` from `handleReset`. Depends on T002, T004.
- [ ] T007 [US1] Manually run quickstart.md steps 2–4 against a locally running dev server (no input field visible; key stable across a forced-offline retry with no duplicate billing document/event/payment created; key changes after "Apply another" / "Record another").

**Checkpoint**: User Story 1 is fully functional and testable independently — both forms work end-to-end
with zero manual idempotency-key entry.

---

## Phase 4: User Story 2 - See a frontend that looks deliberately designed, not scaffolded (Priority: P2)

**Goal**: The whole Policy page (shell, state view, timeline, both forms) has consistent, hand-authored
visual styling — no component library, no CSS framework — while every existing test hook and all four
UI states remain intact.

**Independent Test**: Load the Policy page end-to-end and confirm every visible surface has deliberate
spacing/typography/hierarchy instead of raw unstyled HTML, while loading/success/validation-error/
server-error remain present, visually distinct, and reachable via the same test hooks existing tests
use. (spec.md, US2 Independent Test)

### Implementation for User Story 2

- [X] T008 [P] [US2] Create `src/styles/tokens.css`: spacing scale (`--space-1`…`--space-6`), type scale (`--font-size-sm/base/lg/xl`), color palette (`--color-text`, `--color-muted`, `--color-border`, `--color-accent`, `--color-success`, `--color-error`), layout (`--content-max-width`), plus a minimal box-sizing/margin reset — per `data-model.md`'s Design Tokens table.
- [X] T009 [US2] Import `src/styles/tokens.css` once at the app root in `src/main.tsx`. Depends on T008.
- [X] T010 [P] [US2] Create `src/App.module.css` and apply its classNames to the page shell in `src/App.tsx` (single-column, fluid layout capped by `--content-max-width`, no fixed widths wider than 375px — research.md §5). Depends on T009.
- [X] T011 [P] [US2] Create `src/pages/PolicyPage.module.css` and apply classNames in `src/pages/PolicyPage.tsx`, preserving every existing `data-testid`/`role` (`policy-page`, `policy-page-loading`, `policy-page-error`, `policy-page-refreshing`) unchanged. Depends on T009.
- [X] T012 [P] [US2] Create `src/components/PolicyStateView.module.css` and apply classNames in `src/components/PolicyStateView.tsx`, preserving every existing `data-testid` (`policy-state-view`, `policy-state-id`, `policy-state-status`, `policy-state-premium`, `policy-state-currency`, `policy-state-term`, `policy-state-open-balance`, `policy-state-history`, `policy-state-summary`, `policy-state-suggested-action`) unchanged. Depends on T009.
- [X] T013 [P] [US2] Create `src/components/Timeline.module.css` and apply classNames in `src/components/Timeline.tsx` (billing documents / payments / ledger-summary sections, including a visually distinct treatment for the "NOT BALANCED" vs "Balanced" ledger message), preserving every existing `data-testid` unchanged. Depends on T009.
- [X] T014 [US2] Create `src/components/EndorsementForm.module.css` and apply classNames in `src/components/EndorsementForm.tsx` so each of the four UI states (`endorsement-loading`, `endorsement-success`, `endorsement-validation-error`, `endorsement-server-error`) is visually distinct, preserving all existing `data-testid`s plus the new `endorsement-idempotency-key-display` from T005. Depends on T005, T009.
- [X] T015 [US2] Create `src/components/PaymentForm.module.css` and apply classNames in `src/components/PaymentForm.tsx` so each of the four UI states (`payment-loading`, `payment-success`, `payment-validation-error`, `payment-server-error`) is visually distinct, preserving all existing `data-testid`s plus the new `payment-idempotency-key-display` from T006. Depends on T006, T009.
- [ ] T016 [US2] Manually run quickstart.md step 5: confirm consistent spacing/typography/color across the page, all four states visually distinct on both forms, no horizontal overflow/clipped controls at a 375px-wide viewport.

**Checkpoint**: User Stories 1 AND 2 both work independently — the redesigned frontend has no manual
idempotency-key entry and a consistent, hand-authored visual treatment throughout.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T017 [P] Run the full frontend suite (`npm test` in `packages/frontend`) and confirm every test passes, including the new `useIdempotencyKey.test.ts` and the updated `EndorsementForm.test.tsx`/`PaymentForm.test.tsx`, with `PolicyStateView.test.tsx`, `Timeline.test.tsx`, `PolicyPage.test.tsx`, and `App.test.tsx` passing unmodified (quickstart.md step 6).
- [X] T018 [P] Diff `packages/frontend/package.json` against its pre-feature version and confirm zero new `dependencies`/`devDependencies` were added (SC-004).
- [X] T019 Review the full diff against `contracts/ui-contract.md`'s testid table to confirm every "Unchanged" hook is byte-identical and the only DOM removals/additions are the two documented idempotency-key input→display swaps.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup / Foundational**: none — proceed directly to Phase 3.
- **User Story 1 (Phase 3)**: no dependency on User Story 2.
- **User Story 2 (Phase 4)**: T014/T015 (form styling) depend on User Story 1's T005/T006 having already
  landed, since they style the post-US1 JSX of the same two files. T008–T013, T016 have no dependency
  on User Story 1 and could be built against the pre-US1 forms if the two stories were staffed in
  parallel — only T014/T015 would then need to wait.
- **Polish (Phase 5)**: depends on both user stories being complete.

### Within User Story 1

T001 → T002 → (T005 depends on T002 + T003; T006 depends on T002 + T004) → T007. T003 and T004 can be
written in parallel with T001/T002 (different files).

### Within User Story 2

T008 → T009 → {T010, T011, T012, T013 in parallel} and, once US1's T005/T006 are done, {T014, T015} →
T016.

### Parallel Opportunities

- T001, T003, T004 (three independent test files) can be written together.
- T010, T011, T012, T013 (four independent component/page stylesheets with no cross-dependency beyond
  the shared, already-created `tokens.css`) can be built together once T009 lands.
- T017 and T018 are independent checks and can run together.

---

## Parallel Example: User Story 1

```bash
Task: "Write useIdempotencyKey hook tests in tests/unit/useIdempotencyKey.test.ts"
Task: "Update tests/unit/EndorsementForm.test.tsx for auto-generated key"
Task: "Update tests/unit/PaymentForm.test.tsx for auto-generated key"
```

## Parallel Example: User Story 2 (after T009)

```bash
Task: "Create src/App.module.css and style the page shell in src/App.tsx"
Task: "Create src/pages/PolicyPage.module.css and style src/pages/PolicyPage.tsx"
Task: "Create src/components/PolicyStateView.module.css and style src/components/PolicyStateView.tsx"
Task: "Create src/components/Timeline.module.css and style src/components/Timeline.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T007 (Phase 3).
2. **STOP and VALIDATE**: run quickstart.md steps 2–4; confirm the existing `EndorsementForm.test.tsx`/
   `PaymentForm.test.tsx` pass with the updated assertions and `useIdempotencyKey.test.ts` passes.
3. This alone ships the concrete friction fix that prompted this feature (no manual idempotency key)
   even before any visual work starts.

### Incremental Delivery

1. Phase 3 (US1) → validate → this is a deployable MVP increment on its own.
2. Phase 4 (US2) → validate via quickstart.md step 5 → adds the visual pass on top without touching
   US1's behavior.
3. Phase 5 → final cross-cutting verification (full suite, dependency diff, testid-contract review).

---

## Notes

- [P] tasks touch different files and have no unfinished dependency between them.
- [Story] labels map every Phase 3/4 task to US1/US2 per spec.md for traceability.
- Per `contracts/ui-contract.md`, the *only* intentional DOM/testid change in this entire feature is the
  idempotency-key input → read-only display swap on both forms; every other existing hook must survive
  a diff unchanged.
- Commit after each task or logical group; stop at either checkpoint to validate that story
  independently before continuing.

## Implementation Report (frontend-developer, /speckit-implement run)

- T007 and T016 are intentionally left unchecked: they require driving a real browser against a
  running dev server (devtools offline throttling, 375px viewport resize), which this agent cannot
  do. All other Phase 3/4/5 tasks (T001-T006, T008-T015, T017-T019) are implemented and verified —
  `npm test` in `packages/frontend` passes 51/51, including the new `useIdempotencyKey.test.ts` and
  the retry-stability/regeneration-on-reset tests added to `EndorsementForm.test.tsx`/
  `PaymentForm.test.tsx`. A human should still run quickstart.md steps 2-5 before sign-off.
- Deviation from the "PolicyPage.test.tsx passes unmodified" expectation (T017's description):
  `tests/unit/PolicyPage.test.tsx`'s ETag-refetch test directly filled the old
  `#endorsement-idempotency-key` input via `getByLabelText(/idempotency key/i)` to drive an
  endorsement submission inside that test. Removing the manual input (T005) necessarily broke that
  one line; it was deleted (the field no longer exists to fill) and the test still passes — this is
  a required, minimal, mechanically-forced update, not a behavioral change to what the test covers.
  `PolicyStateView.test.tsx`, `Timeline.test.tsx`, and `App.test.tsx` needed zero changes.
- The read-only idempotency-key display uses a bare `<span>Idempotency key</span>` next to a
  `<output data-testid="...-idempotency-key-display">` with no `<label>`/`aria-labelledby`
  association, specifically so `getByLabelText(/idempotency key/i)` reliably returns nothing (per the
  T003/T004 assertion) — an `aria-labelledby` association was tried first and rejected because RTL's
  `getByLabelText` also matches `aria-labelledby`-linked elements, which would have made that
  assertion vacuous.
- `App.tsx` previously had no shell markup of its own (it just rendered `<PolicyPage />`); T010 added
  one `<div className={styles.shell}>` wrapper with no new testid, to have something to apply the
  single-column/`--content-max-width` layout to, per the task's own guidance for this case.
