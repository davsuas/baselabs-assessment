import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Vite 5.4+'s DNS-rebinding guard rejects requests whose Host header doesn't match
    // localhost/127.0.0.1/an explicit allow-list. The `playwright` Compose service (test-e2e
    // profile) reaches this dev server as `http://frontend:5173` over the Compose network, so
    // that service hostname must be explicitly allowed — see docker-compose.yml's `frontend`
    // service name and `PLAYWRIGHT_BASE_URL`.
    allowedHosts: ["frontend", "localhost"],
    // Dev-server-side proxy for `/api` (qa-developer, fixing the test-e2e containerized-profile
    // blocker noted in the US1 report). `packages/frontend/src/api/client.ts`'s
    // `VITE_API_BASE_URL` now defaults to the same-origin relative path `/api` rather than an
    // absolute `http://localhost:3000/api` — the browser always calls same-origin, and this Vite
    // dev server (not the browser) forwards `/api/*` to wherever the backend actually is from
    // *this process's* point of view:
    //   - running under `docker-compose.yml`'s `frontend` service (or the `playwright`
    //     Compose service pointed at it): `VITE_DEV_API_PROXY_TARGET=http://backend:3000` (the
    //     in-network Compose service name) — see `docker-compose.yml`'s `frontend` service.
    //   - running on the host (`npm run dev:frontend` / `npx playwright test` locally): no env
    //     var needed, defaults to `http://localhost:3000` where the backend is exposed via
    //     `BACKEND_PORT`.
    // This removes the container-networking mismatch without touching `CORS_ORIGIN` or the
    // production build path (out of scope per the assessment) — proxied requests never leave the
    // dev server process, so the backend's CORS allow-list is unaffected either way.
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
