# Scanner worker. Runs on the official Playwright image, which contains Chromium and
# every system library it needs. The image version MUST match the "playwright" npm
# version in apps/scanner/package.json (1.64.1).

# ---- Stage 1: build the bundle ---------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/dom-checks/package.json packages/dom-checks/
COPY apps/egress-proxy/package.json apps/egress-proxy/
COPY apps/scanner/package.json apps/scanner/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-fund --no-audit -w @whc/scanner -w @whc/db -w @whc/shared -w @whc/dom-checks
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/dom-checks packages/dom-checks
COPY apps/scanner apps/scanner
RUN npm run generate -w @whc/db && npm run build -w @whc/scanner

# ---- Stage 2: production dependencies (pure JavaScript, safe to copy across images)
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/dom-checks/package.json packages/dom-checks/
COPY apps/egress-proxy/package.json apps/egress-proxy/
COPY apps/scanner/package.json apps/scanner/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-fund --no-audit --omit=dev -w @whc/scanner -w @whc/db -w @whc/shared

# ---- Stage 3: runtime --------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/scanner/dist ./apps/scanner/dist
COPY --from=build /app/apps/scanner/package.json ./apps/scanner/package.json
# Screenshot folder (a shared Docker volume), owned by the unprivileged user.
RUN mkdir -p /data/storage && chown -R pwuser:pwuser /data/storage
USER pwuser
WORKDIR /app/apps/scanner
CMD ["node", "dist/main.js"]
