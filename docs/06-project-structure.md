# 06 · Project Structure

npm-workspaces monorepo. Repository root = this folder (`website/`); the
package name is `website-health-checker`.

```
website-health-checker/
├─ apps/
│  ├─ web/                         React + Vite dashboard
│  │  ├─ src/
│  │  │  ├─ app/                   router.tsx, providers (Query, Theme, Auth), layouts
│  │  │  ├─ components/
│  │  │  │  ├─ ui/                 shadcn/ui components (button, dialog, table, ...)
│  │  │  │  └─ common/             DataTable, EmptyState, ErrorState, SeverityBadge,
│  │  │  │                         ScoreRing, PageHeader, ConfirmDialog, CodeBlock
│  │  │  ├─ features/              one folder per area, each with pages/, components/, api.ts
│  │  │  │  ├─ auth/  dashboard/  projects/  websites/  scans/
│  │  │  │  ├─ reports/            accessibility, ui-health, responsive, performance, seo, security
│  │  │  │  ├─ issues/             IssueDrawer, ScreenshotHighlighter, AiPanel
│  │  │  │  ├─ visual/  bug-reports/  history/  profile/  settings/
│  │  │  ├─ lib/                   api-client.ts, query-client.ts, sse.ts, format.ts
│  │  │  └─ main.tsx
│  │  ├─ index.html
│  │  └─ vite.config.ts
│  │
│  ├─ api/                         Express REST API
│  │  └─ src/
│  │     ├─ config/                env.ts (Zod-validated environment)
│  │     ├─ middleware/            auth, rbac, validate, rate-limit, error-handler, request-id
│  │     ├─ modules/               feature modules; each has:
│  │     │  │                        *.routes.ts      URL → controller
│  │     │  │                        *.controller.ts  HTTP in/out only
│  │     │  │                        *.service.ts     business logic + permission checks
│  │     │  │                        *.test.ts
│  │     │  ├─ auth/  users/  projects/  websites/  scans/  reports/  issues/
│  │     │  ├─ screenshots/  visual/  bug-reports/  ai/  dashboard/
│  │     │  └─ notifications/  activity/  schedules/  admin/  api-tokens/
│  │     ├─ lib/                   prisma, redis, queues, mailer, storage, jwt, password,
│  │     │                         logger, sse, pagination, exporters/
│  │     ├─ openapi/               registry + Swagger UI mounting
│  │     ├─ app.ts                 builds the Express app (used by tests)
│  │     └─ server.ts              starts listening
│  │
│  ├─ scanner/                     BullMQ worker(s)
│  │  └─ src/
│  │     ├─ worker.ts              queue consumers: scan, visual-compare, export, storage-gc
│  │     ├─ pipeline/
│  │     │  ├─ run-scan.ts         orchestrates stages, progress, cancellation
│  │     │  └─ stages/             preflight, crawl, responsive, links, lighthouse,
│  │     │                         cross-page, issue-screenshots, visual, finalize
│  │     ├─ browser/               launcher (proxy flags), context factory, page loader
│  │     ├─ crawler/               bfs-crawler, url-normalizer, robots, sitemap
│  │     ├─ checks/
│  │     │  ├─ accessibility/      axe runner, tab walk, focus-indicator check
│  │     │  ├─ ui-health/          runs packages/dom-checks in the page, network/console collectors
│  │     │  ├─ responsive/         viewports, nav check, image sizing
│  │     │  ├─ seo/  security/
│  │     │  └─ performance/        lighthouse runner + result mapper
│  │     ├─ screenshots/           capture, highlight overlay, crop
│  │     ├─ visual/                pixelmatch compare, ignore regions
│  │     ├─ export/                PDF rendering (HTML templates → page.pdf)
│  │     ├─ scoring/  fingerprint/  persistence/  progress/
│  │     └─ index.ts
│  │
│  ├─ egress-proxy/                SSRF guard forward proxy (small, heavily tested)
│  │  └─ src/ server.ts, policy.ts
│  │
│  └─ extension/                   Chrome extension (MV3)
│     ├─ manifest.json
│     └─ src/
│        ├─ background/            service-worker.ts
│        ├─ content/               run-checks.ts, highlighter.ts (Shadow DOM overlay)
│        ├─ popup/                 popup.html, Popup.tsx
│        └─ options/               API token + dashboard URL settings
│
├─ packages/
│  ├─ shared/                      used by web, api, scanner, extension
│  │  └─ src/ schemas/ (Zod: requests/responses), enums, viewports, severity,
│  │          scoring.ts, url-safety.ts, fingerprint.ts, types.ts
│  ├─ db/                          Prisma (schema, migrations, seed, client export)
│  │  └─ prisma/ schema.prisma, migrations/, seed.ts
│  ├─ dom-checks/                  pure in-browser functions (no imports): empty buttons,
│  │                               overflow, overlap, clipping, selector generator...
│  │                               bundled into the scanner AND the extension
│  └─ config/                      tsconfig.base.json, eslint config, prettier config
│
├─ tests/
│  ├─ fixtures/sites/              intentionally broken websites (see 02-modules.md)
│  └─ e2e/                         Playwright Test: full user journeys through the web app
│
├─ docker/
│  ├─ api.Dockerfile  scanner.Dockerfile  web.Dockerfile  egress-proxy.Dockerfile
│  └─ nginx.conf                   serves web build, proxies /api to the API
├─ docs/                           these documents (+ VERSIONS.md, DEPLOYMENT.md later)
├─ docker-compose.yml              full stack
├─ docker-compose.dev.yml          only Postgres, Redis, Mailpit, fixtures (apps run locally with hot reload)
├─ package.json                    workspaces + root scripts
├─ tsconfig.base.json
├─ .env.example
├─ .gitignore
└─ README.md
```

## Changes from the suggested structure (and why)

| Change | Reason |
|---|---|
| `prisma/` → **`packages/db/`** | Both the API and the scanner need the Prisma client. As a workspace package it is imported like a library (`import { prisma } from '@whc/db'`), with one schema and one generated client. |
| New **`packages/dom-checks/`** | The same in-page check code runs in the scanner (via `page.evaluate`) and in the extension's content script. Written once, tested once. |
| New **`apps/egress-proxy/`** | The SSRF choke point deserves its own small, separately tested service and container. |
| Routes / controller / service split in the API | Controllers deal with HTTP only; services hold logic and permission checks, so they can be unit-tested without HTTP. |

## Root scripts (planned)

| Command | Does |
|---|---|
| `npm run dev` | Start web, api, scanner, proxy with hot reload (needs `docker compose -f docker-compose.dev.yml up -d` first) |
| `npm run build` | Type-check and build every workspace |
| `npm run test` | All unit + integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma helpers |
| `docker compose up --build` | Everything in containers |
