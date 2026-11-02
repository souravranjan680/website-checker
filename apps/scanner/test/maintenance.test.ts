/** Storage cleanup removes only what nothing uses any more, and keeps what matters. */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@whc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStorageCleanup } from '../src/maintenance';
import { createLocalStorage, type FileStorage } from '../src/storage';
import { createTestPrisma, silentLogger } from './helpers';

let prisma: PrismaClient;
beforeAll(() => {
  prisma = createTestPrisma();
});
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);

async function put(storage: FileStorage, key: string, old = true) {
  await storage.put(key, Buffer.from('x'));
  if (old) await utimes(path.join(storage.root, key), twoHoursAgo, twoHoursAgo);
  // The folder's own time matters for the orphan-scan check.
  if (old)
    await utimes(
      path.join(storage.root, key.split('/').slice(0, 2).join('/')),
      twoHoursAgo,
      twoHoursAgo,
    );
}
const exists = (storage: FileStorage, key: string) => existsSync(path.join(storage.root, key));

async function website() {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@example.com`, name: 'T', passwordHash: 'x' },
  });
  const project = await prisma.project.create({ data: { name: 'P', createdById: user.id } });
  return prisma.website.create({
    data: {
      projectId: project.id,
      name: 'W',
      baseUrl: `https://${randomUUID()}.example/`,
      hostname: 'w.example',
      authorizationConfirmedAt: new Date(),
    },
  });
}

describe('runStorageCleanup', () => {
  it('removes folders of deleted scans and unused baseline images, keeps everything in use', async () => {
    const storage = createLocalStorage(await mkdtemp(path.join(tmpdir(), 'whc-clean-')));
    const site = await website();
    const live = await prisma.scan.create({
      data: { websiteId: site.id, config: {}, status: 'COMPLETED' },
    });
    const deletedScanId = randomUUID();
    await put(storage, `scans/${live.id}/pages/a.jpg`);
    await put(storage, `scans/${deletedScanId}/pages/a.jpg`);
    await put(storage, `scans/${randomUUID()}/pages/new.jpg`, false); // too new: a scan just starting

    const usedKey = `baselines/${site.id}/used.png`;
    await put(storage, usedKey);
    await put(storage, `baselines/${site.id}/replaced.png`);
    await prisma.screenshot.create({
      data: {
        kind: 'BASELINE',
        viewport: '1920x1080',
        width: 1,
        height: 1,
        storageKey: usedKey,
        sizeBytes: 1,
      },
    });

    const stats = await runStorageCleanup({
      prisma,
      storage,
      logger: silentLogger,
      retentionDays: 0,
    });
    expect(stats).toMatchObject({
      orphanScanFolders: 1,
      orphanBaselineFiles: 1,
      retentionScreenshots: 0,
    });
    expect(exists(storage, `scans/${live.id}/pages/a.jpg`)).toBe(true);
    expect(exists(storage, `scans/${deletedScanId}`)).toBe(false);
    expect(exists(storage, usedKey)).toBe(true);
    expect(exists(storage, `baselines/${site.id}/replaced.png`)).toBe(false);
  });

  it('retention removes old screenshots and raw Lighthouse files, but never the latest scan or bug report evidence', async () => {
    const storage = createLocalStorage(await mkdtemp(path.join(tmpdir(), 'whc-retain-')));
    const site = await website();
    const old = await prisma.scan.create({
      data: {
        websiteId: site.id,
        config: {},
        status: 'COMPLETED',
        createdAt: new Date(Date.now() - 100 * DAY),
      },
    });
    const latest = await prisma.scan.create({
      data: {
        websiteId: site.id,
        config: {},
        status: 'COMPLETED',
        createdAt: new Date(Date.now() - 95 * DAY),
      },
    });
    const page = await prisma.scanPage.create({
      data: {
        scanId: old.id,
        url: 'https://w.example/',
        normalizedUrl: 'https://w.example/',
        status: 'DONE',
      },
    });
    const shot = async (
      scanId: string,
      name: string,
      kind: 'PAGE_FULL' | 'ISSUE_CROP' | 'VISUAL_CURRENT',
    ) => {
      const key = `scans/${scanId}/${name}`;
      await put(storage, key);
      return prisma.screenshot.create({
        data: { scanId, kind, width: 1, height: 1, storageKey: key, sizeBytes: 1 },
      });
    };
    const oldPage = await shot(old.id, 'page.jpg', 'PAGE_FULL');
    const evidence = await shot(old.id, 'crop.jpg', 'ISSUE_CROP');
    const visual = await shot(old.id, 'visual.png', 'VISUAL_CURRENT');
    const latestPage = await shot(latest.id, 'page.jpg', 'PAGE_FULL');
    await prisma.bugReport.create({
      data: {
        projectId: site.projectId,
        title: 't',
        description: 'd',
        severity: 'HIGH',
        affectedUrl: 'https://w.example/',
        browser: 'Chromium',
        viewport: '1920x1080',
        expectedBehavior: '',
        actualBehavior: 'a',
        screenshotId: evidence.id,
      },
    });
    const lhKey = `scans/${old.id}/lighthouse/p-mobile.json`;
    await put(storage, lhKey);
    const perf = await prisma.performanceResult.create({
      data: { scanId: old.id, scanPageId: page.id, performanceScore: 70, rawReportKey: lhKey },
    });

    const stats = await runStorageCleanup({
      prisma,
      storage,
      logger: silentLogger,
      retentionDays: 90,
    });
    expect(stats).toMatchObject({ retentionScreenshots: 1, retentionLighthouseReports: 1 });
    expect(await prisma.screenshot.findUnique({ where: { id: oldPage.id } })).toBeNull();
    expect(exists(storage, oldPage.storageKey)).toBe(false);
    // Kept: bug report evidence, visual snapshots and the website's latest scan.
    for (const kept of [evidence, visual, latestPage]) {
      expect(await prisma.screenshot.findUnique({ where: { id: kept.id } })).not.toBeNull();
      expect(exists(storage, kept.storageKey)).toBe(true);
    }
    // Lighthouse numbers stay; only the big raw file is gone.
    const after = await prisma.performanceResult.findUniqueOrThrow({ where: { id: perf.id } });
    expect(after).toMatchObject({ performanceScore: 70, rawReportKey: null });
    expect(exists(storage, lhKey)).toBe(false);
  });
});
