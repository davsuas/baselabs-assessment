/**
 * Express app wiring. Middleware order is deliberate and matches tasks.md T022 exactly:
 * CORS → JSON body parsing → rate-limit → auth → route mounts → error handler. Every `/api/*`
 * route sits behind all three of CORS, rate-limiting, and auth (constitution Principle V) — there
 * is no endpoint exempt from this chain.
 *
 * Route mounts are added incrementally by each user story (T037 endorsements, T048 payments,
 * T060-T062 policies/ledger/history) — this file stays a thin composition root, never growing
 * route logic of its own (Principle IV, single responsibility).
 */
import express, { type Express } from "express";
import { corsMiddleware } from "./middleware/cors";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { auth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { endorsementsRouter } from "./routes/endorsements";
import { paymentsRouter } from "./routes/payments";
import { policiesRouter } from "./routes/policies";
import { ledgerRouter } from "./routes/ledger";
import { historyRouter } from "./routes/history";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  // Express's own built-in weak-ETag/freshness handling is disabled in favor of the explicit,
  // strong-ETag conditional-GET logic in `http/conditionalGet.ts` — one place, fully explicit,
  // no framework magic underneath it (Principle IV; research.md "Response caching").
  app.set("etag", false);
  app.use(corsMiddleware);
  app.use(express.json());
  app.use("/api", rateLimitMiddleware);
  app.use("/api", auth);

  // --- Story route mounts (populated by later phases) -----------------------------------------
  app.use("/api/policies", endorsementsRouter); // T037 (US1)
  app.use("/api/policies", paymentsRouter);      // T048 (US2)
  app.use("/api/policies", policiesRouter);      // T060 (US3)
  app.use("/api/policies", ledgerRouter);        // T061 (US3)
  app.use("/api/policies", historyRouter);       // T062 (US3)
  // ----------------------------------------------------------------------------------------------

  app.use(errorHandler);

  return app;
}
