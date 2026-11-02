# 07 · User Workflow & Pages

## 1. Main journey

```mermaid
flowchart TD
    A[Register / Log in] --> B[Dashboard<br/>empty state on first visit]
    B --> C[Create project]
    C --> D[Add website<br/>URL, crawl limits, authorization checkbox]
    D --> E{Verify domain?<br/>optional}
    E -->|yes| E1[Add meta tag / file → Verify]
    E -->|later| F
    E1 --> F[Scan Center: start scan<br/>single page / URL list / crawl]
    F --> G[Scan Progress<br/>live progress via SSE, cancel button]
    G -->|completed| H[Report overview<br/>scores + counts by category]
    G -->|failed/partial| H
    H --> I[Category reports<br/>Accessibility · UI · Responsive · Performance · SEO · Security]
    I --> J[Issue drawer<br/>highlighted screenshot, selector, HTML, fix]
    J --> K[AI: explain / suggest fix]
    J --> L[Create bug report → export PDF/CSV/JSON/Jira]
    J --> M[Mark ignored / false positive]
    L --> N[Developer fixes the site]
    N --> O[Rescan]
    O --> P[Scan History: compare<br/>new · resolved · recurring · score change]
    H --> Q[Set visual baseline]
    Q --> R[Later scans → visual comparison + alert]
    D --> S[Schedule weekly scans]
```

## 2. Scan lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> QUEUED: POST /api/scans
    QUEUED --> RUNNING: worker picks job
    QUEUED --> CANCELLED: cancel before start
    RUNNING --> CANCELLING: cancel requested
    CANCELLING --> CANCELLED: worker stops (results kept)
    RUNNING --> COMPLETED: all stages ok
    RUNNING --> PARTIAL: some pages/stages failed
    RUNNING --> FAILED: fatal error / timeout / start URL unreachable
    COMPLETED --> [*]
    PARTIAL --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

## 3. Chrome extension journey

1. Open any page → click the extension icon → **Scan this page**.
2. Popup shows counts (critical/high/medium/low) and the issue list.
3. Click an issue → the page scrolls to the element, which is outlined.
4. **Copy** → issue details as Markdown for a ticket or chat.
5. **Open full report** → opens the dashboard's Scan Center with the URL filled
   in (or starts the server scan directly if an API token is configured).

## 4. Page map (all 21 required pages)

| # | Page | Route | Main data (API) |
|---|---|---|---|
| 1 | Login | `/login` | `POST /auth/login` |
| 2 | Registration | `/register` | `POST /auth/register` |
| 3 | Forgot password (+ reset) | `/forgot-password`, `/reset-password?token=` | `POST /auth/forgot-password`, `/auth/reset-password` |
| 4 | Dashboard | `/` | `/dashboard/summary`, `/dashboard/trends` |
| 5 | Projects | `/projects`, `/projects/:id` | `/projects`, members |
| 6 | Website management | `/websites` | `GET /websites` (search, filter, paginate) |
| 7 | Add website | `/websites/new` | `POST /websites` |
| 8 | Website details | `/websites/:id` | website, schedule, latest scan, tracked issues, verify |
| 9 | Scan Center | `/scans` (+ `/scans/new?url=`) | start scans, list running/queued/recent |
| 10 | Scan progress | `/scans/:id` | `GET /scans/:id` + SSE `/events` |
| 11 | Accessibility report | `/scans/:id/accessibility` | `/reports/:id/accessibility` |
| 12 | UI health report | `/scans/:id/ui-health` | `/reports/:id/ui-health` |
| 13 | Responsive report | `/scans/:id/responsive` | `/reports/:id/responsive` |
| 14 | Performance report | `/scans/:id/performance` | `/reports/:id/performance` |
| 15 | SEO report | `/scans/:id/seo` | `/reports/:id/seo` |
| 16 | Security report | `/scans/:id/security` | `/reports/:id/security` |
| 17 | Visual regression | `/visual`, `/visual/:baselineId` | `/visual/*` |
| 18 | Bug reports | `/bug-reports`, `/bug-reports/:id` | `/bug-reports/*` |
| 19 | Scan history | `/history`, `/websites/:id/history` | `/scans`, `/scans/:id/compare` |
| 20 | User profile | `/profile` | `/auth/me`, change password |
| 21 | Settings | `/settings` | theme, API tokens, AI status, (admin) users |

Every page has a **loading skeleton**, an **empty state** with a next action,
an **error state** with retry, and keyboard-accessible controls. The app's own
pages are scanned by the tool's E2E tests ("eat our own dog food").

## 5. Layout

```
┌──────────────┬─────────────────────────────────────────────────────┐
│  ◉ WHC       │  Search…            🔔 3   ◐ theme   (avatar ▾)      │
│              ├─────────────────────────────────────────────────────┤
│  Dashboard   │  Page title                         [Primary action]│
│  Projects    │  ─────────────────────────────────────────────────  │
│  Websites    │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│  Scan Center │  │ card   │ │ card   │ │ card   │ │ card   │         │
│  History     │  └────────┘ └────────┘ └────────┘ └────────┘         │
│  Visual      │  ┌─────────────────────────┐ ┌──────────────────┐    │
│  Bug Reports │  │ chart                   │ │ list             │    │
│  ─────────   │  └─────────────────────────┘ └──────────────────┘    │
│  Settings    │  ┌──────────────────────────────────────────────┐    │
│              │  │ table (sortable, filterable, paginated)      │    │
└──────────────┴──┴──────────────────────────────────────────────┴────┘
```
Neutral palette (zinc/slate), one accent colour, severity colours (critical
red, high orange, medium amber, low blue, info grey) always paired with an
icon + text label (never colour alone, since that would fail our own a11y checks).
