/**
 * Phase 9, Milestone 3 (Checkpoint 2): the comparison with Chromium inside a real scan.
 * Chromium stands in for the other engines (no Firefox/WebKit needed): unchanged, it must
 * produce no differences at all; with the APIs removed that Firefox and WebKit really lack
 * in the pinned builds (an init script), the compat fixture's feature-detected code runs
 * and its seeded differences must be found, confirmed, saved as COMPATIBILITY issues and
 * tracked. Real engines: fixture-acceptance (compat manifests) in the Docker test image.
 */
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import type { Browser, BrowserContextOptions } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchScanBrowser } from '../src/browser';
import type { BrowserPageSummary, CompatOptions } from '../src/pipeline/compat-stage';
import { runScan, type ScanDeps } from '../src/pipeline/run-scan';
import { startFixtureServer, THIRD_PARTY_HOST, type FixtureServer } from './fixture-server';
import {
  createPublisher,
  createScanFor,
  createTestDeps,
  createTestPrisma,
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
  proxy = await startTestProxy([THIRD_PARTY_HOST]);
});
afterAll(async () => {
  await fixtures.close();
  await proxy.close();
  await publisher.quit();
  await prisma.$disconnect();
});

const ONE_PAGE = {
  maxPages: 1,
  maxDepth: 0,
  responsivePageLimit: 0,
  explorationEnabled: false,
  keyboardProbeEnabled: false,
  formProbeMode: 'OFF' as const,
};
const ON = { ...ONE_PAGE, crossBrowserEnabled: true };

/** What each pinned engine lacks (the compat fixture detects these features). */
const MISSING = {
  firefox: 'delete Element.prototype.scrollIntoViewIfNeeded;',
  webkit: 'delete window.requestIdleCallback;',
};

/** Chromium through the egress proxy, optionally without the other engine's missing APIs. */
const standIn =
  (simulate: boolean): CompatOptions['launch'] =>
  async (engine) => {
    const browser = await launchScanBrowser({
      ...testScannerConfig(proxy.url),
      egressProxyUrl: proxy.url,
    });
    if (!simulate) return browser;
    const newContext = browser.newContext.bind(browser);
    (browser as { newContext: Browser['newContext'] }).newContext = async (
      options?: BrowserContextOptions,
    ) => {
      const context = await newContext(options);
      await context.addInitScript(MISSING[engine]);
      return context;
    };
    return browser;
  };

async function scan(
  path: string,
  website: Parameters<typeof createScanFor>[2],
  compat?: CompatOptions,
  websiteId?: string,
) {
  fixtures.resetSafetyHits();
  const ids = await createScanFor(prisma, fixtures.url(path), website, websiteId);
  const deps: ScanDeps = {
    ...createTestDeps(testScannerConfig(proxy.url), prisma, publisher),
    compat,
  };
  const outcome = await runScan(ids.scanId, deps, { signal: new AbortController().signal });
  const [row, runs, pages, issues] = await Promise.all([
    prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } }),
    prisma.scanBrowserRun.findMany({ where: { scanId: ids.scanId }, orderBy: { browser: 'asc' } }),
    prisma.scanPage.findMany({ where: { scanId: ids.scanId }, orderBy: { createdAt: 'asc' } }),
    prisma.issue.findMany({
      where: { scanId: ids.scanId },
      include: { compatibility: true, trackedIssue: true },
      orderBy: { fingerprint: 'asc' },
    }),
  ]);
  return { ...ids, outcome, scan: row, runs, pages, issues, safety: fixtures.safetyHits() };
}

type Issue = Awaited<ReturnType<typeof scan>>['issues'][number];
const others = (issues: Issue[]) =>
  issues
    .filter((i) => i.category !== 'COMPATIBILITY')
    .map((i) => `${i.ruleId} ${i.selector ?? ''} ${i.severity} ${i.classification}`)
    .sort();
const compat = (issues: Issue[]) =>
  issues
    .filter((i) => i.category === 'COMPATIBILITY')
    .map((i) => ({
      browser: i.compatibility!.browser,
      ruleId: i.ruleId,
      viewport: i.viewport,
      classification: i.classification,
      text: i.description,
    }));
const summaries = (page: { compatibility: unknown }, engine: 'firefox' | 'webkit') =>
  (page.compatibility as Record<string, BrowserPageSummary[]>)[engine]!;

describe('the same engine on both sides', () => {
  it.each(['/ui/', '/compat/'])(
    '%s: compared, and no differences at all (Chromium vs Chromium)',
    async (path) => {
      const off = await scan(path, ONE_PAGE);
      const on = await scan(path, { ...ON, crossBrowserMobile: true }, { launch: standIn(false) });
      expect(compat(on.issues)).toEqual([]);
      for (const engine of ['firefox', 'webkit'] as const) {
        for (const s of summaries(on.pages[0]!, engine)) {
          expect(s.comparison).toMatchObject({ compared: true, differences: 0, chromiumOnly: 0 });
          expect(s.comparison!.baselineVersion).toMatch(/^Chromium \d/);
        }
      }
      expect(others(on.issues)).toEqual(others(off.issues));
      expect(on.scan.accessibilityScore).toBe(off.scan.accessibilityScore);
      expect(on.scan.uiHealthScore).toBe(off.scan.uiHealthScore);
      expect(on.outcome).toBe(off.outcome);
    },
    360_000,
  );
});

