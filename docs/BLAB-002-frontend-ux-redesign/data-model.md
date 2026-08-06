# Phase 1 Data Model: Frontend Visual Polish & Auto-Generated Idempotency Keys

No database, API, or persisted-entity changes (this feature is frontend-only; see plan.md's
Constitution Check, Principles III/VI: N/A). The two "entities" below are client-side-only shapes that
drive the implementation — documented here so `/speckit-tasks` has concrete fields/states to build
against, per Phase 1's data-model output.

## IdempotencyKey (client-side, ephemeral)

Held in component state via the new `useIdempotencyKey()` hook; never persisted to
localStorage/sessionStorage/cookies; not a database or API entity — sent as the existing opaque
`idempotency_key` string field already defined in `contracts/rest-api.md` (BLAB-001, unchanged).

| Field | Type | Notes |
|---|---|---|
| `value` | `string` (UUID v4) | Generated via `crypto.randomUUID()` (or the `getRandomValues()` fallback — research.md §1) on hook mount. |
| *(lifecycle, not a stored field)* | — | Stable across re-renders and across a failed→retried submission of the same form instance (research.md §2). Replaced with a new `value` only when the hook's `regenerate()` is called — wired to the same `handleReset` path each form already calls after a successful submission. |

**Hook contract**:

```ts
function useIdempotencyKey(): {
  value: string;
  regenerate: () => void;
  setValue: (value: string) => void;
};
```

- `value` MUST be present and non-empty for the lifetime of the hook (generated synchronously on
  first render — never an empty string, no loading state, since generation is synchronous and local).
- `regenerate()` MUST replace `value` with a newly generated key; calling it MUST NOT affect any other
  form state (fields, submission state) — it is called from the existing reset handler, not the other
  way around.
- `setValue()` MUST overwrite `value` directly — wired to the field's `onChange` so a human (or a
  Playwright spec via `.fill()`) can override the auto-generated key. **AMENDMENT**: added after the
  initial implementation shipped a read-only display with no input, which broke
  `playwright/tests/apply-endorsement.spec.ts`/`record-payment.spec.ts` (both rely on
  `getByLabel("Idempotency key").fill(...)`). The field is once again a real, labeled `<input>`,
  pre-filled by `value` — auto-generation is preserved for the common case, editing is preserved for
  e2e/manual override.

**Validation rules**: None beyond "is a non-empty string" — the backend (unchanged, BLAB-001) remains
the sole authority on idempotency-key semantics (same key + same payload → original result; same key +
different payload → clear failure, per constitution Principle II). This feature does not change or
duplicate that validation client-side.

**State transitions**:

```text
[hook mounts] --generate--> value = uuid_1
value = uuid_1 --(user retries after error, same form instance)--> value = uuid_1 (unchanged)
value = uuid_1 --(regenerate() called via reset, after success or explicit new entry)--> value = uuid_2
```

## Design Tokens (CSS custom properties, `src/styles/tokens.css`)

Not a runtime/data entity — a fixed, small set of CSS custom properties consumed by every
`*.module.css` file (research.md §3), documented here so the visual pass has one shared source of
truth instead of six independently-guessed values.

| Token group | Example names | Purpose |
|---|---|---|
| Spacing scale | `--space-1` … `--space-6` | Consistent margins/padding/gaps across all six styled files. |
| Type scale | `--font-size-sm`, `--font-size-base`, `--font-size-lg`, `--font-size-xl` | Consistent heading/body/label sizing. |
| Color palette | `--color-text`, `--color-muted`, `--color-border`, `--color-accent`, `--color-success`, `--color-error` | Shared neutral palette + the accent/success/error colors already implied by the four required UI states (loading/success/validation-error/server-error). |
| Layout | `--content-max-width` | Caps page-shell width on wide viewports; combined with fluid single-column layout for the 375px constraint (research.md §5). |

This is a values file only — no mixins, no build-time preprocessor, no exported JS/TS module — so it
does not constitute a "design system package" under the constitution's constraint (plan.md's
Constitution Check, Principle VII).
