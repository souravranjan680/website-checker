# 04 · REST API Specification

Base URL: `/api`. Interactive docs (Swagger UI, generated from the Zod schemas)
at **`/api/docs`**, raw spec at `/api/openapi.json` (planned for Phase 5).

> **Implemented so far (Phase 3):** health, all `/api/auth/*` endpoints,
> projects + members, websites (+ `/scans` history), `/api/activity`,
> `/api/admin/users`. Cookie names are `whc_access` (path `/api`) and
> `whc_refresh` (path `/api/auth`). Health endpoints return their report directly
> (no `{ data }` wrapper). Deleting a project takes `{ "confirmName": "<name>" }`
> in the request body.
>
> **Added in Phase 4:** `POST/GET /api/scans`, `GET /api/scans/:id`,
> `POST /api/scans/:id/cancel` (202), `POST /api/scans/:id/rescan`,
> `GET /api/scans/:id/events` (SSE), `GET /api/scans/:id/pages`,
> `GET /api/scans/:id/issues` (filters: category, severity, viewport, pageId, q),
> `GET /api/scans/:id/compare?with=`, `GET /api/screenshots/:id[?download=1]`,
> `PATCH /api/tracked-issues/:id`. Starting a scan returns **201** with the queued
> scan. The per-category report endpoints (`/api/reports/...`) and exports come in
> Phases 5–6; until then, issues are filtered by `category` on `/api/scans/:id/issues`.
> Not yet implemented: API tokens (Phase 7), `/api/websites/:id/verify` and `/schedule`
> (Phase 6), reports/exports, AI, visual, bug reports, dashboard, notifications.

## 1. Conventions

**Authentication**
- Browser: HttpOnly cookies `access_token` (15 min) + `refresh_token` (7 days),
  set by login. Requests use `credentials: 'include'`.
- Extension / scripts: `Authorization: Bearer whc_<token>` (personal API token).
- State-changing requests from the browser must send the header
  `X-Requested-With: whc-web` (CSRF defence, see [05-security.md](05-security.md)).

**Success response**
```json
{ "data": { ... } }
```
**List response** (`?page=1&pageSize=20&sort=-createdAt&q=search`)
```json
{
  "data": [ ... ],
  "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 }
}
```
`pageSize` max 100. `sort` is a whitelisted field name; `-` means descending.

**Error response**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid",
    "details": [{ "path": "url", "message": "Private or local addresses are not allowed" }],
    "requestId": "b3f1c2..."
  }
}
```

| HTTP | `code` examples | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `UNSAFE_URL` | Bad input |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` | Not logged in / token expired (client refreshes) |
| 403 | `FORBIDDEN` | Logged in, but your role can't do this |
| 404 | `NOT_FOUND` | Doesn't exist **or** you have no access (we don't reveal which) |
| 409 | `CONFLICT`, `SCAN_ALREADY_RUNNING` | Duplicate / state conflict |
| 422 | `INVALID_STATE` | e.g. cancelling a finished scan |
| 429 | `RATE_LIMITED` | Too many requests (`Retry-After` header) |
| 503 | `AI_NOT_CONFIGURED`, `AI_UNAVAILABLE` | Optional dependency missing or down |

**Roles in the tables below:** `auth` = any logged-in user ·
`V` = project VIEWER or higher · `E` = EDITOR or higher · `O` = OWNER ·
`admin` = global admin.

---

## 2. Endpoints

### Health & docs
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | none | `{ status, db, redis, version }` for Docker health checks |
| GET | `/api/docs` | none (dev) / admin (prod) | Swagger UI |

### Authentication
| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/api/auth/register` | none | `{ name, email, password }` → `201 { user }` + cookies |
| POST | `/api/auth/login` | none | `{ email, password }` → `{ user }` + cookies |
| POST | `/api/auth/logout` | auth | → `204`, session revoked, cookies cleared |
| POST | `/api/auth/refresh` | refresh cookie | → `204` + new cookies (rotation) |
| GET | `/api/auth/me` | auth | → `{ user, memberships[] }` |
| PATCH | `/api/auth/me` | auth | `{ name }` → `{ user }` (profile) |
| POST | `/api/auth/change-password` | auth | `{ currentPassword, newPassword }` → `204` |
| POST | `/api/auth/forgot-password` | none | `{ email }` → always `202` |
| POST | `/api/auth/reset-password` | none | `{ token, newPassword }` → `204` |

Password rule: 10–128 characters; checked against a small list of common
passwords.

### API tokens (for extension / CI)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/settings/api-tokens` | auth | List (prefix, name, last used; never the token) |
| POST | `/api/settings/api-tokens` | auth | `{ name, expiresInDays? }` → `{ token }` **shown once** |
| DELETE | `/api/settings/api-tokens/:id` | auth | Revoke |

