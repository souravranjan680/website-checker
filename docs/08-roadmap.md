# 08 · Development Roadmap

Each phase ends with: what was built · files changed · how to run it · tests
run (with real output) · known gaps. **I stop after each phase for your
approval.**

| Phase | Goal | Done when... |
|---|---|---|
| **1 · Architecture** ✅ | These documents | You approve the design (or ask for changes) |
| **2 · Setup** ✅ | Monorepo, TypeScript, lint, Vite app shell, Express skeleton, `packages/db` with the schema + first migration, Docker Compose (Postgres, Redis, Mailpit, migrate, API, web), `.env.example`, `/api/health` | Done: `npm run dev` and `docker compose up -d --build --wait` both serve a live System Status page; `/api/health` reports db + redis; `npm run check` passes (26 tests); see [09-phase-2-setup.md](09-phase-2-setup.md) |
| **3 · Core backend** ✅ | Auth (register/login/logout/refresh/me/forgot/reset), RBAC, projects + members, websites (with URL-safety validation), activity log, rate limiting, error handling, plus the auth/projects/websites frontend pages | Done: 72 API + 21 web + 73 shared tests green ([10-phase-3-auth.md](10-phase-3-auth.md)). Changed: no seed users (`admin:promote` instead, per "no hardcoded users"); OpenAPI/Swagger moved to Phase 5 |
| **4 · Scanning engine** | Egress proxy, BullMQ queue, worker, crawler, axe-core, DOM checks, responsive, link check, screenshots + bounding boxes, progress (SSE), cancel, fingerprints, scores, `POST /scans` end to end | Scanning each fixture site produces the expected issues (Playwright Test); cancel works; proxy blocks redirect-to-localhost test |
| **5 · Frontend** | Design system, layout, all pages for auth, dashboard, projects, websites, scan center/progress, the 6 reports, issue drawer with screenshot highlight, history + compare, profile, settings, themes | Component + form tests green; E2E: register → add fixture site → scan → see real issues |
| **6 · Advanced** | Lighthouse, SEO + security stages, Claude integration, visual regression, bug reports + PDF/CSV/JSON/Jira export, schedules, notifications, storage cleanup | Tests per feature (AI with fake provider); exports open correctly |
| **7 · Chrome extension** | MV3 manifest, popup, content scripts using `dom-checks` + axe, highlighting, copy, dashboard hand-off | Loads unpacked in Chrome; Playwright extension test on a fixture page |
| **8 · Hardening & deployment** | Full Docker build, non-root images, security review against 05-security.md, `npm audit`, deployment guide, README polish, demo script for your interview | `docker compose up --build` runs everything on a clean machine; all test suites green |

## Risks I'm already planning around

| Risk | Mitigation |
|---|---|
| Playwright/Lighthouse on Windows differ from Linux containers | Develop locally, but the scanner's "official" runtime is the Playwright Docker image; tests run in both where possible |
| Heavy resource usage (5 viewports × pages + Lighthouse) | Page limits per stage, worker concurrency 2, Lighthouse sequential |
| False positives from heuristic UI checks | Severity tuned conservatively; "false positive" button persists via fingerprint; heuristics labelled as such |
| Egress proxy complexity | Kept small, written with tests first; well-known protocol (HTTP CONNECT) |
| Scope is large | Each phase delivers something that runs; anything unfinished is listed honestly, never faked |

## What you'll be able to demo at the end

1. Add a deliberately broken site → watch a live scan → walk through real
   findings with highlighted screenshots.
2. Ask Claude to explain an issue and propose corrected HTML.
3. Fix the fixture → rescan → show "3 resolved, 0 new" and the score going up.
4. Show the SSRF defence: try to scan `http://169.254.169.254` and a site that
   redirects there, and both are blocked, with the log line.
5. Run the extension on any public page.
6. Run the test suites.
