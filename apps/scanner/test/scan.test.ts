/**
 * End-to-end scanner tests: a REAL Chromium scans the fixture websites through a
 * REAL egress proxy, and results are saved in the test database.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '../src/pipeline/run-scan';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  createPublisher,
  createScanFor,
  createTestDeps,
  createTestPrisma,
  resetDatabase,
  startTestProxy,
  testScannerConfig,
} from './helpers';

let prisma: PrismaClient;
let publisher: Redis;
let fixtures: FixtureServer;
let proxy: Awaited<ReturnType<typeof startTestProxy>>;

beforeAll(async () => {
  prisma = createTestPrisma();
  publisher = createPublisher();
  fixtures = await startFixtureServer();
  proxy = await startTestProxy();
  // Every test creates its own user/project/website and filters by its own IDs,
  // so one reset at the start is enough.
  await resetDatabase(prisma);
});
afterAll(async () => {
  await fixtures.close();
  await proxy.close();
  await publisher.quit();
  await prisma.$disconnect();
});
function deps() {
  return createTestDeps(testScannerConfig(proxy.url), prisma, publisher);
}

async function scan(
  baseUrl: string,
  website: Parameters<typeof createScanFor>[2] = {},
  websiteId?: string,
) {
  const ids = await createScanFor(prisma, baseUrl, website, websiteId);
  const scanDeps = deps();
  const outcome = await runScan(ids.scanId, scanDeps, { signal: new AbortController().signal });
  return { ...ids, outcome, storageDir: scanDeps.storage.root };
}

describe('accessibility fixture (multi-page crawl)', () => {
  let result: Awaited<ReturnType<typeof scan>>;
  beforeAll(async () => {
    result = await scan(fixtures.url('/a11y/'), {
      maxPages: 10,
      maxDepth: 2,
      responsivePageLimit: 1,
    });
  });

  it('finds real accessibility violations with WCAG references and fixes', async () => {
    const issues = await prisma.issue.findMany({
      where: { scanId: result.scanId, category: 'ACCESSIBILITY' },
      include: { accessibility: true },
    });
    const rules = new Set(issues.map((i) => i.ruleId));
    for (const rule of [
      'image-alt',
      'button-name',
      'label',
      'color-contrast',
      'html-has-lang',
      'link-name',
      'aria-valid-attr-value',
      'duplicate-id-aria',
      'heading-order',
    ]) {
      expect(rules, `expected axe rule ${rule}`).toContain(rule);
    }
    // The page has two images without alt; check the 120×80 photo.
    const imageAlt = issues.find(
      (i) => i.ruleId === 'image-alt' && i.htmlSnippet?.includes('width="120"'),
    )!;
    expect(imageAlt).toMatchObject({ severity: 'CRITICAL', pageUrl: fixtures.url('/a11y/') });
    expect(imageAlt.selector).toBeTruthy();
    expect(imageAlt.htmlSnippet).toContain('<img');
    expect(imageAlt.suggestedFix).toContain('Guidance:');
    expect(imageAlt.accessibility).toMatchObject({
      wcagCriteria: ['1.1.1'],
      wcagLevel: 'A',
      detection: 'AUTOMATED',
    });
    expect(imageAlt.boundingBox).toMatchObject({ width: 120, height: 80 });
  });

  it('crawls each page once (fragments, query order and redirects do not duplicate pages)', async () => {
    const pages = await prisma.scanPage.findMany({ where: { scanId: result.scanId } });
    const done = pages
      .filter((p) => p.status === 'DONE')
      .map((p) => new URL(p.url).pathname + new URL(p.url).search);
    expect(done.filter((p) => p === '/a11y/page2.html')).toHaveLength(1);
    expect(done.filter((p) => p === '/a11y/page2.html?a=1&b=2')).toHaveLength(1);
    expect(pages.some((p) => p.normalizedUrl.includes('#'))).toBe(false);
    const viaRedirect = pages.find((p) => p.normalizedUrl.endsWith('/redirect'));
    expect(viaRedirect).toMatchObject({ status: 'SKIPPED' });
    expect(viaRedirect?.errorMessage).toMatch(/already scanned/);
    // robots.txt "Disallow: /private/" and the PDF are respected
    expect(pages.some((p) => p.normalizedUrl.includes('/private/'))).toBe(false);
    expect(pages.some((p) => p.normalizedUrl.endsWith('.pdf'))).toBe(false);
  });

  it('records page data: status codes, titles, load time, console and network errors', async () => {
    const page2 = await prisma.scanPage.findFirstOrThrow({
      where: { scanId: result.scanId, normalizedUrl: fixtures.url('/a11y/page2.html') },
    });
    expect(page2).toMatchObject({
      status: 'DONE',
      httpStatus: 200,
      title: 'Fixture page 2',
      language: 'en',
    });
    expect(page2.loadTimeMs).toBeGreaterThan(0);
    const missing = await prisma.scanPage.findFirstOrThrow({
      where: { scanId: result.scanId, normalizedUrl: fixtures.url('/missing-page.html') },
    });
    expect(missing).toMatchObject({ status: 'SKIPPED', httpStatus: 404 });
  });

  it('finds UI health problems: missing CSS/JS/images, console and JS errors, broken links', async () => {
    const ui = await prisma.issue.findMany({
      where: { scanId: result.scanId, category: 'UI_HEALTH' },
      include: { uiHealth: true },
    });
    const checks = new Set(ui.map((i) => i.uiHealth?.checkType));
    for (const check of [
      'FAILED_STYLESHEET',
      'FAILED_SCRIPT',
      'BROKEN_IMAGE',
      'CONSOLE_ERROR',
      'JS_ERROR',
      'BROKEN_LINK',
    ]) {
      expect(checks, `expected ${check}`).toContain(check);
    }
    const brokenLinks = ui
      .filter((i) => i.uiHealth?.checkType === 'BROKEN_LINK')
      .map((i) => i.uiHealth?.resourceUrl);
    expect(brokenLinks).toContain(fixtures.url('/missing-page.html'));
    expect(brokenLinks).toContain('http://no-such-host.invalid/');
    // The console error Chrome logs for each failed file is not double-counted:
    expect(ui.filter((i) => i.description.startsWith('Failed to load resource'))).toHaveLength(0);
  });

  it('never reaches internal addresses (links, redirects) and records the block', async () => {
    expect(fixtures.secretHits()).toBe(0);
    const blocked = await prisma.scanPage.findFirstOrThrow({
      where: { scanId: result.scanId, normalizedUrl: fixtures.url('/redirect-to-secret') },
    });
    expect(blocked.status).toBe('FAILED');
    expect(blocked.errorMessage).toMatch(/security proxy|private|internal/i);
    const issues = await prisma.issue.findMany({ where: { scanId: result.scanId } });
    expect(issues.some((i) => i.description.includes('/secret'))).toBe(false); // not reported as a "broken link"
  });

  it('saves screenshots: full pages, 4 extra screen sizes and highlighted issues', async () => {
    const shots = await prisma.screenshot.findMany({ where: { scanId: result.scanId } });
    expect(shots.filter((s) => s.kind === 'PAGE_FULL').length).toBeGreaterThanOrEqual(2);
    expect(new Set(shots.filter((s) => s.kind === 'VIEWPORT').map((s) => s.viewport))).toEqual(
      new Set(['1366x768', '768x1024', '390x844', '320x568']),
    );
    expect(shots.filter((s) => s.kind === 'ISSUE_CROP').length).toBeGreaterThan(0);
    for (const shot of shots)
      expect(existsSync(path.join(result.storageDir, shot.storageKey))).toBe(true);
    const cropped = await prisma.issue.count({
      where: { scanId: result.scanId, screenshotId: { not: null } },
    });
    expect(cropped).toBeGreaterThan(0);
  });

  it('finishes with real counts, scores, timing and tracked issue identities', async () => {
    expect(result.outcome).toBe('PARTIAL'); // one page was blocked by the security proxy
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: result.scanId } });
    const issueCount = await prisma.issue.count({ where: { scanId: result.scanId } });
    expect(row).toMatchObject({ status: 'PARTIAL', progress: 100, totalIssues: issueCount });
    expect(row.accessibilityScore).toBeLessThan(100);
    expect(row.durationMs).toBeGreaterThan(0);
    expect(row.finishedAt).not.toBeNull();
    expect(row.criticalCount + row.highCount + row.mediumCount + row.lowCount + row.infoCount).toBe(
      issueCount,
    );

    const unlinked = await prisma.issue.count({
      where: { scanId: result.scanId, trackedIssueId: null },
    });
    expect(unlinked).toBe(0);
    expect(await prisma.trackedIssue.count({ where: { websiteId: result.websiteId } })).toBe(
      issueCount,
    );
  });
});

describe('UI fixture (layout and screen sizes)', () => {
  it('detects overflow, clipping and covered controls, without the look-alike false positives', async () => {
    const result = await scan(fixtures.url('/ui/'), { maxPages: 1, responsivePageLimit: 1 });
    const issues = await prisma.issue.findMany({
      where: { scanId: result.scanId },
      include: { uiHealth: true },
    });
    const desktop = issues.filter((i) => i.category === 'UI_HEALTH');
    const checks = (list: typeof issues) => new Set(list.map((i) => i.uiHealth?.checkType));

    for (const check of [
      'HORIZONTAL_SCROLL',
      'CONTENT_OVERFLOW',
      'TEXT_CLIPPING',
      'OVERLAPPING_ELEMENTS',
      'IMAGE_SIZING',
    ]) {
      expect(checks(desktop), `expected ${check}`).toContain(check);
    }
    const snippets = desktop.map((i) => i.htmlSnippet ?? '').join('\n');
    expect(snippets).toContain('class="clip"');
    expect(snippets).not.toContain('class="ellipsis"'); // intentional ellipsis is not a bug
    expect(snippets).not.toContain('sr-only'); // screen-reader-only text is not "off screen"
    expect(snippets).not.toContain('Slide one'); // inside a scrollable carousel
    // The empty button is reported once (by axe), not twice:
    expect(issues.some((i) => i.ruleId === 'button-name')).toBe(true);
    expect(checks(desktop)).not.toContain('EMPTY_BUTTON');
  });

  it('reports small-screen problems only at the screen sizes where they happen', async () => {
    const result = await scan(fixtures.url('/ui/'), { maxPages: 1, responsivePageLimit: 1 });
    const responsive = await prisma.issue.findMany({
      where: { scanId: result.scanId, category: 'RESPONSIVE' },
    });
    const tabletWide = (viewport: string) =>
      responsive.some(
        (i) => i.viewport === viewport && (i.htmlSnippet ?? '').includes('tablet-wide'),
      );
    expect(tabletWide('390x844')).toBe(true);
    expect(tabletWide('320x568')).toBe(true);
    expect(tabletWide('768x1024')).toBe(false);
    const desktop = await prisma.issue.findMany({
      where: { scanId: result.scanId, category: 'UI_HEALTH' },
    });
    expect(desktop.some((i) => (i.htmlSnippet ?? '').includes('tablet-wide'))).toBe(false);
  });
});

describe('clean fixture', () => {
  it('reports no automated accessibility violations', async () => {
    const result = await scan(fixtures.url('/clean/'), { maxPages: 1, responsivePageLimit: 0 });
    expect(result.outcome).toBe('COMPLETED');
    const violations = await prisma.issue.findMany({
      where: {
        scanId: result.scanId,
        category: 'ACCESSIBILITY',
        accessibility: { detection: 'AUTOMATED' },
      },
    });
    expect(violations.map((v) => v.ruleId)).toEqual([]);
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: result.scanId } });
    expect(row.accessibilityScore).toBe(100);
  });
});

describe('SEO fixture', () => {
  it('finds on-page and cross-page SEO problems, reads robots.txt and the sitemap', async () => {
    const result = await scan(fixtures.url('/seo/'), { maxPages: 3, responsivePageLimit: 0 });
    expect(result.outcome).toBe('COMPLETED');
    const issues = await prisma.issue.findMany({
      where: { scanId: result.scanId, category: 'SEO' },
      include: { seo: true },
    });
    const byPage = (suffix: string) =>
      issues
        .filter((i) => i.pageUrl?.endsWith(suffix))
        .map((i) => i.seo!.checkType)
        .sort();

    // The well-formed home page has no SEO issues.
    expect(byPage('/seo/')).toEqual([]);
    // Both duplicate pages: same title, noindex, no h1, skipped level, foreign canonical, no description/OG, image without alt.
    const expected = [
      'DUPLICATE_TITLE',
      'INVALID_CANONICAL',
      'MISSING_H1',
      'MISSING_IMAGE_ALT',
      'MISSING_META_DESCRIPTION',
      'MISSING_OPEN_GRAPH',
      'NOINDEX',
      'SKIPPED_HEADING_LEVEL',
    ];
    expect(byPage('/seo/dup-a.html')).toEqual(expected);
    expect(byPage('/seo/dup-b.html')).toEqual(expected);
    expect(issues.every((i) => i.suggestedFix && i.seo)).toBe(true);

    // robots.txt exists and lists a valid sitemap: no site-level issues, facts stored.
    expect(issues.filter((i) => i.scanPageId === null)).toEqual([]);
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: result.scanId } });
    expect(row.siteChecks).toMatchObject({
      seo: {
        robotsTxt: { status: 200, found: true, blocksAll: false },
        sitemap: { status: 200, found: true, validXml: true, source: 'robots.txt' },
      },
    });
    expect(row.seoScore).toBeGreaterThan(0);
    expect(row.seoScore).toBeLessThan(100);
    const page = await prisma.scanPage.findFirstOrThrow({
      where: { scanId: result.scanId, url: { endsWith: '/seo/dup-a.html' } },
    });
    expect(page.seoData).toMatchObject({ metaRobots: 'noindex', imagesWithoutAlt: 1 });
  });
});

describe('security fixture (passive configuration audit)', () => {
  it('reports header, cookie, version and HTTPS findings with levels, and never stores cookie values', async () => {
    const result = await scan(fixtures.url('/security/'), { maxPages: 1, responsivePageLimit: 0 });
    expect(result.outcome).toBe('COMPLETED');
    const issues = await prisma.issue.findMany({
      where: { scanId: result.scanId, category: 'SECURITY' },
      include: { security: true },
    });
    const found = issues.map((i) => `${i.security!.checkType}:${i.security!.findingLevel}`).sort();
    expect(found).toEqual([
      'INSECURE_COOKIE:OBSERVATION', // session: no HttpOnly / SameSite (site is http, so Secure is not asked)
      'INSECURE_COOKIE:OBSERVATION', // theme: no HttpOnly
      'MISSING_CSP:WARNING',
      'MISSING_FRAME_PROTECTION:WARNING',
      'MISSING_REFERRER_POLICY:OBSERVATION',
      'MISSING_X_CONTENT_TYPE_OPTIONS:WARNING',
      // The fixture is plain http and nothing answers https on the fixture host.
      'NO_HTTPS:CONFIRMED',
      'VERSION_DISCLOSURE:OBSERVATION',
    ]);
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: result.scanId } });
    // 100 - CSP 15 - frame 10 - nosniff 5 - cookie 5 - referrer 3 - version 2 - no https 40
    expect(row.securityScore).toBe(20);
    expect(row.siteChecks).toMatchObject({
      security: { servedOverHttps: false, tls: { checked: false }, httpRedirect: null },
    });

    // The cookie VALUE appears nowhere: not in issues, page headers or site checks.
    const pages = await prisma.scanPage.findMany({ where: { scanId: result.scanId } });
    const everything = JSON.stringify({ issues, pages, row });
    expect(everything).not.toContain('SECRET-SESSION-VALUE-123');
    expect(everything).toContain('"session"');
    expect(pages[0]!.responseHeaders).not.toHaveProperty('set-cookie');
  });
});

describe('performance fixture (real Lighthouse through the egress proxy)', () => {
  it('stores Lighthouse scores, metrics, the raw report and performance issues', async () => {
    const ids = await createScanFor(prisma, fixtures.url('/perf/'), {
      maxPages: 1,
      responsivePageLimit: 0,
    });
    const scanDeps = createTestDeps(
      testScannerConfig(proxy.url, { lighthouseEnabled: true }),
      prisma,
      publisher,
    );
    const outcome = await runScan(ids.scanId, scanDeps, { signal: new AbortController().signal });
    expect(outcome).toBe('COMPLETED');

    const results = await prisma.performanceResult.findMany({ where: { scanId: ids.scanId } });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.formFactor).toBe('MOBILE');
    for (const value of [
      r.performanceScore,
      r.accessibilityScore,
      r.bestPracticesScore,
      r.seoScore,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(r.lcpMs).toBeGreaterThan(0);
    expect(r.fcpMs).toBeGreaterThan(0);
    expect(r.cls).not.toBeNull();
    expect(r.inpMs).toBeNull();
    expect(r.lighthouseVersion).toBe('13.5.0');
    // The render-blocking script is found (as a Lighthouse 13 insight).
    const opportunities = r.opportunities as { id: string }[];
    expect(opportunities.map((o) => o.id)).toContain('render-blocking-insight');
    // Raw JSON is stored for download, without the embedded screenshots.
    const raw = JSON.parse(
      readFileSync(path.join(scanDeps.storage.root, r.rawReportKey!), 'utf8'),
    ) as { audits: Record<string, unknown>; lighthouseVersion: string };
    expect(raw.lighthouseVersion).toBe('13.5.0');
    expect(raw.audits['final-screenshot']).toBeUndefined();

    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } });
    expect(scan.performanceScore).toBe(r.performanceScore);
    const perfIssues = await prisma.issue.findMany({
      where: { scanId: ids.scanId, category: 'PERFORMANCE' },
    });
    expect(perfIssues.map((i) => i.ruleId)).toContain('perf/render-blocking-insight');
  }, 180_000);
});

describe('visual regression (real browser snapshots)', () => {
  it('captures PNG snapshots, compares only against an explicit baseline and never replaces it', async () => {
    fixtures.setVisualChanged(false);
    // One config (one storage folder) for all three scans, like a real deployment.
    const visualConfig = testScannerConfig(proxy.url, { visualPages: 1 });
    const visualDeps = () => createTestDeps(visualConfig, prisma, publisher);
    const run = async (websiteId?: string) => {
      const ids = await createScanFor(
        prisma,
        fixtures.url('/visual/'),
        { maxPages: 1, responsivePageLimit: 0 },
        websiteId,
      );
      const scanDeps = visualDeps();
      const outcome = await runScan(ids.scanId, scanDeps, { signal: new AbortController().signal });
      return { ...ids, outcome, storage: scanDeps.storage };
    };

    // 1) First scan: snapshots for desktop and mobile, no baseline yet so no comparison.
    const first = await run();
    expect(first.outcome).toBe('COMPLETED');
    const shots = await prisma.screenshot.findMany({
      where: { scanId: first.scanId, kind: 'VISUAL_CURRENT' },
      orderBy: { viewport: 'asc' },
    });
    expect(shots.map((s) => [s.viewport, s.mimeType])).toEqual([
      ['1920x1080', 'image/png'],
      ['390x844', 'image/png'],
    ]);
    expect(await prisma.visualComparison.count({ where: { scanId: first.scanId } })).toBe(0);

    // 2) The user explicitly makes the desktop snapshot the baseline (what the API does):
    //    a copy of the file, owned by the website, ignoring the changing clock text.
    const desktopShot = shots[0]!;
    const baselineKey = `baselines/${first.websiteId}/test-desktop.png`;
    await first.storage.put(
      baselineKey,
      readFileSync(path.join(first.storage.root, desktopShot.storageKey)),
    );
    const baselineShot = await prisma.screenshot.create({
      data: {
        kind: 'BASELINE',
        viewport: '1920x1080',
        width: desktopShot.width,
        height: desktopShot.height,
        storageKey: baselineKey,
        mimeType: 'image/png',
        sizeBytes: desktopShot.sizeBytes,
      },
    });
    const page = await prisma.scanPage.findFirstOrThrow({ where: { scanId: first.scanId } });
    const baseline = await prisma.visualBaseline.create({
      data: {
        websiteId: first.websiteId,
        pageUrl: page.normalizedUrl,
        viewport: '1920x1080',
        screenshotId: baselineShot.id,
        ignoreRegions: [{ selector: '.clock' }],
      },
    });

    // 3) Rescan, nothing changed: not CHANGED (the clock is masked).
    const second = await run(first.websiteId);
    const same = await prisma.visualComparison.findFirstOrThrow({
      where: { scanId: second.scanId },
    });
    expect(['UNCHANGED', 'MINOR']).toContain(same.status);
    expect(same.passed).toBe(true);
    expect(same.diffPercent).toBeLessThan(0.5);

    // 4) A real change (a big banner): CHANGED, with a region and a diff image.
    fixtures.setVisualChanged(true);
    const third = await run(first.websiteId);
    const changed = await prisma.visualComparison.findFirstOrThrow({
      where: { scanId: third.scanId },
      include: { diffScreenshot: true },
    });
    expect(changed.status).toBe('CHANGED');
    expect(changed.passed).toBe(false);
    expect(changed.diffPercent).toBeGreaterThan(0.5);
    const details = changed.details as { regions: { y: number; height: number }[] };
    expect(details.regions.length).toBeGreaterThan(0);
    expect(details.regions[0]!.y).toBeLessThan(400); // the banner sits under the 300px hero
    expect(changed.diffScreenshot?.kind).toBe('VISUAL_DIFF');
    expect(existsSync(path.join(third.storage.root, changed.diffScreenshot!.storageKey))).toBe(
      true,
    );

    // 5) The baseline itself never changed: same screenshot, same file.
    const after = await prisma.visualBaseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(after.screenshotId).toBe(baselineShot.id);
    expect(after.updatedAt.getTime()).toBe(baseline.updatedAt.getTime());
    fixtures.setVisualChanged(false);
  }, 180_000);
});

describe('issue identity across scans (rescan)', () => {
  it('keeps one tracked identity per problem: recurring, resolved and no duplicates', async () => {
    fixtures.setToggleFixed(false);
    const first = await scan(fixtures.url('/toggle/'), { maxPages: 1, responsivePageLimit: 0 });
    fixtures.setToggleFixed(true); // the developer adds the missing alt text
    const second = await scan(fixtures.url('/toggle/'), {}, first.websiteId);
    fixtures.setToggleFixed(false);

    const tracked = await prisma.trackedIssue.findMany({ where: { websiteId: first.websiteId } });
    const byRule = (rule: string) => tracked.filter((t) => t.ruleId === rule);
    expect(byRule('image-alt')).toHaveLength(1);
    expect(byRule('image-alt')[0]).toMatchObject({
      status: 'RESOLVED',
      resolvedInScanId: second.scanId,
    });
    expect(byRule('button-name')).toHaveLength(1);
    expect(byRule('button-name')[0]).toMatchObject({
      status: 'OPEN',
      occurrenceCount: 2,
      lastSeenScanId: second.scanId,
    });

    // Each scan keeps its own issue rows; within one scan a fingerprint appears once.
    const secondIssues = await prisma.issue.findMany({ where: { scanId: second.scanId } });
    expect(new Set(secondIssues.map((i) => i.fingerprint)).size).toBe(secondIssues.length);
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: second.scanId } });
    expect(row.previousScanId).toBe(first.scanId);
  });
});

describe('failures and cancellation', () => {
  it('fails cleanly (no retry, friendly message) when the site cannot be reached', async () => {
    const result = await scan('http://no-such-host.invalid/', {
      maxPages: 1,
      responsivePageLimit: 0,
    });
    expect(result.outcome).toBe('FAILED');
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: result.scanId } });
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toMatch(/could not|does not exist|unreachable/i);
    expect(row.errorMessage).not.toMatch(/ERR_|stack|at /); // no internal details
  });

  it('refuses a start URL on a private address (SSRF), even when it is the website itself', async () => {
    const result = await scan(`http://127.0.0.1:${fixtures.port}/secret`, {
      maxPages: 1,
      responsivePageLimit: 0,
    });
    expect(result.outcome).toBe('FAILED');
    expect(fixtures.secretHits()).toBe(0);
  });

  it('cancels a running scan: the browser stops and the scan is marked CANCELLED', async () => {
    const ids = await createScanFor(prisma, fixtures.url('/slow/'), {
      maxPages: 1,
      responsivePageLimit: 0,
    });
    const controller = new AbortController();
    const started = Date.now();
    const running = runScan(ids.scanId, deps(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 2_000);
    const outcome = await running;

    expect(outcome).toBe('CANCELLED');
    expect(Date.now() - started).toBeLessThan(15_000); // did not wait for the 20 s page
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } });
    expect(row).toMatchObject({ status: 'CANCELLED' });
    expect(row.finishedAt).not.toBeNull();
  });
});
