/**
 * Generates and holds a client-side idempotency key for a single logical form submission
 * (BLAB-002 US1, FR-001-FR-005). Pre-fills the "Idempotency key" field on
 * `EndorsementForm`/`PaymentForm` so the user never *has* to invent one, while still allowing
 * manual editing (e.g. to intentionally replay/override a request — Playwright's e2e specs also
 * rely on being able to `.fill()` this field directly). The key is generated synchronously on
 * first render (never an empty string, no loading state) and stays stable across re-renders and
 * across a failed-then-retried submission of the same form instance unless the user edits it
 * (`setValue`) or the caller invokes `regenerate()` — wired to each form's existing `handleReset`
 * (the same path already run after a successful submission, e.g. "Apply another endorsement" /
 * "Record another payment").
 *
 * Generation prefers the standard `crypto.randomUUID()` (available in all evergreen browsers this
 * project targets). Per research.md §1, a `crypto.getRandomValues()`-based RFC-4122-ish v4 UUID
 * fallback covers environments without `randomUUID` (e.g. this project's own jsdom-based Jest
 * environment, and the "very old browser" edge case from spec.md) without pulling in a `uuid`
 * npm dependency — this feature adds zero new runtime dependencies.
 */
import { useCallback, useState } from "react";

function randomUuidFallback(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return randomUuidFallback();
}

export interface UseIdempotencyKeyResult {
  /** Non-empty UUID string, present from first render; may be overwritten by the user via `setValue`. */
  value: string;
  /** Replaces `value` with a newly generated key; does not affect any other state. */
  regenerate: () => void;
  /** Overwrites `value` directly — wired to the field's `onChange` so the user can edit it. */
  setValue: (value: string) => void;
}

export function useIdempotencyKey(): UseIdempotencyKeyResult {
  const [value, setValue] = useState<string>(() => generateIdempotencyKey());

  const regenerate = useCallback(() => {
    setValue(generateIdempotencyKey());
  }, []);

  return { value, regenerate, setValue };
}
