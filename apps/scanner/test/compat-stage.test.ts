/**
 * Phase 9, Milestone 3 (Checkpoint 1): the cross-browser stage inside a real scan.
 * Chromium stands in for the other engines where a test needs a working browser (the
 * stage takes a launch hook); real Firefox and WebKit are used when installed (in the
 * Docker test image). Covers: off by default, missing binaries, crashes, timeouts,
 * cancellation, the security self-check, per-page summaries, skipped checks with reasons,
 * and that nothing about the Chromium scan (issues, scores, outcome) changes.
 */
import { existsSync } from 'node:fs';
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { chromium, firefox, webkit } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchScanBrowser } from '../src/browser';
import type { BrowserPageSummary, CompatOptions } from '../src/pipeline/compat-stage';
import { runScan, type ScanDeps } from '../src/pipeline/run-scan';
import { startFixtureServer, type FixtureServer } from './fixture-server';
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
  proxy = await startTestProxy();
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

async function scan(
  path: string,
  website: Parameters<typeof createScanFor>[2],
  options: {
    compat?: CompatOptions;
    config?: Parameters<typeof testScannerConfig>[1];
    abort?: (controller: AbortController) => CompatOptions['afterPage'];
  } = {},
) {
  fixtures.resetSafetyHits();
  const ids = await createScanFor(prisma, fixtures.url(path), website);
  const deps: ScanDeps = {
    ...createTestDeps(testScannerConfig(proxy.url, options.config), prisma, publisher),
    compat: options.compat,
  };
  const controller = new AbortController();
  if (options.abort) deps.compat = { ...deps.compat, afterPage: options.abort(controller) };
  const outcome = await runScan(ids.scanId, deps, { signal: controller.signal });
  const [row, runs, pages, issues] = await Promise.all([
    prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } }),
    prisma.scanBrowserRun.findMany({ where: { scanId: ids.scanId }, orderBy: { browser: 'asc' } }),
    prisma.scanPage.findMany({ where: { scanId: ids.scanId }, orderBy: { createdAt: 'asc' } }),
    prisma.issue.findMany({ where: { scanId: ids.scanId }, orderBy: { fingerprint: 'asc' } }),
  ]);
  return { ...ids, outcome, scan: row, runs, pages, issues, safety: fixtures.safetyHits() };
}

/** Launches Chromium (through the egress proxy) in place of Firefox/WebKit. */
const standIn =
  (config = testScannerConfig('')): CompatOptions['launch'] =>
  () =>
    launchScanBrowser({ ...config, egressProxyUrl: proxy.url });

const ON = { ...ONE_PAGE, crossBrowserEnabled: true };
const statusOf = (runs: { browser: string; status: string }[]) =>
  Object.fromEntries(runs.map((r) => [r.browser, r.status]));

describe('off by default', () => {
  it('a website that did not turn it on: no browser runs, no summaries, the scan as before', async () => {
    const result = await scan('/a11y/', ONE_PAGE);
    expect(result.runs).toEqual([]);
    expect(result.pages.every((p) => p.compatibility === null)).toBe(true);
  }, 180_000);
});

describe('failures of other browsers never change the scan', () => {
  it('missing binaries: UNAVAILABLE, and issues, scores and outcome equal a scan without it', async () => {
    // /ui/ is fully deterministic (on /a11y/, axe's colour-contrast verdict varies
    // between runs by itself, which would hide what this test is about).
    const off = await scan('/ui/', ONE_PAGE);
    const on = await scan('/ui/', ON, {
      compat: {
        launch: (engine) =>
          launchScanBrowser(testScannerConfig(proxy.url), {
            engine,
            executablePath: '/nonexistent/browser/binary',
          }),
      },
    });
    expect(statusOf(on.runs)).toEqual({ FIREFOX: 'UNAVAILABLE', WEBKIT: 'UNAVAILABLE' });
    expect(on.runs.map((r) => r.errorMessage)).toEqual([
      'Firefox is not installed on this server.',
      'WebKit is not installed on this server.',
    ]);
    expect(on.outcome).toBe(off.outcome);
    const rules = (
      issues: {
        ruleId: string;
        selector: string | null;
        severity: string;
        classification: string;
      }[],
    ) =>
      issues.map((i) => `${i.ruleId} ${i.selector ?? ''} ${i.severity} ${i.classification}`).sort();
    expect(rules(on.issues)).toEqual(rules(off.issues));
    expect(on.scan.accessibilityScore).toBe(off.scan.accessibilityScore);
    expect(on.scan.uiHealthScore).toBe(off.scan.uiHealthScore);
  }, 360_000);

  it('a crash: that browser FAILED (pages done so far kept), the other still COMPLETED', async () => {
    const result = await scan(
      '/admin/',
      { ...ON, maxPages: 2, maxDepth: 1, crossBrowserPageLimit: 2 },
      {
        compat: {
          launch: standIn(),
          afterPage: async (engine, browser, index) => {
            if (engine === 'firefox' && index === 0) await browser.close(); // simulated crash
          },
        },
        config: { maxDurationMs: 600_000 },
      },
    );
    expect(result.outcome).toBe('COMPLETED');
    const [ff, wk] = result.runs;
    expect(ff).toMatchObject({ browser: 'FIREFOX', status: 'FAILED', pagesChecked: 1 });
    expect(ff!.errorMessage).toMatch(/stopped unexpectedly/);
    expect(wk).toMatchObject({ browser: 'WEBKIT', status: 'COMPLETED', pagesChecked: 2 });
  }, 360_000);

  it('a time budget used up: TIMED_OUT, the scan continues', async () => {
    // A budget shorter than the security self-check alone.
    const result = await scan(
      '/a11y/',
      { ...ON, crossBrowserTargets: ['WEBKIT'] },
      { compat: { launch: standIn() }, config: { compatBrowserTimeoutMs: 50 } },
    );
    expect(statusOf(result.runs)).toEqual({ WEBKIT: 'TIMED_OUT' });
    expect(result.runs[0]!.errorMessage).toMatch(/time budget/);
  }, 240_000);

  it('a browser that goes around the proxy fails its self-check and is not used', async () => {
    const result = await scan(
      '/a11y/',
      { ...ON, crossBrowserTargets: ['FIREFOX'] },
      {
        // Launched without any proxy: exactly what the self-check must catch.
        compat: { launch: () => chromium.launch() },
      },
    );
    expect(statusOf(result.runs)).toEqual({ FIREFOX: 'UNAVAILABLE' });
    expect(result.runs[0]!.errorMessage).toMatch(/failed its network security self-check/);
    expect(result.pages[0]!.compatibility).toBeNull(); // no page was loaded with it
  }, 240_000);

  it('not allowed on this server: SKIPPED with the reason', async () => {
    const result = await scan('/a11y/', ON, {
      config: { compatBrowsers: ['webkit'] },
      compat: { launch: standIn() },
    });
    expect(statusOf(result.runs)).toEqual({ FIREFOX: 'SKIPPED', WEBKIT: 'COMPLETED' });
    expect(result.runs[0]!.errorMessage).toMatch(/SCAN_COMPAT_BROWSERS/);
  }, 240_000);

  it('cancelling during the stage cancels the scan and marks the running browser CANCELLED', async () => {
    const result = await scan('/a11y/', ON, {
      compat: { launch: standIn() },
      // Cancelled after Firefox's only page: noticed when WebKit starts its first page.
      abort: (controller) => async () => controller.abort(),
    });
    expect(result.outcome).toBe('CANCELLED');
    expect(statusOf(result.runs)).toEqual({ FIREFOX: 'COMPLETED', WEBKIT: 'CANCELLED' });
  }, 240_000);
});