### Projects
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/projects` | auth | Projects I'm a member of (paginated, `q`) |
| POST | `/api/projects` | auth | `{ name, description? }` → creator becomes OWNER |
| GET | `/api/projects/:id` | V | Details + website count + my role |
| PUT | `/api/projects/:id` | E | Update name/description |
| DELETE | `/api/projects/:id` | O | Delete (cascades; requires `?confirm=<project name>`) |
| GET | `/api/projects/:id/members` | V | Members |
| POST | `/api/projects/:id/members` | O | `{ email, role }` (user must already exist) |
| PATCH | `/api/projects/:id/members/:userId` | O | `{ role }` (can't remove the last owner) |
| DELETE | `/api/projects/:id/members/:userId` | O | Remove |

### Websites
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/websites` | auth | Filters: `projectId`, `q`, `verificationStatus`; includes latest scan summary |
| POST | `/api/websites` | E | See example below |
| GET | `/api/websites/:id` | V | Details + settings + latest scan + schedule |
| PUT | `/api/websites/:id` | E | Update name, settings, project |
| DELETE | `/api/websites/:id` | E | Delete with all scans |
| POST | `/api/websites/:id/verify` | E | Check meta tag / well-known file → `{ verificationStatus }` |
| GET | `/api/websites/:id/scans` | V | Scan history (paginated) |
| GET | `/api/websites/:id/trends` | V | `?range=30d|90d|1y` → score and issue series for charts |
| GET | `/api/websites/:id/schedule` | V | Schedule or `null` |
| PUT | `/api/websites/:id/schedule` | E | `{ cronExpression, timezone, isEnabled }` (min interval: hourly) |
| DELETE | `/api/websites/:id/schedule` | E | Remove schedule |
| GET | `/api/websites/:id/issues` | V | Tracked issues (`status`, `category`, `severity` filters) |
| PATCH | `/api/tracked-issues/:id` | E | `{ status: "IGNORED" \| "FALSE_POSITIVE" \| "OPEN" }` |

`POST /api/websites` example:
```json
{
  "projectId": "clx1...",
  "name": "Company homepage",
  "baseUrl": "https://example.com",
  "maxDepth": 2,
  "maxPages": 20,
  "excludePatterns": ["/blog/*"],
  "respectRobotsTxt": true,
  "authorizationConfirmed": true
}
```
`authorizationConfirmed` must be `true`. The URL goes through the URL-safety
check (scheme, port, DNS → public IP) before saving.

### Scans
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/scans` | E | Start a scan → `202 { scan }` |
| GET | `/api/scans` | auth | Filters: `websiteId`, `projectId`, `status`, date range |
| GET | `/api/scans/:id` | V | Status, progress, counts, scores, timings |
| GET | `/api/scans/:id/events` | V | **SSE** stream: `progress`, `page`, `completed`, `failed`, `cancelled` events |
| GET | `/api/scans/:id/pages` | V | Pages visited (status, title, http status, timings) |
| POST | `/api/scans/:id/cancel` | E | → `202`; `422` if already finished |
| POST | `/api/scans/:id/rescan` | E | New scan with the same config → `202 { scan }` |
| GET | `/api/scans/:id/compare` | V | `?with=<scanId>` (default: previous) → `{ new[], resolved[], recurring[], scoreDeltas }` |
| DELETE | `/api/scans/:id` | E | Delete a finished scan and its files |

`POST /api/scans` example:
```json
{
  "websiteId": "clx2...",
  "mode": "CRAWL",
  "urls": [],
  "overrides": { "maxPages": 10, "lighthouse": true, "responsive": true }
}
```
Response `202`:
```json
{ "data": { "id": "clx9...", "status": "QUEUED", "progress": 0, "queuedAt": "2026-11-02T10:00:00Z" } }
```
Limits: one running scan per website (`409 SCAN_ALREADY_RUNNING`), max
concurrent scans per user, hourly scan quota per user.

SSE event example:
```
event: progress
data: {"progress":42,"step":"Accessibility checks","pagesScanned":5,"pagesDiscovered":12}
```

### Reports
All report endpoints: auth V on the scan's project. Issue lists are paginated
and accept `severity`, `pageId`, `q`, `ruleId`, `viewport`, `detection`, `sort`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/reports/:scanId` | Overview: scores, counts by category × severity, top issues, pages |
| GET | `/api/reports/:scanId/accessibility` | Issues + WCAG summary + needs-review list + manual checklist |
| PATCH | `/api/reports/:scanId/accessibility/checklist` | Save manual checklist state (E) |
| GET | `/api/reports/:scanId/ui-health` | UI issues + console/network error summary |
| GET | `/api/reports/:scanId/responsive` | Per-viewport issues + screenshot IDs |
| GET | `/api/reports/:scanId/performance` | Lighthouse results per page + opportunities |
| GET | `/api/reports/:scanId/performance/:resultId/raw` | Download raw Lighthouse JSON |
| GET | `/api/reports/:scanId/seo` | SEO issues + per-page metadata table |
| GET | `/api/reports/:scanId/security` | Header table + issues |
| GET | `/api/reports/:scanId/export` | `?format=pdf|csv|json&category=...` → file download |

