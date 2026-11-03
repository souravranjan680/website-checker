# Phase 9: Website Health Scan and Website Comparison

Status: **in progress.**
- Milestone 0 (foundations) is complete.
- Milestones 1 to 8 are planned (see section 5).
- This document grows with each milestone.

## 1. Product purpose

Phase 9 turns the checker into a generic QA automation tool with two modes on one shared
engine:

| Mode | Input | What it does | Where results live |
|---|---|---|---|
| **1 · Website Health Scan** | One authorized website | Finds UI, visual, interaction, navigation, form, responsive, accessibility, compatibility and performance problems by itself. No reference site or QA sheet is needed. | The existing `Scan` / `Issue` / `TrackedIssue` tables, extended |
| **2 · Website Comparison** | Two authorized websites (reference and target) | Compares pages, elements, text, layout, styles, interaction states and responsive behaviour. Differences are observations or potential defects, never confirmed automatically. | New comparison tables (from Milestone 4) |

A sample QA report (30 bugs found on a DocuSign clone) is **one optional acceptance
dataset** for Mode 2. Detection is generic: no detector contains fixture- or
report-specific logic, and a test enforces that (section 4.4).

## 2. Decisions approved before implementation

1. **Mode 1 extends `Scan` and `Issue`.** Existing history, reports, dashboard, scores
   and the Chrome extension keep working.
2. **Review is separate from the lifecycle.** The lifecycle statuses stay exactly as
   they were (`OPEN`, `RESOLVED`, `IGNORED`, `FALSE_POSITIVE`). A separate
   `reviewStatus` (`UNREVIEWED`, `CONFIRMED`, `INTENTIONAL`) holds the team's verdict,
   with an append-only history. A confirmed issue can still become `RESOLVED` later.
3. **The safe explorer is on by default** (5 pages × 30 eligible controls,
   configurable).
   - It only opens recognised disclosure controls: menus, tabs, accordions, expandable
     sections.
   - It never submits forms or clicks unknown or destructive actions (Send, Delete,
     Submit, Sign, Purchase, Save, Create…).
   - Skipped controls are recorded.
4. **Cross-browser checks are opt-in** (Firefox, WebKit). Results are labelled "engine
   difference"; Linux WebKit is not presented as Safari on macOS.
5. **The QA dataset runs on local reference and clone replicas only.** There is no
   automation of the production DocuSign service.
   - QA-016: the screenshot is followed (Clear and Apply).
   - QA-009: inconclusive (the evidence conflicts).
   - QA-029/030: the evidence mapping is corrected (the two links were swapped).
   - Viewports: `1280×960`, `1024×960`, `389×960`.
   - CSV import of QA sheets is optional.
6. **Safety:**
   - automatic interaction testing runs against isolated local fixtures;
   - writes are held and aborted, and WebSockets, downloads, pop-ups and external
     navigation are blocked;
   - server-side counters must show zero unintended writes.
7. **Acceptance targets apply to the deterministic fixtures.** 100% recall and zero
   false positives are required per detector category on the deterministic fixture
   sites, not on arbitrary websites.
8. **Stability:** existing behaviour, scores, reports, dashboard, API contracts and the
   extension are preserved. Any breaking change is identified before implementation.

## 3. Finding classification (both modes)

| Classification | Set by | Meaning |
|---|---|---|
| `DETECTED` | Tool | A deterministic rule failed, with objective evidence |
| `POTENTIAL_DEFECT` | Tool | Heuristic evidence suggests something is broken |
| `OBSERVATION` | Tool | A fact or difference worth reviewing; no evidence of breakage |
| `INCONCLUSIVE` | Tool | Could not be verified, or a person must decide |
| Review: `CONFIRMED` / `INTENTIONAL` (+ lifecycle `FALSE_POSITIVE`) | **People only** | The team's decision, with a note and history |

Rules for single-site issues (`classifyDraft` in `apps/scanner/src/issues.ts`; the
migration applies the same rules to older rows):

