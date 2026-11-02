/**
 * Regression tests for two false-positive sources (real Chromium, real egress proxy):
 *   1. failed resources and links are re-checked; only confirmed failures are issues
 *   2. console messages are classified (site code, integration config, third party,
 *      network, harmless) with their source file, line and column
 */
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '../src/pipeline/run-scan';
import {
  startFixtureServer,
  STORYBLOK_HOST,
  THIRD_PARTY_HOST,
  type FixtureServer,
} from './fixture-server';
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
  proxy = await startTestProxy([STORYBLOK_HOST, THIRD_PARTY_HOST]);
});
afterAll(async () => {
  await fixtures.close();
  await proxy.close();
  await publisher.quit();
  await prisma.$disconnect();
});

async function scanOnePage(pathname: string) {
  const ids = await createScanFor(prisma, fixtures.url(pathname), {
    maxPages: 1,
    maxDepth: 0,
    responsivePageLimit: 0,
  });
  const deps = createTestDeps(testScannerConfig(proxy.url), prisma, publisher);
  await runScan(ids.scanId, deps, { signal: new AbortController().signal });
  const page = await prisma.scanPage.findFirstOrThrow({ where: { scanId: ids.scanId } });
  const issues = await prisma.issue.findMany({
    where: { scanId: ids.scanId, category: 'UI_HEALTH' },
    include: { uiHealth: true },
  });
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } });
  return { page, issues, scan };
}

type Failed = {
  url: string;
  status?: number;
  error?: string;
  verdict?: string;
  verdictReason?: string;
};
type ConsoleRow = {
  level: string;
  text: string;
  source?: string;
  line?: number;
  column?: number;
  kind?: string;
  related?: { url: string; status: number | null; relation: string }[];
};

describe('failed images, scripts, stylesheets and links', () => {
  let result: Awaited<ReturnType<typeof scanOnePage>>;
  beforeAll(async () => {
    result = await scanOnePage('/resources/');
  }, 120_000);

  const urlsOf = (check: string) =>
    result.issues
      .filter((i) => i.uiHealth?.checkType === check)
      .map((i) => i.uiHealth?.resourceUrl);

  it('reports images that are really broken (404, not an image, domain does not exist)', () => {
    const broken = urlsOf('BROKEN_IMAGE');
    expect(broken).toContain(fixtures.url('/resources/missing.png'));
    expect(broken).toContain(fixtures.url('/resources/not-an-image.png'));
    expect(broken).toContain('http://no-such-host.invalid/logo.png');
    const notAnImage = result.issues.find(
      (i) => i.uiHealth?.resourceUrl === fixtures.url('/resources/not-an-image.png'),
    )!;
    expect(JSON.stringify(notAnImage.details)).toContain('text/html; charset=utf-8, not an image');
  });

  it('does not report a browser-only failure (net::ERR_*), an unreachable server or a policy block as broken', () => {
    const reported = [
      ...urlsOf('BROKEN_IMAGE'),
      ...urlsOf('FAILED_SCRIPT'),
      ...urlsOf('FAILED_REQUEST'),
    ];
    expect(reported).not.toContain(fixtures.url('/resources/flaky.png'));
    expect(reported).not.toContain('http://fixtures.whc.test:1/unreachable.png');
    expect(reported).not.toContain('http://fixtures.whc.test:1/app.js');
    expect(reported).not.toContain('http://10.0.0.1/internal.png');

    // ...but every one of them is kept on the page record, with the reason.
    const failed = result.page.failedRequests as Failed[];
    const verdictOf = (url: string) => failed.find((f) => f.url === url);
    // The download is cut off: Chrome reports either a net::ERR_* or simply an image
    // that does not display. Either way the re-check loads it, so it is not reported.
    const flaky = verdictOf(fixtures.url('/resources/flaky.png'))!;
    expect(flaky.error).toMatch(/^net::ERR_|not displayed/);
    expect(flaky).toMatchObject({ verdict: 'INCONCLUSIVE' });
    expect(flaky.verdictReason).toMatch(/loaded on a re-check/);
    expect(verdictOf('http://fixtures.whc.test:1/unreachable.png')).toMatchObject({
      verdict: 'INCONCLUSIVE',
    });
    expect(verdictOf('http://fixtures.whc.test:1/app.js')).toMatchObject({
      verdict: 'INCONCLUSIVE',
    });
    expect(verdictOf('http://10.0.0.1/internal.png')).toMatchObject({
      verdict: 'BLOCKED_BY_POLICY',
    });
  });

  it('still reports a missing stylesheet', () => {
    expect(urlsOf('FAILED_STYLESHEET')).toContain(fixtures.url('/resources/missing.css'));
  });

  it('reports only confirmed broken links and lists the rest', () => {
    const links = urlsOf('BROKEN_LINK');
    expect(links).toContain(fixtures.url('/resources/gone'));
    expect(links).toContain(fixtures.url('/resources/always-500'));
    expect(links).not.toContain('http://fixtures.whc.test:1/');
    expect(links).not.toContain('http://10.0.0.1/admin');
    const summary = (result.scan.siteChecks as { links: Record<string, { href: string }[]> }).links;
    expect(summary.inconclusive!.map((l) => l.href)).toContain('http://fixtures.whc.test:1/');
    expect(summary.blockedByPolicy!.map((l) => l.href)).toContain('http://10.0.0.1/admin');
  });
});

