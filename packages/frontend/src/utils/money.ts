/**
 * Dollar-string <-> integer-cents conversion for form inputs and display (constitution Principle
 * VI: money is integer cents end-to-end; this is the one place the frontend touches a decimal
 * dollar representation, and only for human input/output at the UI boundary — never for storage
 * or calculation). Shared by `EndorsementForm` and the sibling `PaymentForm`.
 */

/**
 * Parses a plain decimal dollar string (e.g. "1440", "1440.5", "1440.99") into integer cents
 * using string arithmetic only — no floating-point multiplication/division — so a value like
 * "0.1" can never drift the way `0.1 * 100` can in IEEE 754. Returns `null` for anything that
 * isn't a non-negative amount with at most two decimal places.
 */
export function parseDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const centsFraction = fractionPart.padEnd(2, "0");
  return Number(wholePart) * 100 + Number(centsFraction);
}

/**
 * Formats integer cents as a human-readable currency string for display only. The division here
 * never feeds back into a stored or submitted value (Principle VI) — it exists solely to render
 * an already-integer-cents quantity received from the API.
 */
export function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    // Unknown/malformed currency code from the API — fall back to a plain numeric rendering
    // rather than letting Intl throw and blank the whole view.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
