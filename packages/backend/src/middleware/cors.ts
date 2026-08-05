/**
 * CORS middleware (constitution Principle V — explicit origin allow-list, never a wildcard;
 * research.md "CORS"). `CORS_ORIGIN` is the frontend's local origin (e.g.
 * `http://localhost:5173`), supplied via environment configuration. If unset, the allow-list is
 * empty and every cross-origin request is rejected — fail closed, not fail open.
 */
import cors from "cors";

const configuredOrigin = process.env.CORS_ORIGIN;
const allowList = configuredOrigin ? [configuredOrigin] : [];

export const corsMiddleware = cors({
  origin: allowList,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-API-Key", "If-None-Match"],
  exposedHeaders: ["ETag"],
  credentials: false,
});