describe('console messages (Storyblok missing access token)', () => {
  let result: Awaited<ReturnType<typeof scanOnePage>>;
  beforeAll(async () => {
    result = await scanOnePage('/storyblok/');
  }, 120_000);

  const consoleRows = () => [
    ...(result.page.consoleErrors as ConsoleRow[]),
    ...(result.page.pageErrors as (ConsoleRow & { message: string })[]).map((e) => ({
      ...e,
      text: e.message,
    })),
  ];

  it('keeps the original message with its source file, line and column', () => {
    const storyblok = consoleRows().find((c) =>
      c.text.startsWith('You need to provide an access token'),
    )!;
    expect(storyblok).toMatchObject({
      level: 'error',
      kind: 'INTEGRATION_CONFIG',
      source: fixtures.url('/storyblok/app.js'),
      line: 4,
    });
    expect(storyblok.column).toBeGreaterThan(0);
    expect(storyblok.text).toContain('https://www.storyblok.com/docs/api/content-delivery');
  });

  it('links the failed Storyblok API request separately, re-checked and confirmed', () => {
    const storyblok = consoleRows().find((c) =>
      c.text.startsWith('You need to provide an access token'),
    )!;
    expect(storyblok.related).toEqual([
      expect.objectContaining({
        status: 401,
        relation: 'same-service',
        url: expect.stringContaining(`http://${STORYBLOK_HOST}:`),
      }),
    ]);
    const request = (result.page.failedRequests as Failed[]).find((f) =>
      f.url.includes(STORYBLOK_HOST),
    )!;
    expect(request).toMatchObject({ status: 401, verdict: 'CONFIRMED' });
    const requestIssue = result.issues.find((i) => i.uiHealth?.checkType === 'FAILED_REQUEST')!;
    expect(requestIssue.uiHealth?.resourceUrl).toContain(STORYBLOK_HOST);
  });

  it('reports it as an integration configuration error (not a generic console error)', () => {
    const issue = result.issues.find((i) =>
      i.description.startsWith('You need to provide an access token'),
    )!;
    expect(issue).toMatchObject({
      title: 'Integration not configured correctly',
      severity: 'MEDIUM',
    });
    expect(issue.description).toContain(`Source: ${fixtures.url('/storyblok/app.js')}:4:`);
    expect(issue.description).toContain(STORYBLOK_HOST);
    expect(issue.suggestedFix).toMatch(/access token/);
  });

  it('classifies site code, third-party and harmless messages, and groups repeats', () => {
    const cart = result.issues.filter((i) => i.description.startsWith('Cart item'));
    expect(cart).toHaveLength(1); // two messages, one problem
    expect(cart[0]).toMatchObject({
      severity: 'MEDIUM',
      title: 'JavaScript error in the site’s code',
    });
    expect(cart[0]!.description).toContain('Logged 2 times');

    const appException = result.issues.find(
      (i) => i.uiHealth?.checkType === 'JS_ERROR' && i.description.includes('items'),
    )!;
    expect(appException).toMatchObject({ severity: 'HIGH', title: 'Uncaught JavaScript error' });
    expect(appException.description).toContain(`Source: ${fixtures.url('/storyblok/app.js')}:`);

    const widget = result.issues.find((i) =>
      i.description.includes('Widget failed to initialise'),
    )!;
    expect(widget).toMatchObject({ severity: 'MEDIUM', title: 'Error in a third-party script' });

    const deprecation = consoleRows().find((c) => c.text.startsWith('[Deprecation]'))!;
    expect(deprecation).toMatchObject({ level: 'warning', kind: 'HARMLESS' });
    expect(result.issues.some((i) => i.description.includes('[Deprecation]'))).toBe(false);
  });
});
