/**
 * Loads `.env` before anything that reads `process.env` at module-load time (notably
 * `db/pool.ts`, which constructs its `Pool` eagerly). Compiling to CommonJS means these
 * `require()`s execute in this exact source order — not ES-module-hoisted — so `dotenv.config()`
 * genuinely does run first.
 */
import * as dotenv from "dotenv";

dotenv.config();

import { createApp } from "./app";
import { closePool } from "./db/pool";

const PORT = Number(process.env.PORT ?? 3000);

const app = createApp();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`backend listening on port ${PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`received ${signal}, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
