# Egress proxy: the only container allowed to reach the internet on behalf of the scanner.

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
RUN npm ci --no-fund --no-audit -w @whc/egress-proxy -w @whc/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/egress-proxy apps/egress-proxy
RUN npm run build -w @whc/egress-proxy

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/egress-proxy/dist ./apps/egress-proxy/dist
COPY --from=build /app/apps/egress-proxy/package.json ./apps/egress-proxy/package.json
USER node
WORKDIR /app/apps/egress-proxy
EXPOSE 3128
CMD ["node", "dist/main.js"]
