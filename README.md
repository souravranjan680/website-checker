# Website Accessibility & UI Health Checker

A web application that scans websites for accessibility (WCAG), UI, responsive,
performance, SEO and basic security problems, with screenshots, AI explanations,
bug reports and scan history.

> **Status: Phase 2 of 8 complete (project setup).** The monorepo, database,
> API skeleton, web shell and Docker stack run and are tested. Scanning, logins and
> the product pages arrive in Phases 3–7; see [docs/08-roadmap.md](docs/08-roadmap.md).

| Doc | |
|---|---|
| [docs/README.md](docs/README.md) | Design documents (architecture, database, API, security, ...) |
| [docs/09-phase-2-setup.md](docs/09-phase-2-setup.md) | **How this setup works**: config files, dependencies, database, health checks, debugging |
| [docs/VERSIONS.md](docs/VERSIONS.md) | Exact versions and why |

---

## Tech stack

React 19 · Vite 8 · Tailwind CSS 4 · shadcn/ui · React Router 8 · TanStack Query ·
Node.js 24 · Express 5 · TypeScript 6 · PostgreSQL 17 · Prisma 7 · Redis 7 ·
Zod 4 · Vitest · Docker Compose. *(Planned: Playwright, axe-core, Lighthouse,
BullMQ, Claude API, Chrome Extension MV3.)*

## Project structure

```
apps/
  api/            Express REST API          (src/app.ts, src/server.ts, src/modules/*)
  web/            React dashboard           (src/app, src/features, src/components/ui)
packages/
  shared/         Code used by API and web  (Zod schemas, constants)
  db/             Prisma schema, migrations, typed client, relationship tests
docker/           Dockerfiles, nginx config, Postgres init script
docs/             Design and explanation documents
docker-compose.yml
.env.example      All settings (copy to .env)
```

---

## Prerequisites (Windows)

| Tool | Check with | Get it |
|---|---|---|
| Node.js **24** + npm 11 | `node -v` · `npm -v` | https://nodejs.org (LTS) |
| Docker Desktop (running) | `docker version` | https://www.docker.com/products/docker-desktop |
| Git | `git --version` | https://git-scm.com |

All commands below are for **PowerShell**, run from the project folder
(e.g. `C:\Users\<you>\Desktop\website`).

## First-time setup

```powershell
# 1. Get the code (skip if you already have the folder)
git clone https://github.com/souravranjan680/website-checker.git
cd website-checker

# 2. Create your local settings file (never committed)
Copy-Item .env.example .env

# 3. Install all dependencies for every package (+ generates the Prisma client)
npm install
npm run db:generate

# 4. Start PostgreSQL, Redis and Mailpit in Docker, wait until healthy
docker compose up -d --wait postgres redis mailpit

# 5. Create the database tables
npm run db:deploy
```

## Run the app: option A, development (recommended while coding)

The database services run in Docker; the API and web run on your PC with
**hot reload** (save a file → it updates instantly).

```powershell
docker compose up -d --wait postgres redis mailpit   # if not already running
npm run dev
```

| Open | What |
|---|---|
| http://localhost:5173 | Web app (System Status page) |
| http://localhost:5173/api/health | Health check (through the Vite proxy) |
| http://localhost:4000/api/health | Health check (API directly) |
| http://localhost:8025 | Mailpit inbox (used from Phase 3) |

Stop: press **Ctrl + C** in the `npm run dev` terminal, then `npm run services:down`.

## Run the app: option B, everything in Docker

```powershell
docker compose up -d --build --wait
```

This builds the images, runs database migrations (the `migrate` container runs
once and exits), then starts the API and the nginx web server.

| Open | What |
|---|---|
| http://localhost:8081 | Web app |
| http://localhost:8081/api/health | Health check |

```powershell
docker compose ps                 # status of every container
docker compose logs -f api        # follow API logs (Ctrl+C to stop following)
docker compose stop               # stop everything (data is kept)
docker compose down               # stop and remove containers (data is kept in volumes)
docker compose down -v            # ⚠ also DELETES the database and Redis data
```

> Don't run option A's `npm run dev` and option B at the same time against the
> same database while developing migrations; use one mode at a time.

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | API (:4000) + web (:5173) with hot reload |
| `npm run check` | **Everything CI would check**: schema validation → type check → lint → all tests |
| `npm test` | All tests (needs Postgres + Redis running) |
| `npm run typecheck` | TypeScript errors in every workspace |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | Production build of the API and web |
| `npm run services:up` / `services:down` | Start/stop Postgres, Redis, Mailpit |
| `npm run db:validate` | Check `schema.prisma` for errors |
| `npm run db:migrate -- --name <change>` | After editing the schema: create + apply a migration |
| `npm run db:deploy` | Apply committed migrations (no new ones) |
| `npm run db:status` | Which migrations are applied |
| `npm run db:generate` | Regenerate the typed Prisma client |
| `npm run db:studio` | Browse the database in your browser |
| `npm run db:reset` | ⚠ Drop and recreate the dev database |

Run one workspace's script: `npm run test -w @whc/api` (or `@whc/web`, `@whc/db`, `@whc/shared`).

## Health checks

| Endpoint | Meaning |
|---|---|
| `GET /api/health/live` | API process is running → `200` |
| `GET /api/health` | API can reach PostgreSQL **and** Redis → `200`; otherwise `503` with details |

```powershell
Invoke-RestMethod http://localhost:4000/api/health | ConvertTo-Json -Depth 5
docker compose ps        # Docker's own health status per container
```

## Configuration

All settings live in `.env` (template: [.env.example](.env.example), with
comments for every variable). Important ones:

| Variable | Default | Used for |
|---|---|---|
| `DATABASE_URL` / `DATABASE_URL_TEST` | local Docker Postgres | App / automated tests |
| `REDIS_URL` | `redis://localhost:6379` | Health check, later queue |
| `CORS_ORIGINS` | `:5173`, `:8081` | Which web origins may call the API |
| `WEB_PORT` | `8081` | Docker web port (8080 was taken on this PC) |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | AI model (Phase 6), change any time |
| `ANTHROPIC_API_KEY` | empty | AI features are off until set |

**Never commit `.env`** or real keys. `.gitignore` already excludes it.

---

## Git: checkpoint commits

The repository is already initialized and connected to GitHub. For a brand-new copy
you would run `git init -b main` once, then `git remote add origin <url>`.

After finishing a piece of work:
```powershell
git status                     # what changed? (.env must NOT appear)
git add -A                     # stage everything that isn't ignored
git commit -m "feat: phase 2 project setup"
git push                       # upload to GitHub
git log --oneline              # history of checkpoints
```
To go back and look at an earlier checkpoint: `git log --oneline`, then
`git switch --detach <commit-id>` (return with `git switch main`).

---

## Known limitations (Phase 2)

- Only the System Status page exists; other sidebar items show the phase that delivers them.
- No authentication yet (Phase 3). The API currently exposes only health endpoints.
- The API Docker image is ~730 MB: `npm ci` installs every workspace's production
  dependencies plus Prisma's peer dependencies. It works; slimming it is planned
  for Phase 8.
- Scanner, egress proxy (SSRF protection) and Chrome extension are designed
  ([docs/](docs/README.md)) but not implemented yet (Phases 4 and 7).
- Prisma shows an "update available → 8.0.0-rc" notice. That's a release
  candidate; we intentionally stay on stable 7.10.1.
