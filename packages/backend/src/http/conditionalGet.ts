/**
 * Conditional-GET (`ETag`/`If-None-Match`) support for the three read endpoints
 * (contracts/rest-api.md endpoints 3-5, research.md "Response caching"). A strong `ETag` is
 * derived from the exact response body about to be sent — the moment the underlying data changes,
 * the serialized body changes, and so does the ETag; there is no time-based staleness window to
 * reason about (unlike `max-age`), which is why this endpoint family never risks masking a
 * just-posted mutation (constitution Principle V).
 *
 * `app.ts` disables Express's own built-in (weak, body-hashing) `etag`/freshness handling
 * (`app.set("etag", false)`) so this is the *only* place ETag/conditional-GET logic runs — no
 * framework magic layered underneath what's written here (Principle IV).
 */
import { createHash } from "crypto";
import type { Request, Response } from "express";

export function computeEtag(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return `"${hash}"`;
}

/**
 * Sets the `ETag` header for `payload` and, if the request's `If-None-Match` matches it exactly,
 * responds `304 Not Modified` with no body and returns `true` (the caller MUST NOT write a body in
 * that case). Otherwise returns `false`, leaving the caller to send its normal `200` JSON response.
 */
export function respondNotModifiedIfMatching(
  req: Request,
  res: Response,
  payload: unknown,
): boolean {
  const etag = computeEtag(payload);
  res.set("ETag", etag);

  if (req.header("If-None-Match") === etag) {
    res.status(304).end();
    return true;
  }

  return false;
}
