# ---- Stage 1: build the React app into static files -----------------------------
FROM node:24-alpine AS build
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
COPY apps/extension/package.json apps/extension/
RUN npm ci --no-fund --no-audit -w @whc/web -w @whc/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @whc/web

# ---- Stage 2: serve them with nginx ---------------------------------------------
FROM nginx:1.28-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
