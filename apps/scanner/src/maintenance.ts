import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@whc/db';
import type { Logger } from './logger';
import { resolveKey, type FileStorage } from './storage';

/**
 * Safe storage cleanup (the scanner owns storage; the API can only read it).
 *   1. scans/<id>/ folders whose scan no longer exists (deleted scans/websites)
 *   2. baselines/<website>/ files no Screenshot row points to (replaced/deleted baselines)
 *   3. optional retention (SCAN_RETENTION_DAYS > 0): page/issue screenshots and raw
 *      Lighthouse JSON of old scans. Never touched: each website's latest finished
 *      scan, screenshots used by bug reports, and visual snapshots (comparison history).
 * Anything younger than MIN_AGE_MS is skipped, so a scan that is just starting is safe.
 */

export const MIN_AGE_MS = 60 * 60_000;

export interface CleanupStats {
  orphanScanFolders: number;
  orphanBaselineRows: number;
  orphanBaselineFiles: number;
  retentionScreenshots: number;
  retentionLighthouseReports: number;
}

async function olderThan(file: string, ms: number, now: number): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  return info !== null && now - info.mtimeMs > ms;
}

async function removeFile(storage: FileStorage, key: string): Promise<void> {
  await rm(resolveKey(storage.root, key), { force: true });
}

export async function runStorageCleanup(deps: {
  prisma: PrismaClient;
  storage: FileStorage;
  logger: Logger;
  retentionDays: number;
  now?: number;
}): Promise<CleanupStats> {
  const { prisma, storage, logger } = deps;
  const now = deps.now ?? Date.now();
  const stats: CleanupStats = {
    orphanScanFolders: 0,
    orphanBaselineRows: 0,
    orphanBaselineFiles: 0,
    retentionScreenshots: 0,
    retentionLighthouseReports: 0,
  };

  // 1) Folders of scans that no longer exist.
  const scanDirs = await readdir(path.join(storage.root, 'scans')).catch(() => [] as string[]);
  if (scanDirs.length) {
    const existing = new Set(
      (await prisma.scan.findMany({ where: { id: { in: scanDirs } }, select: { id: true } })).map(
        (s) => s.id,
      ),
    );
    for (const dir of scanDirs) {
      if (existing.has(dir)) continue;
      if (!(await olderThan(path.join(storage.root, 'scans', dir), MIN_AGE_MS, now))) continue;
      await storage.removePrefix(`scans/${dir}`);
      stats.orphanScanFolders += 1;
    }
  }

  // 2) Baseline images: first rows that no baseline uses any more (e.g. the website was
  //    deleted: its baselines go, the image rows stay), then files no row points to.
  const orphanRows = await prisma.screenshot.deleteMany({
    where: { kind: 'BASELINE', baseline: null, createdAt: { lt: new Date(now - MIN_AGE_MS) } },
  });
  stats.orphanBaselineRows = orphanRows.count;
  const websiteDirs = await readdir(path.join(storage.root, 'baselines')).catch(
    () => [] as string[],
  );
  for (const websiteId of websiteDirs) {
    const files = await readdir(path.join(storage.root, 'baselines', websiteId)).catch(
      () => [] as string[],
    );
    if (files.length === 0) continue;
    const keys = files.map((f) => `baselines/${websiteId}/${f}`);
    const used = new Set(
      (
        await prisma.screenshot.findMany({
          where: { storageKey: { in: keys } },
          select: { storageKey: true },
        })
      ).map((s) => s.storageKey),
    );
    for (const key of keys) {
      if (used.has(key)) continue;
      if (!(await olderThan(path.join(storage.root, key), MIN_AGE_MS, now))) continue;
      await removeFile(storage, key);
      stats.orphanBaselineFiles += 1;
    }
  }

  // 3) Retention (off by default).
  if (deps.retentionDays > 0) {
    const cutoff = new Date(now - deps.retentionDays * 86_400_000);
    const latest = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON ("websiteId") id FROM "Scan"
      WHERE status IN ('COMPLETED', 'PARTIAL')
      ORDER BY "websiteId", "createdAt" DESC`;
    const keep = latest.map((r) => r.id);
    const oldScans = { createdAt: { lt: cutoff }, id: { notIn: keep } };

    const shots = await prisma.screenshot.findMany({
      where: {
        kind: { in: ['PAGE_FULL', 'VIEWPORT', 'ISSUE_CROP'] },
        scan: oldScans,
        bugReports: { none: {} },
      },
      select: { id: true, storageKey: true },
      take: 5000,
    });
    for (const shot of shots) {
      await removeFile(storage, shot.storageKey);
      // Issues pointing at it keep working: Issue.screenshotId is set to null.
      await prisma.screenshot.delete({ where: { id: shot.id } });
      stats.retentionScreenshots += 1;
    }

    const reports = await prisma.performanceResult.findMany({
      where: { rawReportKey: { not: null }, scan: oldScans },
      select: { id: true, rawReportKey: true },
      take: 5000,
    });
    for (const report of reports) {
      await removeFile(storage, report.rawReportKey!);
      // The scores and metrics stay; only the large raw JSON goes.
      await prisma.performanceResult.update({
        where: { id: report.id },
        data: { rawReportKey: null },
      });
      stats.retentionLighthouseReports += 1;
    }
  }

  if (Object.values(stats).some((n) => n > 0)) logger.info(stats, 'storage cleanup removed files');
  return stats;
}

/** Runs the cleanup now and then every hour. */
export function startMaintenance(deps: Parameters<typeof runStorageCleanup>[0]) {
  const run = () =>
    runStorageCleanup(deps).catch((err: unknown) =>
      deps.logger.warn({ err }, 'storage cleanup failed'),
    );
  void run();
  const timer = setInterval(run, 60 * 60_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
