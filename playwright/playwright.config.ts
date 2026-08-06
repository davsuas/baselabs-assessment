/**
 * Playwright config for BLAB-001's E2E suite (T041, T052, T069). Drives the frontend dev server
 * started by `docker-compose.yml`'s `frontend` service (Vite, port 5173 by default —
 * `FRONTEND_PORT`/`packages/frontend`'s `dev` script) via the Compose `playwright` service under
 * the `test-e2e` profile:
 *
 *   docker compose --profile test-e2e run --rm playwright
 *
 * That service sets `PLAYWRIGHT_BASE_URL=http://frontend:5173` (the in-network service name).
 * Locally (outside Compose), it defaults to `http://localhost:5173`, matching
 * `.env.example`'s `FRONTEND_PORT` default. This config never starts its own dev server — the
 * frontend (and the backend it talks to) is expected to already be running, exactly as
 * `docker-compose.yml`'s `depends_on: [backend, frontend]` guarantees for the `playwright`
 * service, or as `npm run dev:frontend` (+ `npm run dev:backend`) guarantees locally.
 */
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