| Issue | Classification |
|---|---|
| axe violation / axe "needs review" | `DETECTED` / `INCONCLUSIVE` |
| Security `CONFIRMED` / `WARNING` / `OBSERVATION` | `DETECTED` / `POTENTIAL_DEFECT` / `OBSERVATION` |
| SEO rule | `DETECTED` |
| Performance (lab measurement) | `POTENTIAL_DEFECT` |
| Horizontal scroll, button or link without a name | `DETECTED` |
| Broken image, link, script, stylesheet or request, **confirmed by the re-check** | `DETECTED` |
| The same, from scans before re-checks existed | `POTENTIAL_DEFECT` |
| Console message from a third party, or a network echo | `OBSERVATION` |
| Other console messages and exceptions; other layout heuristics | `POTENTIAL_DEFECT` |

## 4. Milestone 0: foundations (complete)

### 4.1 Crawler extraction (no behaviour change)

The breadth-first crawl loop moved out of `runScan()` into
`apps/scanner/src/crawler/crawl.ts` as `crawlSite()`.

- **`crawlSite()` keeps only the bookkeeping:** queue, known addresses, depth,
  `maxPages`, the `3 × maxPages` bound, robots.txt, include/exclude patterns, the time
  limit and cancel checkpoints.
- **The per-page work is a `visit` callback.** `runScan` passes today's loop body
  unchanged; Mode 2 will pass a light "read the links" visitor.
- **Proof:**
  - 6 unit tests on a fake site: order, redirects, depth, patterns, robots, limits,
    cancel, bound;
  - all existing scanner tests;
  - a before/after Docker scan (section 4.6).

### 4.2 `capturePage()` / `analyzePage()`

`scanPage()` was split into two functions:
- **`capturePage()`** (`pipeline/capture-page.ts`) loads the page and collects facts:
  navigation, headers and cookie flags, the skip rules, axe, DOM checks, and resource
  re-checks.
- **`analyzePage()`** turns the facts into issue drafts, without a browser.

`scanPage()` still owns the collectors and screenshots and returns the same result.
Mode 2 will call `capturePage()` on both sites.

### 4.3 Database changes

Migration `20261103001300_phase9_m0_classification_review`. All changes are additive:

| Change | Purpose |
|---|---|
| Enum `FindingClassification`; `Issue.classification` (default `INCONCLUSIVE`, backfilled) | Evidence strength |
| Enum `ReviewStatus`; `TrackedIssue.reviewStatus`, `reviewedAt`, `reviewedById` | Team verdict, separate from the lifecycle |
| Table `IssueReview` (from/to status, from/to review, note, user, time) | Append-only decision history. A database trigger refuses edits; the only allowed change is clearing `userId` when a user is deleted. Rows go away only with their website (cascade). |
| `AiInsight.promptVersion` (existing rows `issue-explain/v1`) | Cached AI answers are reused only for the current prompt version |

A test runs the backfill SQL, taken straight from the migration file, against every
rule branch and requires the same result as `classifyDraft`.

On the development database, the backfill classified all 5,373 existing issues:
- 3,937 axe violations → `DETECTED`;
- 774 axe "needs review" → `INCONCLUSIVE`;
- older unverified resource failures → `POTENTIAL_DEFECT`.

### 4.4 API and UI

**API (backward compatible):**
- `PATCH /api/tracked-issues/:id` now also accepts `reviewStatus` and `note`. The
  original `{ status }` request still works.
  - Every change appends one `IssueReview` row, in the same transaction.
  - A false positive cannot also be confirmed or intentional: the API answers `409
    REVIEW_CONFLICT`.
- New `GET /api/tracked-issues/:id/reviews`: the history, for Viewers and up.
- Responses gain `classification` (issues) and `reviewStatus` (tracked issues).
- New filters: `?classification=` and `?reviewStatus=`.
- The issue timeline gains `REVIEWED` entries.

**UI:** the issue page shows a classification badge and a **Review** card containing:
- the evidence, explained in plain words;
- the team decision;
- Confirm defect / Intentional / Clear review, with an optional note;
- the decision history.

