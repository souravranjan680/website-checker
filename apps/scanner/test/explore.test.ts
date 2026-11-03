/**
 * The safe explorer as a scan stage (Phase 9, Milestone 1), with a real Chromium on the
 * SaaS fixture: limits, the per-website switch, recorded evidence and safety, scores,
 * and issue tracking. (Detection quality per fixture: fixture-acceptance.test.ts.)
 */
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExplorationSummary } from '../src/explore/explore-page';
import { runScan } from '../src/pipeline/run-scan';
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

async function scan(
  website: Parameters<typeof createScanFor>[2],
  options: { websiteId?: string; config?: Parameters<typeof testScannerConfig>[1] } = {},
) {
  const ids = await createScanFor(prisma, fixtures.url('/saas/'), website, options.websiteId);
  const deps = createTestDeps(testScannerConfig(proxy.url, options.config), prisma, publisher);
  await runScan(ids.scanId, deps, { signal: new AbortController().signal });
  const pages = await prisma.scanPage.findMany({
    where: { scanId: ids.scanId },
    orderBy: { createdAt: 'asc' },
  });
  const issues = await prisma.issue.findMany({
    where: { scanId: ids.scanId },
    include: { functional: true },
  });
  const row = await prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } });
  return { ...ids, pages, issues, scan: row };
}

describe('one page, default settings', () => {
  let result: Awaited<ReturnType<typeof scan>>;
  let summary: ExplorationSummary;
  beforeAll(async () => {
    fixtures.resetSafetyHits();
    result = await scan({ maxPages: 1, maxDepth: 0, responsivePageLimit: 0 });
    summary = result.pages[0]!.exploration as unknown as ExplorationSummary;
  }, 180_000);

  it('records what was explored, skipped (with reasons) and blocked', () => {
    expect(summary.explored).toBe(12);
    expect(summary.controls.map((c) => c.name)).toContain('Account');
    expect(summary.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Delete workspace',
          reason: 'destructive-or-state-changing',
        }),
        expect.objectContaining({ name: 'Log out', reason: 'destructive-or-state-changing' }),
      ]),
    );
    const kinds = new Set(summary.blocked.map((b) => b.kind));
    for (const kind of ['request', 'websocket', 'popup', 'download'])
      expect(kinds, kind).toContain(kind);
    expect(summary.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'request', method: 'POST' }),
        expect.objectContaining({ kind: 'request', detail: 'fetch to another site' }),
      ]),
    );
  });

  it('never wrote anything to the site', () => {
    expect(fixtures.safetyHits()).toEqual({ writes: [], traps: [], websockets: [] });
  });

  it('stores the interaction details and a highlighted screenshot of the opened state', () => {
    const clipped = result.issues.find(
      (i) => i.ruleId === 'functional/layer-clipped' && i.selector === '#account-btn',
    )!;
    expect(clipped.functional).toMatchObject({
      checkType: 'LAYER_CLIPPED',
      controlName: 'Account',
      controlSelector: '#account-btn',
    });
    // Each finding keeps only the steps that led to it.
    expect((clipped.functional!.interaction as { steps: string[] }).steps).toEqual([
      'Clicked “Account”',
    ]);
    const stuck = result.issues.find((i) => i.ruleId === 'functional/layer-not-dismissible')!;
    expect((stuck.functional!.interaction as { steps: string[] }).steps).toEqual([
      'Clicked “Workspace”',
      'Pressed Escape',
      'Clicked outside the menu',
      'Clicked “Workspace” again',
    ]);
    expect(clipped.screenshotId).not.toBeNull();
  });

  it('keeps scores comparable: problems inside opened menus do not change the accessibility score', () => {
    const openState = result.issues.find((i) => i.ruleId === 'button-name')!;
    expect(
      (openState.details as { interactionState?: { opened: string } }).interactionState?.opened,
    ).toBe('Account');
    // The page itself has no accessibility violations (only "needs review"), so 100.
    expect(result.scan.accessibilityScore).toBe(100);
  });
});

describe('limits and settings', () => {
  it('explores at most the configured number of controls per page', async () => {
    const result = await scan({
      maxPages: 1,
      maxDepth: 0,
      responsivePageLimit: 0,
      explorationControlLimit: 3,
    });
    const summary = result.pages[0]!.exploration as unknown as ExplorationSummary;
    expect(summary.controls).toHaveLength(3);
    expect(summary.skippedCounts.limit).toBe(9);
  }, 180_000);

  it('explores at most the configured number of pages (and the scanner cap wins)', async () => {
    const result = await scan(
      { maxPages: 3, maxDepth: 1, responsivePageLimit: 0, explorationPageLimit: 5 },
      { config: { maxExplorationPages: 2 } },
    );
    const done = result.pages.filter((p) => p.status === 'DONE');
    expect(done).toHaveLength(3);
    expect(done.filter((p) => p.exploration !== null)).toHaveLength(2);
  }, 240_000);

  it('can be switched off per website', async () => {
    const result = await scan({
      maxPages: 1,
      maxDepth: 0,
      responsivePageLimit: 0,
      explorationEnabled: false,
    });
    expect(result.pages[0]!.exploration).toBeNull();
    expect(result.issues.filter((i) => i.category === 'FUNCTIONAL')).toEqual([]);
  }, 180_000);
});

describe('issue tracking', () => {
  it('does not mark interaction problems resolved when a later scan did not explore the page', async () => {
    const first = await scan({ maxPages: 1, maxDepth: 0, responsivePageLimit: 0 });
    await prisma.website.update({
      where: { id: first.websiteId },
      data: { explorationEnabled: false },
    });
    await scan({}, { websiteId: first.websiteId });
    const tracked = await prisma.trackedIssue.findMany({
      where: { websiteId: first.websiteId, category: 'FUNCTIONAL' },
    });
    expect(tracked.length).toBeGreaterThan(5);
    expect(tracked.every((t) => t.status === 'OPEN')).toBe(true);
    const openState = await prisma.trackedIssue.findFirstOrThrow({
      where: { websiteId: first.websiteId, ruleId: 'button-name' },
    });
    expect(openState.status).toBe('OPEN');
  }, 360_000);
});
