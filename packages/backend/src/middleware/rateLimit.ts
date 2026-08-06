/**
 * Rate-limiting middleware (constitution Principle V, FR-025, research.md "Rate limiting").
 * In-memory store is sufficient because Docker Compose runs a single backend instance — a
 * distributed store (Redis) would be scope this assessment explicitly warns against
 * (Principle VII/YAGNI). Keyed per API key (falling back to IP only when no key is present, e.g.
 * an unauthenticated request — auth middleware runs after this and will still reject it).
 */
import rateLimit from "express-rate-limit";

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_REQUESTS_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 100);

export const rateLimitMiddleware = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.header("X-API-Key") ?? req.ip ?? "unknown",
  handler: (_req, res) => {
    res.status(429).json({
      error: "rate_limited",
      retry_after_seconds: Math.ceil(WINDOW_MS / 1000),
    });
  },
});
