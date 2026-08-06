# Runs the Vite dev server (not a production static build) — matches this project's stated scope
# ("no production deployment requirement", plan.md Target Platform) and sidesteps needing to bake
# VITE_* env vars in at image-build time, since the Vite dev server reads them at process start
# instead (docker-compose.yml's `environment:` block).
#
# Multi-stage (tasks.md T072): `deps` installs the full npm-workspaces tree once (needed so npm
# workspaces can link `packages/frontend`'s `@policy-billing-core/shared` dependency); the final
# `runtime` stage copies over only node_modules, `packages/frontend`, and `packages/shared` —
# dropping the unrelated `packages/backend` and `db/` that a single-stage `COPY packages packages`
# used to pull into this image — and runs as the non-root `node` user (built into the official
# node:alpine image) rather than root.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages packages

RUN npm install

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=deps /app/package.json /app/package-lock.json* /app/tsconfig.base.json ./
COPY --chown=node:node --from=deps /app/packages/frontend packages/frontend
COPY --chown=node:node --from=deps /app/packages/shared packages/shared

USER node

WORKDIR /app/packages/frontend

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