describe('engines without the features the fixture detects', () => {
  let off: Awaited<ReturnType<typeof scan>>;
  let on: Awaited<ReturnType<typeof scan>>;
  beforeAll(async () => {
    off = await scan('/compat/', ONE_PAGE);
    on = await scan('/compat/', { ...ON, crossBrowserMobile: true }, { launch: standIn(true) });
  }, 360_000);

  it('finds each seeded difference in the right browser, confirmed by a second load', () => {
    const found = compat(on.issues);
    const has = (browser: string, ruleId: string, viewport: string, text: string, cls: string) =>
      expect(found).toContainEqual(
        expect.objectContaining({
          browser,
          ruleId,
          viewport,
          classification: cls,
          text: expect.stringContaining(text),
        }),
      );
    has('FIREFOX', 'compat/browser-only-error', '1920x1080', 'scrollIntoViewIfNeeded', 'DETECTED');
    has('FIREFOX', 'compat/browser-only-error', '1920x1080', 'Widget failed', 'OBSERVATION');
    has('FIREFOX', 'compat/browser-only-font-failure', '1920x1080', 'Compat Brand', 'DETECTED');
    for (const viewport of ['1920x1080', '390x844']) {
      has(
        'WEBKIT',
        'compat/browser-only-resource-failure',
        viewport,
        'idle-callback.js',
        'DETECTED',
      );
      has('WEBKIT', 'compat/browser-only-layout', viewport, 'TEXT_CLIPPING', 'POTENTIAL_DEFECT');
    }
    // Nothing else: no proxy refusal, no error or image that fails everywhere, no font 404
    // reported twice, no native control or scroll box.
    expect(found).toHaveLength(7);
    for (const issue of on.issues.filter((i) => i.category === 'COMPATIBILITY')) {
      expect(issue.compatibility!.evidence).toMatchObject({ confirmed: true });
      expect(issue.compatibility!.baselineVersion).toMatch(/^Chromium \d/);
      expect(issue.details).toMatchObject({ browser: issue.compatibility!.browser });
    }
  });

  it('records the comparison per browser and size', () => {
    const [ff] = summaries(on.pages[0]!, 'firefox');
    expect(ff!.comparison).toMatchObject({ compared: true, differences: 3, confirmed: 3 });
    expect(summaries(on.pages[0]!, 'webkit').map((s) => s.comparison?.differences)).toEqual([2, 2]);
  });

  it('changes nothing else: other issues, scores, outcome; nothing written to the site', () => {
    expect(others(on.issues)).toEqual(others(off.issues));
    expect(on.scan.accessibilityScore).toBe(off.scan.accessibilityScore);
    expect(on.scan.uiHealthScore).toBe(off.scan.uiHealthScore);
    expect(on.outcome).toBe(off.outcome);
    expect(on.safety).toEqual({ writes: [], traps: [], websockets: [] });
  });

  it('tracked like every other issue; resolved only where that browser compared again', async () => {
    const tracked = on.issues.filter((i) => i.category === 'COMPATIBILITY');
    expect(tracked.every((i) => i.trackedIssue?.status === 'OPEN')).toBe(true);
    const ids = tracked.map((i) => i.trackedIssueId!);
    const status = async () =>
      (await prisma.trackedIssue.findMany({ where: { id: { in: ids } } })).map((t) => t.status);

    // Cross-browser off: not re-checked, so nothing is resolved.
    await prisma.website.update({
      where: { id: on.websiteId },
      data: { crossBrowserEnabled: false },
    });
    await scan('/compat/', ON, undefined, on.websiteId);
    expect(new Set(await status())).toEqual(new Set(['OPEN']));

    // WebKit only, without the difference: WebKit's are resolved, Firefox's stay open.
    await prisma.website.update({
      where: { id: on.websiteId },
      data: { crossBrowserEnabled: true, crossBrowserTargets: ['WEBKIT'] },
    });
    await scan('/compat/', ON, { launch: standIn(false) }, on.websiteId);
    const after = await prisma.trackedIssue.findMany({
      where: { id: { in: ids } },
      include: { issues: { take: 1, select: { details: true } } },
    });
    for (const t of after) {
      const browser = (t.issues[0]!.details as { browser: string }).browser;
      expect(`${browser} ${t.status}`).toBe(
        browser === 'WEBKIT' ? 'WEBKIT RESOLVED' : 'FIREFOX OPEN',
      );
    }
  }, 600_000);
});

describe('timing', () => {
  it('a difference not seen again on the second load is INCONCLUSIVE, never claimed', async () => {
    // timing.js throws only on its 3rd request: Chromium's crawl (1), Chromium's
    // comparison load (2), the other browser's first load (3).
    const result = await scan(
      '/compat/timing.html',
      { ...ON, crossBrowserTargets: ['FIREFOX'] },
      { launch: standIn(false) },
    );
    expect(compat(result.issues)).toEqual([
      expect.objectContaining({
        browser: 'FIREFOX',
        ruleId: 'compat/browser-only-error',
        classification: 'INCONCLUSIVE',
        text: expect.stringContaining('fails once'),
      }),
    ]);
    const issue = result.issues.find((i) => i.category === 'COMPATIBILITY')!;
    expect(issue.severity).toBe('INFO');
    expect(issue.compatibility!.evidence).toMatchObject({
      confirmed: false,
      why: 'not seen again when both browsers loaded the page a second time',
    });
  }, 240_000);
});
