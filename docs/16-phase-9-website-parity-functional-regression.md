# Phase 9: Website Health Scan and Website Comparison

Status: **in progress.**
- Milestone 0 (foundations) is complete.
- Milestone 1 (generic interaction explorer) is complete (section 5).
- Milestones 2 to 8 are planned (see section 6).
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

## 5. Milestone 1: the safe interaction explorer (complete)

This milestone adds a new stage to every health scan (Mode 1). On the first pages of a site, the explorer:

- opens menus, tabs and expandable sections;
- checks what opening them reveals.

It works on any website. Its rules use HTML and ARIA semantics plus a small "expand"
vocabulary. They contain no logic specific to a site, a page or a text.

### 5.1 What it explores and what it never touches

`packages/dom-checks/src/explore-rules.ts` decides, for each element, whether to explore it. The module is pure and unit-tested.

| Explored | Why |
|---|---|
| Buttons with `aria-haspopup` (menu, listbox, tree, grid) | open a menu |
| Buttons with `aria-expanded="false"` | accordions, disclosures |
| Buttons whose `aria-controls` points to a hidden region | disclosures |
| `<summary>` of a closed `<details>` | expandable sections |
| Unselected `role="tab"` | tabs |
| Buttons named "Show more", "See all", "More", "Menu", "Filters", "Options", "Details" or "Expand" | expand wording |

The explorer never uses the controls below. Each one is recorded in the report with the reason it was skipped.

- **Controls whose name suggests a change of data.** The vocabulary is deliberately broad. It includes:
  - delete, remove;
  - purchase, buy, pay, checkout, order;
  - send, submit, sign, create, save, publish, post;
  - confirm, approve, cancel;
  - log out, reset, clear, apply;
  - add, upload, download, export, import;
  - share, invite, edit, update, enable, disable;
  - start, run, refresh, reload;
  - and more (`STATE_CHANGING_WORDS`).
- **Submit buttons.** This includes a `<button>` without a type inside a form, and `<input type="submit">`.
- **Links that navigate.** The crawler follows links using GET only, as in every scan.
- **Other excluded controls:**
  - dialog triggers (`aria-haspopup="dialog"`);
  - native form fields;
  - disabled, hidden or already-open controls;
  - controls whose action is unknown.
- **Controls beyond the limit.** The default is **5 pages × 30 controls**, set per website. The scanner caps it with `SCAN_MAX_EXPLORATION_PAGES` (at most 10) and `SCAN_MAX_EXPLORATION_CONTROLS` (at most 50).

### 5.2 Safety layer

The explorer uses its **own browser context**, never the scan's. That context goes through the same egress proxy, so SSRF protection is unchanged. Once the page has loaded normally, the safety layer is armed:

- **No writes.** Every request that is not GET, HEAD or OPTIONS is aborted. This covers forms, `fetch` POSTs and beacons.
- **GET is not assumed to be safe.** Only the resources a page needs to render can load: stylesheets, scripts, images, fonts and media. These are aborted, including those to the same site:
  - data requests (fetch/XHR);
  - event streams;
  - downloads.
- **No navigation.** Every page navigation is aborted. The only exception is the explorer's own reload of the same page.
- **No other channels.**
  - WebSockets never reach a server.
  - Pop-ups are closed.
  - Dialogs are dismissed ("Cancel").
- **Guards inside the page.** Chromium's download manager fetches files outside request routing, so the page itself also prevents:
  - form submission and `form.submit()`;
  - link clicks triggered by script (`a.click()`);
  - clicks on `<a download>` links.
- **Everything blocked is recorded** and shown in the report.
- **Downgrade rule.** If anything was blocked during an interaction, findings from that interaction are downgraded to **inconclusive**, because the page may behave differently for real users.

**How safety was verified.** On the fixture pages, destructive actions point to `/trap/*`:

- a POST;
- a navigation;
- a beacon;
- a fetch to another site;
- a pop-up;
- a download;
- a WebSocket.

The fixture server counts every non-GET request, every `/trap/*` request and every WebSocket upgrade. After every fixture scan, all three counts must be **zero**, and they are.

