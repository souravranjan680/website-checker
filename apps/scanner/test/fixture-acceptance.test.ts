/**
 * Fixture acceptance (Phase 9): scans every fixture that has a manifest
 * (tests/fixtures/manifests/*.json) with the real scanner, and requires, per scored
 * detector category, 100% recall of the seeded issues and zero false positives
 * (including zero findings on negative controls). These targets apply to these
 * deterministic fixtures only, not to arbitrary websites.
 *
 * A Markdown summary is written to .scanner-test-storage/fixture-acceptance.md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  evaluate,
  formatResults,
  type CategoryResult,
  type FixtureManifest,
} from './harness/evaluate';
import {
  createPublisher,
  createScanFor,
  createTestDeps,
  createTestPrisma,
  startTestProxy,
  testScannerConfig,
} from './helpers';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MANIFEST_DIR = path.join(ROOT, 'tests/fixtures/manifests');
const manifests: FixtureManifest[] = readdirSync(MANIFEST_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map(
    (name) => JSON.parse(readFileSync(path.join(MANIFEST_DIR, name), 'utf8')) as FixtureManifest,
  );

let prisma: PrismaClient;
let publisher: Redis;
let fixtures: FixtureServer;
let proxy: Awaited<ReturnType<typeof startTestProxy>>;
const report: { fixture: string; result: CategoryResult }[] = [];

beforeAll(async () => {
  prisma = createTestPrisma();
  publisher = createPublisher();
  fixtures = await startFixtureServer();
  proxy = await startTestProxy([STORYBLOK_HOST, THIRD_PARTY_HOST]);
});
afterAll(async () => {
  const out = path.join(ROOT, '.scanner-test-storage');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'fixture-acceptance.md'), `${formatResults(report)}\n`);
  await fixtures.close();
  await proxy.close();
  await publisher.quit();
  await prisma.$disconnect();
});

describe.each(manifests.map((m) => [m.fixture, m] as const))('fixture %s', (_name, manifest) => {
  let results: CategoryResult[];
  beforeAll(async () => {
    const ids = await createScanFor(prisma, fixtures.url(manifest.startPath), manifest.scan);
    const deps = createTestDeps(testScannerConfig(proxy.url), prisma, publisher);
    await runScan(ids.scanId, deps, { signal: new AbortController().signal });
    const issues = await prisma.issue.findMany({
      where: { scanId: ids.scanId },
      include: { uiHealth: { select: { resourceUrl: true } } },
    });
    results = evaluate(
      manifest,
      issues.map((i) => ({
        category: i.category,
        ruleId: i.ruleId,
        viewport: i.viewport,
        selector: i.selector,
        resourceUrl: i.uiHealth?.resourceUrl ?? null,
        description: i.description,
        classification: i.classification,
      })),
    );
    report.push(...results.map((result) => ({ fixture: manifest.fixture, result })));
  }, 180_000);

  it('finds every seeded issue with the expected classification (recall 100%)', () => {
    for (const r of results) expect(r.missed, `${r.category} missed`).toEqual([]);
  });

  it('reports nothing on negative controls and no unlisted problems (precision 100%)', () => {
    for (const r of results) {
      expect(r.negativeControlHits, `${r.category} negative controls`).toEqual([]);
      expect(r.falsePositives, `${r.category} false positives`).toEqual([]);
    }
  });
});
