/**
 * Central Express error-handling middleware — the only place a thrown error becomes an HTTP
 * response (contracts/rest-api.md's error shapes). Route handlers/repository code throw the typed
 * errors in `src/errors.ts`; this handler never leaks a stack trace or a raw database error to the
 * client (constitution Principle V).
 */
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../errors";

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.statusCode).json(err.body);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_error",
      details: err.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    });
    return;
  }

  // Unexpected failure (DB error, programming error, etc.) — log for operators, respond generic.
  // eslint-disable-next-line no-console
  console.error("unhandled error", err);
  res.status(500).json({ error: "server_error" });
};
