# Pinned versions

Exact versions installed and tested together in Phase 2 (2026-11-02).
`package-lock.json` is the real source of truth; this page explains the choices.

## Runtime & infrastructure

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.21.0 (LTS line 24) | Docker images use `node:24-alpine` |
| npm | 11.19.0 | Uses `allowScripts` (see below) |
| PostgreSQL | 17 (`postgres:17-alpine`) | |
| Redis | 7.4 (`redis:7.4-alpine`) | |
| Mailpit | 1.29 (`axllent/mailpit:v1.29`) | Dev email inbox |
| nginx | 1.28 (`nginx:1.28-alpine`) | Serves the web build |

## Packages

| Area | Package | Version |
|---|---|---|
| Language | typescript | 6.0.3 |
| | @types/node | 24.19.2 |
| Frontend | react, react-dom | 19.3.1 |
| | react-router | 8.5.1 |
| | @tanstack/react-query | 5.105.1 |
| | vite | 8.3.5 |
| | @vitejs/plugin-react | 6.2.1 |
| | tailwindcss, @tailwindcss/vite | 4.3.3 |
| | shadcn (CLI + CSS) | 4.23.0 (preset `radix-nova`) |
| | radix-ui | 1.8.1 |
| | lucide-react | 1.66.0 |
| | class-variance-authority / clsx / tailwind-merge | 0.7.1 / 2.1.1 / 3.7.0 |
| Shared | zod | 4.6.7 |
| Backend | express | 5.3.0 |
| | helmet / cors | 8.3.0 / 2.8.6 |
| | pino / pino-http / pino-pretty | 10.4.0 / 11.0.0 / 13.2.0 |
| | ioredis | 6.0.0 |
| | dotenv | 18.0.9 |
| Database | prisma, @prisma/client, @prisma/adapter-pg | 7.10.1 (pinned exactly; must match) |
| | pg | 8.23.1 |
| Build | tsx | 4.23.15 |
| | tsup | 9.0.0 |
| | esbuild | 0.28.2 |
| Testing | vitest | 5.0.5 |
| | supertest | 7.3.1 |
| | jsdom | 30.1.3 |
| | @testing-library/react / jest-dom | 16.3.3 / 7.0.1 |
| Quality | eslint / typescript-eslint | 10.14.0 / 8.72.1 |
| | prettier | 3.9.10 |
| | concurrently | 10.0.6 |

### Added in Phase 4 (scanning)

| Package / image | Version | Notes |
|---|---|---|
| playwright | 1.64.1 (pinned exactly) | Must equal the Docker base image `mcr.microsoft.com/playwright:v1.64.1-noble` |
| axe-core | 4.14.0 | Accessibility rules (WCAG 2.0–2.2 A/AA + best practices) |
| bullmq | 6.5.3 | Job queue on Redis (API = producer, scanner = worker) |
| esbuild | 0.28.2 | Builds the in-page `dom-checks` bundle |
| Chromium | bundled with Playwright 1.64.1 | `npm run scanner:install-browser` locally |

Packages planned for later phases (Lighthouse, @anthropic-ai/sdk, Recharts) are
pinned when their phase starts.

## Deliberate choices

- **TypeScript 6.0, not 7.0.** TypeScript 7 (the new native compiler) is the
  latest release, but `typescript-eslint` 8.72 only supports `<6.1`. We move to 7
  once the lint tooling supports it.
- **Prisma 7.10.1, not 8.** npm's `latest` tag for `prisma` currently points to
  `8.0.0-rc.29`, a *release candidate*. We use the newest stable release.
  Prisma prints an "Update available 7.10.1 → 8.0.0-rc" banner; ignore it.
- **No `cn` package.** The shadcn CLI adds a pre-1.0 `cn` package; we keep the
  standard `cn()` helper in `apps/web/src/lib/utils.ts` (clsx + tailwind-merge)
  instead. After `npx shadcn add <component>`, run
  `npm run ui:fix-cn -w @whc/web` and then `npm uninstall cn -w @whc/web`.
  (The fix script is Node-based on purpose: Windows PowerShell 5.1 can corrupt
  UTF-8 files when rewriting them.)

## npm `allowScripts`

npm 11 does not run packages' install scripts unless they are approved.
`package.json` → `allowScripts` approves exactly these (pinned to version):

| Package | Why it needs an install script |
|---|---|
| prisma, @prisma/engines | Download the migration engine for your OS |
| esbuild | Verify its native binary (used by Vite, tsx, tsup) |
| msgpackr-extract | **Denied**: optional native speed-up for BullMQ's message encoding; the pure-JavaScript fallback is used, so no C++ compiler is needed |

When one of these is upgraded, npm warns; review and run
`npm install-scripts approve <package>`.
