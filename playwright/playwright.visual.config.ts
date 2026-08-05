/**
 * "Visual" variant of playwright.config.ts — same suite (`./tests`), same target stack, but tuned
 * to actually watch/record what the browser does instead of just pass/fail text:
 *
 *   - `video: "on"` — every test (not just failures) gets a .webm recording under
 *     `test-results/<test-name>/video.webm`. This alone works in headless mode, so it's the part
 *     that also works unmodified inside the `playwright-visual` Docker Compose service (no
 *     display available there).
 *   - `headless` defaults to `false` so a local run (outside Docker, on a machine with a real
 *     display) pops an actual visible Chromium window. Set `PLAYWRIGHT_HEADLESS=true` to force
 *     headless — e.g. running this config in a container with no X server.
 *   - `slowMo` pads a delay between actions so a human watching (live or via the recording) can
 *     actually follow along, rather than the whole spec finishing in under a second.
 *
 * Run locally to actually watch it:
 *   cd playwright && npm run test:visual
 *
 * Run anywhere (incl. Docker) to just get the .webm recordings out:
 *   PLAYWRIGHT_HEADLESS=true npm run test:visual
 *   docker compose --profile test-e2e-visual run --rm playwright-visual
 *
 * After a run, browse results (including inline video playback) with:
 *   npx playwright show-report
 *
 * The plain CLI suite (`playwright.config.ts`, `npm test`, `docker compose --profile test-e2e run
 * --rm playwright`) is untouched by this file — headless, no video, fast, for CI/automated runs.
 */
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const headless = process.env.PLAYWRIGHT_HEADLESS === "true";
const slowMo = Number(process.env.PLAYWRIGHT_SLOWMO ?? 250);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL,
    headless,
    launchOptions: { slowMo },
    video: "on",
    trace: "on",
    screenshot: "on",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
