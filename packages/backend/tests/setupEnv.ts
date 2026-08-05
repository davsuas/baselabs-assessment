/**
 * Jest `setupFiles` entry (runs before any test module is required, including anything that
 * imports `src/db/pool.ts`, which builds its connection config from `process.env` at import time).
 * Loads the repo-root `.env` so `npm test` works the same locally as it does inside the `backend`
 * Docker Compose service (whose `environment:` block plays the same role there) — see
 * docker-compose.yml and .env.example. Never loads/creates real values itself; `.env` is
 * git-ignored (constitution Principle V).
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../../.env") });
