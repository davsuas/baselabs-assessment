/**
 * X-API-Key authorization middleware (constitution Principle V, FR-024, research.md
 * "Authentication"). Applied to all `/api/*` routes ahead of any route handler. Rejects with
 * `401 { error: "unauthorized" }` before request touches policy/billing/payment/ledger logic.
 *
 * Uses a constant-time comparison (`crypto.timingSafeEqual`) so response latency cannot be used
 * to brute-force the key one byte at a time.
 */
import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    // Compare bufferA against itself so we still pay a timingSafeEqual-shaped cost before
    // rejecting — avoids leaking key length via an early-return timing difference.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

export function auth(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    // Misconfigured deployment: fail closed rather than silently accepting every request.
    // eslint-disable-next-line no-console
    console.error("API_KEY is not configured; rejecting all requests");
    res.status(500).json({ error: "server_error" });
    return;
  }

  const providedKey = req.header("X-API-Key");

  if (!providedKey || !constantTimeEqual(providedKey, expectedKey)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