### 4.5 Fixture acceptance harness

- **Manifests (`tests/fixtures/manifests/*.json`)** list, per fixture page:
  - the seeded issues (rule, selector or resource, viewports, acceptable
    classification);
  - **negative controls** (look-alikes that must not be reported);
  - the **scored categories** (where the list is complete);
  - fixture-specific **forbidden tokens**.
- **`apps/scanner/test/harness/evaluate.ts`** computes recall and precision **per
  detector category**. Only `DETECTED` and `POTENTIAL_DEFECT` count as claims, and a
  weaker classification than expected counts as a miss.
- **`fixture-acceptance.test.ts`** scans every manifest's fixture with the real scanner
  and proxy. It requires 100% recall and zero false positives, and writes
  `.scanner-test-storage/fixture-acceptance.md`.
- **`harness.test.ts`** fails if detector code (`apps/scanner/src`,
  `packages/dom-checks/src`, `packages/shared/src`) contains a QA report ID, a fixture
  page title, or a manifest's forbidden token.

Milestone 0 results, on the 4 existing fixtures:

| Fixture | Category | Expected | Found | Recall | False positives | Precision |
|---|---|---|---|---|---|---|
| clean | UI health, responsive, accessibility | 0 | 0 | 100% | 0 | 100% |
| console (integration error, grouping, exceptions) | UI health | 5 | 5 | 100% | 0 | 100% |
| resources (broken files and links) | UI health | 6 | 6 | 100% | 0 | 100% |
| resources | Accessibility | 0 | 0 | 100% | 0 | 100% |
| ui (layout problems + look-alikes) | UI health | 5 | 5 | 100% | 0 | 100% |
| ui | Responsive (4 screen sizes) | 22 | 22 | 100% | 0 | 100% |
| ui | Accessibility | 2 | 2 | 100% | 0 | 100% |

The six generic fixture sites (e-commerce, SaaS dashboard, portfolio, news/blog, forms,
responsive landing page) and their corrected twins arrive with the detectors that need
them (Milestones 1–5).

### 4.6 Verification

- **`npm run check`:** types, lint and every suite pass (see the milestone report for
  counts).
- **Docker, before/after:**
  - The W3C BAD demo was scanned twice with the old images and once with the new ones
    (6 pages, depth 1, one responsive page).
  - The new run is **identical** to the first old run: same pages and order, the same
    22 rule groups and counts, the same scores and links.
  - The two old runs already differed from each other in the broken-link count (4 vs 1)
    because of network variance on w3.org.
- **Real browser against Docker:** the issue page shows the badge, the review workflow
  (confirm with a note, clear, mark intentional), three history rows in the database,
  plain-language timeline entries, no horizontal scrolling at 390 px, and no page
  errors.

![Issue page with the Review card](images/phase9-m0-1-issue-review-unreviewed.png)
![Review history](images/phase9-m0-2-issue-review-history.png)

## 5. Remaining milestones

| M | Scope |
|---|---|
| 1 | Mode 1: element inventory, safe explorer, interaction-state and navigation checks, `FUNCTIONAL` category |
| 2 | Mode 1: forms and validation probe, keyboard probe, page metrics, fonts and icons, consistency across pages |
| 3 | Mode 1: opt-in Firefox/WebKit compatibility |
| 4 | Mode 2: comparisons, routes, discovery and mapping, run job |
| 5 | Mode 2: element, visual, style and open-state differences |
| 6 | Scenarios (both modes), loading-state checks, QA case import and traceability |
| 7 | Comparison tracking, AI for both modes, QA-style reports and exports |
| 8 | Dashboards, hardening, Docker end to end, final documentation |

## 6. Known limitations (so far)

- Classification of older issues uses the data they stored. Older resource failures were
  not re-checked, so they are `POTENTIAL_DEFECT`, not `DETECTED`.
- The fixture harness matches DOM-check findings by exact selector. If a fixture's
  structure changes, its manifest must be updated.
- The issue page's History timeline reads the activity log. The Review card's decision
  history is the authoritative, append-only record.
