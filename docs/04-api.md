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

---

## Phase 5 endpoints (implemented)

All require sign-in; every one checks project access (outsiders get 404).
Details and the meaning of each number: [12-phase-5-frontend.md](12-phase-5-frontend.md).

| Method & path | Purpose |
|---|---|
| `GET /api/dashboard/summary?projectId&websiteId&from&to&status` | Totals, open issues by severity/category, latest-scan scores, recent scans/websites/activity |
| `GET /api/dashboard/trends?...same` | One point per day: scans by status, average scores, new and resolved issues |
| `GET /api/scans?q&projectId&websiteId&status&from&to&page&pageSize` | Scan history (paginated) |
| `GET /api/scans/:id/compare?with=:otherId` | New / resolved / still-present issues between two scans of one website |
| `GET /api/scans/:id/issues?category&severity&q&ruleId&checkType&viewport&detection&trackedStatus&page` | Filtered issue list |
| `GET /api/issues/:id` | One issue + tracking + timeline |
| `GET /api/reports/:scanId/accessibility` · `ui-health` · `responsive` | Report data |
| `GET /api/reports/:scanId/performance` · `seo` · `security` | Real rows or `available: false` |
| `PATCH /api/reports/:scanId/accessibility/checklist` | `{itemId, status: PASS\|FAIL\|NOT_APPLICABLE\|null, note?}` (editor+) |
| `GET /api/reports/:scanId/export?format=pdf\|csv\|json&category=` | File download (PDF: 503 `PDF_UNAVAILABLE` if no scanner runs) |
| `GET /api/websites/:id/stats` | Scan count, latest scan, tracked issues by status |
| `GET /api/websites/:id/issues?status&category&severity&q&page` | Tracked issues of a website |
| `GET /api/activity?websiteId=` | Activity of one website and its scans |
| `GET /api/auth/sessions` · `DELETE /api/auth/sessions/:id` · `DELETE /api/auth/sessions/others` | Signed-in devices |
| `GET /api/auth/preferences` · `PUT /api/auth/preferences` | Notification preferences (stored; delivery in Phase 6) |

---

## Phase 6 endpoints (implemented)

