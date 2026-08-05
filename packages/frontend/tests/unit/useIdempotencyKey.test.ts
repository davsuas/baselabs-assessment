/**
 * T001 — covers `useIdempotencyKey` (BLAB-002 US1, FR-001-FR-005; contracts/ui-contract.md):
 * a non-empty UUID-shaped `value` is generated synchronously on first render, stays stable across
 * re-renders unless `regenerate()` is called, and `regenerate()` replaces it with a different
 * UUID-shaped string without needing to unmount/remount.
 *
 * This project's jsdom-based Jest environment does not implement `crypto.randomUUID` (only
 * `crypto.getRandomValues`), so these assertions exercise the `getRandomValues()`-based fallback
 * path (research.md §1) rather than the browser-native path — both must produce the same
 * UUID-shaped output per the hook contract.
 */
import { renderHook, act } from "@testing-library/react";
import { useIdempotencyKey } from "../../src/hooks/useIdempotencyKey";

const UUID_SHAPE = /^[0-9a-f-]{36}$/i;

describe("useIdempotencyKey", () => {
  it("generates a non-empty UUID-shaped value on first render", () => {
    const { result } = renderHook(() => useIdempotencyKey());

    expect(result.current.value).toMatch(UUID_SHAPE);
  });

  it("keeps the same value across re-renders without calling regenerate()", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());

    const first = result.current.value;
    rerender();
    rerender();

    expect(result.current.value).toBe(first);
  });

  it("replaces value with a different UUID-shaped string when regenerate() is called", () => {
    const { result } = renderHook(() => useIdempotencyKey());

    const first = result.current.value;
    act(() => {
      result.current.regenerate();
    });

    expect(result.current.value).toMatch(UUID_SHAPE);
    expect(result.current.value).not.toBe(first);
  });

  it("lets setValue() overwrite the generated value with a user-supplied one", () => {
    const { result } = renderHook(() => useIdempotencyKey());

    act(() => {
      result.current.setValue("custom-key-123");
    });

    expect(result.current.value).toBe("custom-key-123");
  });
});
