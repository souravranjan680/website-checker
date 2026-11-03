# On-demand test runner for the cross-browser checks (Phase 9, Milestone 3): the scanner's
# browser tests in the same Playwright image as production, where Chromium, Firefox and
# WebKit are installed. Not part of the running stack; started only when asked for:
#   docker compose --profile test run --rm scanner-test
# The image version MUST match the "playwright" npm version (as in scanner.Dockerfile).
FROM mcr.microsoft.com/playwright:v1.64.1-noble
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
RUN npm ci --no-fund --no-audit --include-workspace-root -w @whc/scanner -w @whc/db -w @whc/shared -w @whc/dom-checks -w @whc/egress-proxy
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/egress-proxy apps/egress-proxy
COPY apps/scanner apps/scanner
COPY tests tests
RUN npm run generate -w @whc/db && npm run build -w @whc/dom-checks
WORKDIR /app/apps/scanner
CMD ["npx", "vitest", "run", "test/cross-browser-security.test.ts", "test/compat-stage.test.ts", "test/browser-launch.test.ts"]