Details, rules and limits: [13-phase-6-advanced-audits.md](13-phase-6-advanced-audits.md#12-new-api-endpoints).

| Method & path | Purpose |
|---|---|
| `GET /api/reports/:scanId/seo` · `security` · `performance` | Real SEO, security (finding levels, TLS, redirect) and Lighthouse reports |
| `GET /api/reports/:scanId/lighthouse/:resultId` | Raw Lighthouse JSON |
| `GET /api/visual/baselines` · `GET/POST /api/visual/websites/:id/baselines` | List / create baselines (editor+, explicit) |
| `PATCH/DELETE /api/visual/baselines/:id` · `POST /api/visual/baselines/:id/replace` · `GET …/comparisons` | Settings, replace image, delete, history |
| `GET /api/visual/scans/:scanId` | A scan's snapshots with baseline and comparison |
| `POST /api/bug-reports` `{ issueId }` · `GET /api/bug-reports` | Create from an issue (editor+) / list |
| `GET/PATCH/DELETE /api/bug-reports/:id` · `GET /api/bug-reports/:id/export?format=markdown|jira|json` | Read, edit, delete, export |
| `GET /api/ai/status` · `GET /api/ai/issues/:id` · `POST /api/ai/issues/:id/explain` | AI status, saved explanation, explain (rate limited) |
| `GET /api/notifications` · `GET …/unread-count` · `POST …/:id/read` · `POST …/read-all` | The user's notifications |

## Phase 9, Milestone 1 endpoints (implemented)

Details, safety rules and limits: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#5-milestone-1-the-safe-interaction-explorer-complete).

| Method & path | Purpose |
|---|---|
| `GET /api/reports/:scanId/functional` | Interactions report: findings per check, explored / skipped (with reasons) / blocked actions per page, open-state accessibility count |
| `POST /api/websites` · `PUT /api/websites/:id` | Also accept `explorationEnabled` (default `true`), `explorationPageLimit` (0–10, default 5) and `explorationControlLimit` (1–50, default 30) |
| Issue DTOs | New category `FUNCTIONAL` (filters, exports) and `functional: { checkType, controlName, controlRole, controlSelector, interaction }` |

## Phase 9, Milestone 2 (Checkpoint 1) changes (implemented)

Details: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#6-milestone-2-checkpoint-1-layout-fonts-and-icons-component-consistency-complete).

| Method & path | Change |
|---|---|
| `POST /api/websites` · `PUT /api/websites/:id` | Also accept `consistencyEnabled` (default `true`); clients that omit it keep the stored value |
| `GET /api/reports/:scanId/ui-health` | New field `extraChecks`: `{ layout, fontsAndIcons, consistency, consistencyPages, byClassification }` (all screen sizes; never part of the score). Existing fields unchanged |
| `GET /api/scans/:id/issues?checkType=` | Also accepts the new UI check types (`TEXT_OVERFLOW_VISIBLE`, `TEXT_OVERLAP`, `FIXED_OUT_OF_VIEWPORT`, `CONTROL_LABEL_CLIPPED`, `FONT_LOAD_FAILED`, `FONT_FALLBACK_RENDERED`, `ICON_BROKEN`, `ICON_MISSING`, `COMPONENT_INCONSISTENT`) |

## Phase 9, Milestone 2 (Checkpoint 2) changes (implemented)

Details: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#7-milestone-2-checkpoint-2-keyboard-and-form-probes-complete).

| Method & path | Change |
|---|---|
| `POST /api/websites` · `PUT /api/websites/:id` | Also accept `keyboardProbeEnabled` (default `true`) and `formProbeMode` (`OFF` | `STATIC` | `BLUR` | `SYNTHETIC`, default `BLUR`; `SYNTHETIC` only when sent explicitly). Clients that omit them keep the stored values |
| `GET /api/reports/:scanId/functional` | Per page: `keyboard` and `forms` (probe results, skipped items with reasons; `null` for older scans). Totals: `pagesKeyboardChecked`, `formFieldsProbed`, `probesSkipped`. Existing fields unchanged |
| Issue DTOs, filters, exports | 12 new `FUNCTIONAL` check types (`FOCUS_NOT_VISIBLE`, `FOCUS_ON_HIDDEN`, `FOCUS_LOST`, `KEYBOARD_TRAP`, `KEY_ACTIVATION_FAILED`, `CLICK_NOT_FOCUSABLE`, `FORM_REQUIRED_NOT_INDICATED`, `FORM_INDICATOR_WITHOUT_REQUIRED`, `FORM_DESCRIBEDBY_MISSING`, `FORM_PLACEHOLDER_ONLY_LABEL`, `FORM_ERROR_NOT_ASSOCIATED`, `FORM_NO_BLUR_FEEDBACK`) |

## Phase 9, Milestone 3 (Checkpoint 1) changes (implemented)

Details: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#8-milestone-3-checkpoint-1-browser-foundation-complete).

| Method & path | Change |
|---|---|
| `POST /api/websites` · `PUT /api/websites/:id` | Also accept `crossBrowserEnabled` (default `false`), `crossBrowserTargets` (`FIREFOX` and/or `WEBKIT`, default both; no duplicates), `crossBrowserPageLimit` (1–10, default 3) and `crossBrowserMobile` (WebKit at 390×844, default `false`). Clients that omit them keep the stored values |

The per-browser results (`ScanBrowserRun`, `ScanPage.compatibility`) are stored but not yet exposed by the API (Checkpoint 3).

## Phase 9, Milestone 3 (Checkpoint 2) changes (implemented)

Details: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#9-milestone-3-checkpoint-2-comparison-and-classification-complete).

| Method & path | Change |
|---|---|
| Issue DTOs | New category `COMPATIBILITY` and `compatibility: { browser, browserVersion, baselineVersion, checkType, matchMethod, evidence }` (`null` for every other category). Rule IDs `compat/browser-only-error`, `compat/browser-only-resource-failure`, `compat/browser-only-font-failure`, `compat/browser-only-layout`, `compat/browser-only-accessibility`, `compat/unsupported-css` |
| `GET /api/scans/:id/issues?category=` · `GET /api/websites/:id/issues?category=` | Accept `COMPATIBILITY` |
| `GET /api/reports/:scanId/export?category=` | Accepts `COMPATIBILITY`. JSON export: each issue also has `compatibility` (`{ browser, browserVersion, baselineVersion, checkType }` or `null`). CSV columns unchanged (the title names the browser; the description has both versions) |
| Bug-report drafts | For a `COMPATIBILITY` issue the environment is the other browser's version, with a step to compare in the recorded Chromium version |

Scores are unchanged: `COMPATIBILITY` is never scored.

## Phase 9, Milestone 3 (Checkpoint 3) changes (implemented)

Details: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#10-milestone-3-checkpoint-3-api-ui-reports-and-final-verification-complete).

| Method & path | Change |
|---|---|
| `GET /api/reports/:scanId/browsers` | **New.** Project members (viewers included); 404 for others. Returns `crossBrowser` (`ON` / `OFF` / `UNKNOWN` from the scan's settings snapshot), `browsers` (Chromium as `BASELINE`; Firefox and WebKit as `COMPARED`, each with `state`, `message`, `version`, times, pages planned/checked, `skippedChecks` with reasons, and their `COMPATIBILITY` issue count), `pages` (each browser's result per size with the comparison, plus `unreadable`: stored results that could not be read) and `checks` (issues per browser and check type, by classification). States: `COMPLETED`, `PARTIAL`, `FAILED`, `UNAVAILABLE`, `TIMED_OUT`, `SKIPPED`, `CANCELLED`, `RUNNING`, and three that are never a run: `DISABLED` (off, or not chosen), `NOT_RUN` (chosen, but the scan ended before the browser stage) and `NOT_RECORDED` (older scans) |
| `GET /api/scans/:id/issues` | Also accepts `browser=FIREFOX|WEBKIT`, and the six cross-browser check types in `checkType` (UI check types unchanged; anything else is still 400) |
| `GET /api/websites/:id/issues` | Also accepts `browser=FIREFOX|WEBKIT` |
| `POST /api/scans` | The scan's settings snapshot (`Scan.config`) also records `crossBrowserEnabled` and `crossBrowserTargets` |
| `GET /api/reports/:scanId/export` | JSON: a top-level `browsers` block (`chromiumVersion`, the browser runs) **only** for scans that checked other browsers; otherwise the export is unchanged. CSV: unchanged. PDF: a "Browsers" section only for such scans, and the browser and both versions on each cross-browser issue |

## Phase 9, Milestone 4 (Checkpoint 1) changes (implemented)

Website comparison (Mode 2), definitions only. Details: [16-phase-9-website-parity-functional-regression.md](16-phase-9-website-parity-functional-regression.md#11-milestone-4-checkpoint-1-website-comparison-data-foundation-complete).

| Method & path | Role | Change |
|---|---|---|
| `POST /api/website-comparisons` | EDITOR | **New.** Body: `projectId`, `name` (2–80), `referenceWebsiteId`, `targetWebsiteId`, optional `maxPages` (1–50, default 10), `maxDepth` (0–3, default 1), `includePatterns`/`excludePatterns` (≤ 20 each, start with `/`), `viewports` (scan sizes, e.g. `1920x1080`; default `["1920x1080"]`). Unknown fields → 400. Both websites must be in the project (otherwise 404 `NOT_FOUND`, path `referenceWebsiteId`/`targetWebsiteId`; also when a website is moved or deleted while the comparison is being created) and different (400). Returns 201 with the comparison |
| `GET /api/website-comparisons?projectId=&q=&archived=false\|true\|all&page=&pageSize=` | VIEWER | **New.** Comparisons of visible projects; `q` searches the comparison's and both websites' names; not archived by default |
| `GET /api/website-comparisons/:id` | VIEWER | **New.** `{ id, projectId, projectName, name, state, reference, target, settings, latestRun, runCount, archivedAt, createdBy, myRole, createdAt, updatedAt }` |
| `PUT /api/website-comparisons/:id` | EDITOR | **New.** Partial: `name`, settings, `archived` (`true` archives, `false` restores). The websites cannot be changed. 409 `WEBSITE_COMPARISON_RUN_ACTIVE` while a run is active (runs exist from Checkpoint 3) |
| `DELETE /api/website-comparisons/:id` | EDITOR | **New.** 204; also deletes its runs. 409 `WEBSITE_COMPARISON_RUN_ACTIVE` while a run is active |
| `DELETE /api/websites/:id` | EDITOR | **409 `WEBSITE_IN_COMPARISON`** when a website comparison uses the website; `details: { count, comparisons: [{ id, name }] }` (up to 20). Unchanged otherwise |
| `PUT /api/websites/:id` with another `projectId` | EDITOR | Same 409 when moving a website that a comparison uses. Other edits unchanged |

`state` is derived, never stored: `ARCHIVED` (archived), `DRAFT` (no runs yet), `IN_USE` (has runs). It is not a run status; `latestRun.status` is (`QUEUED`, `RUNNING`, `CANCELLING`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED`). Non-members get 404, too-low roles 403, signed-out 401, writes without `X-Requested-With: whc-web` 403 (as everywhere). Run endpoints arrive in Checkpoint 3.