During development, one gap was found and fixed:

- **Problem:** a download link triggered by script reached the server, because downloads bypass Playwright's request routing.
- **Fix:** the in-page guard now stops the download before any request starts.

### 5.3 Checks

The checks use a new category, `FUNCTIONAL`, shown as "Interactions" in the UI.

| Check | How it is decided | Classification |
|---|---|---|
| Control does nothing | One of two cases. (1) After 2 attempts there is no new visible content, no state change and no real DOM change. (2) `aria-expanded` becomes `"true"` but nothing is shown. | Potential defect |
| Opened menu or panel is cut off | At least 5% of the opened layer (and at least 64 px²) is hidden. It may be hidden by a container with `overflow: hidden`, or by the edge of the window. The window counts horizontally, and vertically only for fixed layers. | Potential defect |
| Items covered | An item of the opened layer is covered at its centre by an element outside the layer. Parts already reported as cut off are not checked again. | Potential defect |
| Large empty area | The opened layer is at least 150 px tall and has an empty band of at least max(80 px, 40% of its height). | Observation |
| Menu cannot be closed | The menu stays open after all three attempts: pressing Escape, clicking outside it (on a point with nothing interactive) and clicking its control again. | Potential defect |
| Escape does not close a menu | The menu does close another way. | Observation |
| Tab panel not shown | The tab becomes selected, but the panel named by its `aria-controls` stays hidden. | Potential defect |
| Error while interacting | An uncaught exception happens during the interaction. It is classified like console errors: an error from a third party is an Observation. | Potential defect or Observation |
| Link to a missing section | A same-page `#fragment` has no matching id or name. `#`, `#top`, `#/…` and `#!…` count as valid. | Detected |
| Wrong current page in navigation | A navigation item is marked current (`aria-current`, or an active, current or selected class) but points elsewhere, while another item points to this page. Section prefixes are allowed. | Potential defect |
| Accessibility in opened states | axe runs on each opened layer. Only problems that are not already on the page are reported. | Detected (category Accessibility) |

**Evidence stored with every finding:**

- the control: name, role and selector;
- the steps the explorer actually performed up to that finding;
- measurements: the share cut off, the covered items, the empty band;
- any blocked actions;
- a highlighted screenshot of the opened state.

Bug reports use only these recorded steps.

### 5.4 Compatibility with existing results

**Scores.** Existing categories and **scores are unchanged**. Accessibility problems found only inside opened menus are listed, but they are excluded from the accessibility score. `totalIssues` and the severity counts now include interaction findings.

**Tracking.** An interaction finding is marked resolved only on a page that was explored again. Switching the explorer off, or lowering its page limit, never resolves one.

**Docker before and after** (W3C BAD demo, the same settings as in Milestone 0):

- Pages, crawl order, the 22 rule groups, counts, scores and links are all identical.
- The explorer ran on the first 5 pages. The 6th page was beyond the limit.
- It found no eligible controls, because the demo is a static site with no ARIA menus, tabs or disclosures. So there were zero findings.
- The scan took about 9 s longer (40 s → 49 s).

**API.** All changes are additive.

- New endpoint: `GET /api/reports/:scanId/functional`.
- Websites gain `explorationEnabled`, `explorationPageLimit` and `explorationControlLimit`. They are optional on input and default to true, 5 and 30.
- Issues gain `functional` details.
- The category filters and exports accept `FUNCTIONAL`.

**Existing websites.** They are explored by default from their next scan. The explorer can be switched off in each website's settings.

**Database.** The migration `20261103033735_phase9_m1_explorer` is additive:

- enum value `IssueCategory.FUNCTIONAL`;
- enum `FunctionalCheckType`;
- table `FunctionalIssue`;
- column `ScanPage.exploration`;
- three `Website` columns.

### 5.5 Fixtures and results

Three generic sites were added. Each has a **corrected twin**, served from the same file at `<site>/fixed.html`, so a twin cannot drift from its seeded page.