### Issues & screenshots
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/issues/:id` | V | Full detail incl. category details, screenshot, tracked status |
| GET | `/api/issues/:id/screenshot` | V | `?highlight=1` → PNG with the element outlined |
| GET | `/api/screenshots/:id` | V | Stream PNG (`?download=1` adds `Content-Disposition: attachment`) |

### AI (Claude)
| Method | Path | Auth | Body → Response |
|---|---|---|---|
| GET | `/api/ai/status` | auth | `{ configured: boolean, model }` |
| POST | `/api/ai/explain-issue` | V | `{ issueId, refresh?: false }` → `{ summary, whyItMatters, affectedUsers[], references[] }` |
| POST | `/api/ai/suggest-fix` | V | `{ issueId }` → `{ fixSteps[], correctedHtml?, correctedCss?, notes }` |
| POST | `/api/ai/generate-bug-report` | E | `{ issueId }` → draft bug report fields (not saved until the user confirms) |

All three return `503 AI_NOT_CONFIGURED` when no key is set, and cache results
in `AiInsight`.

### Visual regression
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/visual/baselines` | V | `?websiteId=` |
| POST | `/api/visual/baselines` | E | `{ websiteId, pageUrl, viewport, fromScreenshotId? }` (else capture now) |
| PATCH | `/api/visual/baselines/:id` | E | `{ ignoreRegions, failPercent }` |
| DELETE | `/api/visual/baselines/:id` | E | |
| POST | `/api/visual/compare` | E | `{ baselineId }` → captures now, `202 { comparisonId }` (queued) |
| GET | `/api/visual/comparisons` | V | `?baselineId=` history |
| GET | `/api/visual/comparisons/:id` | V | Result + baseline/current/diff screenshot IDs |

### Bug reports
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/bug-reports` | auth | Filters: `projectId`, `websiteId`, `severity`, `status`, `q` |
| POST | `/api/bug-reports` | E | Create (manual or from AI draft) |
| POST | `/api/bug-reports/from-issue/:issueId` | E | Pre-filled from the issue |
| GET | `/api/bug-reports/:id` | V | |
| PUT | `/api/bug-reports/:id` | E | |
| DELETE | `/api/bug-reports/:id` | E | |
| GET | `/api/bug-reports/:id/export` | V | `?format=pdf|csv|json|jira` |
| GET | `/api/bug-reports/export` | auth | Bulk `?ids=...&format=csv|json|pdf` |

### Dashboard, notifications, activity, admin
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard/summary` | auth | All dashboard cards |
| GET | `/api/dashboard/trends` | auth | `?range=` chart series |
| GET | `/api/notifications` | auth | `?unread=true` |
| POST | `/api/notifications/:id/read` | auth | |
| POST | `/api/notifications/read-all` | auth | |
| GET | `/api/activity` | auth | `?projectId=` audit feed |
| GET | `/api/admin/users` | admin | List users |
| PATCH | `/api/admin/users/:id` | admin | `{ role, isActive }` |

---

## 3. Rate limits (Redis-backed, per user, or per IP when anonymous)

| Scope | Limit |
|---|---|
| `POST /auth/login`, `/auth/forgot-password` | 5 / min per IP + per email |
| `POST /auth/register` | 10 / hour per IP |
| `POST /scans`, `/rescan`, `/visual/compare` | 20 / hour per user (+ max 3 concurrent) |
| `/ai/*` | 30 / hour per user |
| Everything else | 300 / 15 min per user |

All values are environment-configurable.

---

## 4. How the frontend calls the API (example)

```ts
// apps/web/src/lib/api-client.ts (simplified preview of Phase 5)
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',                      // send auth cookies
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'whc-web', ...init.headers },
  });
  if (res.status === 401 && (await res.clone().json()).error?.code === 'TOKEN_EXPIRED') {
    await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include',
      headers: { 'X-Requested-With': 'whc-web' } });
    return api<T>(path, init);                   // retry once (real code guards against loops)
  }
  if (!res.ok) throw await ApiError.from(res);
  return (await res.json()).data as T;
}

// usage with TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['scan', scanId],
  queryFn: () => api<Scan>(`/scans/${scanId}`),
});
```
