# Multi-stage build: each FROM starts a fresh image; later stages copy only what they need.

# ---- Stage 1: build -----------------------------------------------------------
FROM node:24-alpine AS build
# Retry package downloads on flaky networks instead of failing the whole build.
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
WORKDIR /app

# Copy only package manifests first. Docker caches this layer, so dependencies are
# re-installed only when a package.json or the lockfile changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/dom-checks/package.json packages/dom-checks/
COPY apps/egress-proxy/package.json apps/egress-proxy/
COPY apps/scanner/package.json apps/scanner/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-fund --no-audit -w @whc/api -w @whc/db -w @whc/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api

# Generate the Prisma client, then bundle the API into apps/api/dist/server.js.
RUN npm run generate -w @whc/db && npm run build -w @whc/api

# ---- Stage 2: production dependencies only -------------------------------------
FROM node:24-alpine AS prod-deps
# Retry package downloads on flaky networks instead of failing the whole build.
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/dom-checks/package.json packages/dom-checks/
COPY apps/egress-proxy/package.json apps/egress-proxy/
COPY apps/scanner/package.json apps/scanner/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Known limitation (trimmed in Phase 8): npm ci installs the production dependencies of
# ALL workspaces in the lockfile, plus @prisma/client's peer dependencies (Prisma CLI,
# TypeScript), so this layer is larger than the API strictly needs (~370 MB).
RUN npm ci --no-fund --no-audit --omit=dev -w @whc/api -w @whc/db -w @whc/shared

# ---- Stage 3: runtime (small, no compilers, no dev tools) -------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Run as the unprivileged "node" user instead of root.
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