| Site | Seeded problems | Negative controls |
|---|---|---|
| `saas` (dashboard) | Wrong current navigation item; 3 header menus cut off by `overflow: hidden`; a menu that cannot be closed; a menu without Escape; a tab whose panel stays hidden; a control that does nothing; an error while opening a section; an unnamed button visible only in an opened menu | Help menu that overlaps the page on purpose; working tab; `<details>`; "Show more"; two controls whose tracking calls are blocked |
| `shop` (e-commerce) | Filter options under a sticky promotion bar; a sort list with a large empty area; a link to a missing section | Colour panel that overlaps the product grid on purpose; mini cart; `<details>`; "Back to top" (`#top`); a valid section link |
| `portfolio` | A link to a missing section; "Read more" that says it expanded but shows nothing; a filter panel past the edge of the window | Menu toggle; "Show more projects"; `<details>`; skip link |

**Fixture acceptance** (`fixture-acceptance.test.ts`: 30 tests over 10 fixture pages). The 10 pages are the 3 new sites, their 3 twins and the 4 earlier fixtures.

| Category | Fixture pages scored | Expected | Found | Recall | False positives |
|---|---|---|---|---|---|
| FUNCTIONAL | 10 | 15 | 15 | 100% | 0 |
| ACCESSIBILITY | 9 | 3 | 3 | 100% | 0 |
| UI_HEALTH | 10 | 16 | 16 | 100% | 0 |
| RESPONSIVE | 2 | 6 | 6 | 100% | 0 |

The server-side safety counters were 0 after all 10 scans.

These targets apply to these deterministic fixtures only, not to arbitrary websites.

### 5.6 Screenshots

**How the demo was produced.** The scanner in this repository scanned the local SaaS fixture:

- the results were stored in the development database;
- the Docker dashboard displayed them.

No third-party site was scanned.

![Interactions report](images/phase9-m1-1-interactions-report.png)
![A cut-off menu, with the recorded steps and the opened-state screenshot](images/phase9-m1-2-issue-clipped-menu.png)
![Explorer settings of a website](images/phase9-m1-3-website-explorer-settings.png)

### 5.7 Limitations

- **Semantics-based.**
  - Custom widgets with neither ARIA nor the expand wording are not opened. Milestone 6 scenarios are meant for them.
  - Menus that open only on hover are explored only if a click also opens them.
- **English action vocabulary.** On sites in other languages:
  - controls that change data are still skipped, as long as they have no disclosure semantics (they almost never do);
  - the skipped list then gives their reason as "unknown action".
- **Blocked requests.** A menu that loads its items with fetch/XHR shows up empty. Its findings are marked **inconclusive**, not claimed.
- **Scope of this milestone.**
  - Desktop viewport only (1920×1080).
  - Dialogs are not opened.
- **Heuristic thresholds.** The thresholds (5% cut off, an 80 px empty band) were tuned to avoid false positives, so subtler problems can be missed.
- **Run time.** About 1 s per control, and more when the page has to be restored. On the W3C BAD demo, which has no eligible controls, the scan took about 9 s longer.

## 6. Remaining milestones

| M | Scope |
|---|---|
| 2 | Mode 1: forms and validation probe, keyboard probe, page metrics, fonts and icons, consistency across pages |
| 3 | Mode 1: opt-in Firefox/WebKit compatibility |
| 4 | Mode 2: comparisons, routes, discovery and mapping, run job |
| 5 | Mode 2: element, visual, style and open-state differences |
| 6 | Scenarios (both modes), loading-state checks, QA case import and traceability |
| 7 | Comparison tracking, AI for both modes, QA-style reports and exports |
| 8 | Dashboards, hardening, Docker end to end, final documentation |

## 7. Known limitations (so far)

- Classification of older issues uses the data they stored. Older resource failures were
  not re-checked, so they are `POTENTIAL_DEFECT`, not `DETECTED`.
- The fixture harness matches DOM-check findings by exact selector. If a fixture's
  structure changes, its manifest must be updated.
- The issue page's History timeline reads the activity log. The Review card's decision
  history is the authoritative, append-only record.
