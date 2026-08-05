# Backend image — also reused, unmodified, by docker-compose.yml's `migrate` service (same image,
# different `command`/`working_dir` override) since the migration runner's dependencies (pg,
# ts-node, typescript, dotenv) are already present here as npm-workspaces root dependencies. That's
# also why the final stage below still carries devDependencies (not a pure prod-only install):
# `migrate` runs `db/migrate.ts` via `ts-node`, so ts-node/typescript stay required at runtime for
# that service specifically.
#
# Multi-stage (tasks.md T072): `deps` installs the full npm-workspaces tree once and `build`
# compiles the backend workspace to plain JS, so the `backend` service itself never needs ts-node
# at runtime. The final `runtime` stage assembles only what either service actually reads —
# node_modules, the compiled backend `dist/`, `db/` (migrations + the migration runner), and the
# manifests/tsconfigs `npm run migrate` and `node dist/server.js` need — instead of the single-stage
# `COPY packages packages` that used to pull the unrelated frontend package and raw backend/shared
# TypeScript source into this image too. Runs as the non-root `node` user (built into the official
# node:alpine image) rather than root.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY db db

RUN npm install

FROM deps AS build

RUN npm run build --workspace packages/backend

FROM node:22-alpine AS runtime

WORKDIR /app

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=deps /app/package.json /app/package-lock.json* /app/tsconfig.base.json /app/tsconfig.json ./
COPY --chown=node:node --from=deps /app/db ./db
COPY --chown=node:node packages/backend/package.json packages/backend/package.json
COPY --chown=node:node --from=build /app/packages/backend/dist packages/backend/dist

USER node

WORKDIR /app/packages/backend

EXPOSE 3000

CMD ["node", "dist/server.js"]