describe('what is recorded', () => {
  it('per-page facts per browser and size; interactions and Firefox mobile skipped with reasons', async () => {
    const result = await scan(
      '/ui/',
      { ...ON, crossBrowserMobile: true },
      { compat: { launch: standIn() } },
    );
    expect(statusOf(result.runs)).toEqual({ FIREFOX: 'COMPLETED', WEBKIT: 'COMPLETED' });
    const [ff, wk] = result.runs;
    expect(ff).toMatchObject({ pagesPlanned: 1, pagesChecked: 1 });
    expect(wk).toMatchObject({ pagesPlanned: 2, pagesChecked: 2 }); // desktop + 390x844
    const skipped = ff!.skippedChecks as { check: string; reason: string }[];
    expect(skipped).toEqual(
      expect.arrayContaining([
        { check: 'explorer', reason: 'interactions run in Chromium only' },
        { check: 'keyboard-probe', reason: 'interactions run in Chromium only' },
        { check: 'form-probe', reason: 'interactions run in Chromium only' },
        {
          check: 'mobile-size',
          viewport: '390x844',
          reason: 'Firefox cannot emulate mobile devices',
        },
      ]),
    );
    const record = result.pages[0]!.compatibility as unknown as Record<
      string,
      BrowserPageSummary[]
    >;
    expect(record.firefox!.map((s) => s.viewport)).toEqual(['1920x1080']);
    expect(record.webkit!.map((s) => s.viewport)).toEqual(['1920x1080', '390x844']);
    const facts = record.firefox![0]!.facts!;
    expect(facts.ui.length).toBeGreaterThan(0); // the /ui/ fixture's layout problems, seen again
    expect(facts.document?.width).toBeGreaterThan(0);
    // No interactions in other browsers: nothing written, no traps hit.
    expect(result.safety).toEqual({ writes: [], traps: [], websockets: [] });
  }, 360_000);
});

const REAL = { firefox, webkit };
const installed = (engine: 'firefox' | 'webkit') => {
  try {
    return existsSync(REAL[engine].executablePath());
  } catch {
    return false;
  }
};

describe.each(['firefox', 'webkit'] as const)('real %s (when installed)', (engine) => {
  it.runIf(!installed(engine))('is not installed here: covered in the Docker test image', () => {
    expect(installed(engine)).toBe(false);
  });

  it.runIf(installed(engine))(
    'runs passively through the proxy and records its version and facts',
    async () => {
      const target = engine === 'firefox' ? 'FIREFOX' : 'WEBKIT';
      const before = fixtures.secretHits();
      const result = await scan('/ui/', { ...ON, crossBrowserTargets: [target] });
      const [run] = result.runs;
      expect(run).toMatchObject({ browser: target, status: 'COMPLETED', pagesChecked: 1 });
      expect(run!.version).toMatch(engine === 'firefox' ? /^Firefox \d/ : /^WebKit \d/);
      const record = result.pages[0]!.compatibility as unknown as Record<
        string,
        BrowserPageSummary[]
      >;
      expect(record[engine]![0]!.status).toBe('DONE');
      expect(result.safety).toEqual({ writes: [], traps: [], websockets: [] });
      expect(fixtures.secretHits() - before).toBe(0);
    },
    240_000,
  );
});
