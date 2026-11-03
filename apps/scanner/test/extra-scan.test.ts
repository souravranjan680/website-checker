/**
 * Phase 9, Milestone 2 (Checkpoint 1) as part of a scan, with a real Chromium on the
 * fixture sites: the per-website consistency switch, issue tracking, scores, evidence
 * and screenshots. (Detection quality per detector: fixture-acceptance.test.ts.)
 */
import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeScore, countsTowardsUiScore } from '../src/finalize';
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
  path: string,
  website: Parameters<typeof createScanFor>[2],
  websiteId?: string,
) {
  const ids = await createScanFor(prisma, fixtures.url(path), website, websiteId);
  const deps = createTestDeps(testScannerConfig(proxy.url), prisma, publisher);
  await runScan(ids.scanId, deps, { signal: new AbortController().signal });
  const [row, issues, pages] = await Promise.all([
    prisma.scan.findUniqueOrThrow({ where: { id: ids.scanId } }),
    prisma.issue.findMany({ where: { scanId: ids.scanId }, include: { uiHealth: true } }),
    prisma.scanPage.findMany({ where: { scanId: ids.scanId } }),
  ]);
  return { ...ids, scan: row, issues, pages };
}

const ADMIN = { maxPages: 4, maxDepth: 1, responsivePageLimit: 0, explorationEnabled: false };

describe('component consistency setting', () => {
  it('on by default: components are summarised per page and compared', async () => {
    const result = await scan('/admin/', ADMIN);
    expect(result.pages.filter((p) => p.components !== null)).toHaveLength(4);
    expect(result.issues.filter((i) => i.ruleId === 'ui/component-inconsistent')).toHaveLength(3);
  }, 180_000);

  it('can be switched off per website: nothing is compared or stored', async () => {
    const result = await scan('/admin/', { ...ADMIN, consistencyEnabled: false });
    expect(result.pages.every((p) => p.components === null)).toBe(true);
    expect(result.issues.filter((i) => i.ruleId === 'ui/component-inconsistent')).toEqual([]);
  }, 180_000);

  it('consistency findings are not marked resolved by a scan that did not compare components', async () => {
    const first = await scan('/admin/', ADMIN);
    await prisma.website.update({
      where: { id: first.websiteId },
      data: { consistencyEnabled: false },
    });
    await scan('/admin/', {}, first.websiteId);
    const tracked = await prisma.trackedIssue.findMany({
      where: { websiteId: first.websiteId, ruleId: 'ui/component-inconsistent' },
    });
    expect(tracked).toHaveLength(3);
    expect(tracked.every((t) => t.status === 'OPEN')).toBe(true);
  }, 360_000);
});

describe('scores and evidence', () => {
  it('Milestone 2 findings never change the UI health score', async () => {
    const seeded = await scan('/magazine/', {
      maxPages: 1,
      maxDepth: 0,
      responsivePageLimit: 1,
      explorationEnabled: false,
    });
    const twin = await scan('/magazine/fixed.html', {
      maxPages: 1,
      maxDepth: 0,
      responsivePageLimit: 1,
      explorationEnabled: false,
    });
    const extra = seeded.issues.filter((i) => !countsTowardsUiScore(i));
    expect(extra.length).toBeGreaterThanOrEqual(20);
    expect(seeded.scan.uiHealthScore).toBe(twin.scan.uiHealthScore);
    // The stored score is exactly the score of the earlier checks alone.
    const scored = seeded.issues.filter(
      (i) => (i.category === 'UI_HEALTH' || i.category === 'RESPONSIVE') && countsTowardsUiScore(i),
    );
    expect(seeded.scan.uiHealthScore).toBe(computeScore(scored, 1));
  }, 240_000);

  it('findings carry measurements and a classification; screenshots come from their own budget', async () => {
    const result = await scan('/magazine/', {
      maxPages: 1,
      maxDepth: 0,
      responsivePageLimit: 0,
      explorationEnabled: false,
    });
    const fixed = result.issues.find((i) => i.ruleId === 'ui/fixed-out-of-viewport')!;
    expect(fixed.classification).toBe('POTENTIAL_DEFECT');
    expect(fixed.uiHealth?.checkType).toBe('FIXED_OUT_OF_VIEWPORT');
    expect(fixed.details).toMatchObject({ hiddenPx: 100, windowHeight: 1080 });
    const withScreenshot = result.issues.filter(
      (i) => i.uiHealth && !countsTowardsUiScore(i) && i.screenshotId !== null,
    );
    expect(withScreenshot.length).toBeGreaterThan(0);
    expect(withScreenshot.length).toBeLessThanOrEqual(2); // per page
  }, 180_000);
});
