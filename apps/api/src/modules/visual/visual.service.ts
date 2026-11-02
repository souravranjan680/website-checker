import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@whc/db';
import type {
  CreateVisualBaselineInput,
  ScanVisualDto,
  VisualBaselineDto,
  VisualComparisonDto,
  VisualRegionDto,
} from '@whc/shared';
import { logActivity } from '../../lib/activity';
import { AppError, notFound } from '../../lib/errors';
import type { ExportJobs } from '../../lib/export-jobs';
import type { AuthUser } from '../../types/express';
import { requireProjectRole, visibleProjectsWhere } from '../projects/project-access';

type ComparisonRow = Prisma.VisualComparisonGetPayload<object>;

/** Database row → JSON. Details are written by the scanner (see apps/scanner/src/audits/visual.ts). */
export function toComparisonDto(row: ComparisonRow): VisualComparisonDto {
  const details = (row.details ?? {}) as {
    regions?: VisualRegionDto[];
    size?: VisualComparisonDto['size'] & { changed?: boolean };
    failPercent?: number;
  };
  return {
    id: row.id,
    scanId: row.scanId,
    status: row.status,
    passed: row.passed,
    diffPercent: row.diffPercent,
    diffPixels: row.diffPixels,
    totalPixels: row.totalPixels,
    currentScreenshotId: row.currentScreenshotId,
    diffScreenshotId: row.diffScreenshotId,
    regions: details.regions ?? [],
    sizeChanged: Boolean(details.size?.changed),
    size: details.size ? { baseline: details.size.baseline, current: details.size.current } : null,
    failPercent: details.failPercent ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Stored as one JSON list: [{ selector }] and [{ x, y, width, height }]. */
function splitIgnore(value: unknown): {
  ignoreSelectors: string[];
  ignoreRects: VisualRegionDto[];
} {
  const ignoreSelectors: string[] = [];
  const ignoreRects: VisualRegionDto[] = [];
  if (Array.isArray(value)) {
    for (const item of value as Record<string, unknown>[]) {
      if (typeof item?.selector === 'string') ignoreSelectors.push(item.selector);
      else if (typeof item?.x === 'number') ignoreRects.push(item as unknown as VisualRegionDto);
    }
  }
  return { ignoreSelectors, ignoreRects };
}
const joinIgnore = (selectors: string[], rects: VisualRegionDto[]): Prisma.InputJsonArray => [
  ...selectors.map((selector) => ({ selector })),
  ...rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
];

export type VisualService = ReturnType<typeof createVisualService>;

export function createVisualService({ prisma, jobs }: { prisma: PrismaClient; jobs: ExportJobs }) {
  async function websiteAccess(
    user: AuthUser,
    websiteId: string,
    minimum: 'VIEWER' | 'EDITOR',
    action: string,
  ) {
    const website = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { id: true, projectId: true, name: true },
    });
    if (!website) throw notFound('Website');
    const { role } = await requireProjectRole(prisma, user, website.projectId, minimum, action);
    return { website, role };
  }

  async function baselineAccess(user: AuthUser, baselineId: string, action: string) {
    const baseline = await prisma.visualBaseline.findUnique({
      where: { id: baselineId },
      include: { screenshot: true },
    });
    if (!baseline) throw notFound('Baseline');
    const { website } = await websiteAccess(user, baseline.websiteId, 'EDITOR', action);
    return { baseline, website };
  }

  /** The snapshot a user picked: must be a visual snapshot from a scan of THIS website. */
  async function snapshotFor(websiteId: string, screenshotId: string) {
    const shot = await prisma.screenshot.findUnique({
      where: { id: screenshotId },
      include: {
        scan: { select: { websiteId: true } },
        scanPage: { select: { normalizedUrl: true } },
      },
    });
    if (
      !shot ||
      shot.kind !== 'VISUAL_CURRENT' ||
      shot.scan?.websiteId !== websiteId ||
      !shot.scanPage ||
      !shot.viewport
    ) {
      throw new AppError(
        422,
        'INVALID_SNAPSHOT',
        'Choose a visual snapshot from a scan of this website.',
      );
    }
    return { shot, pageUrl: shot.scanPage.normalizedUrl, viewport: shot.viewport };
  }

  /** Copies the snapshot file (via the scanner) and creates the BASELINE screenshot row. */
  async function copyToBaseline(
    websiteId: string,
    shot: { storageKey: string; width: number; height: number; viewport: string | null },
  ) {
    const toKey = `baselines/${websiteId}/${randomUUID()}.png`;
    const { sizeBytes } = await jobs.copyBaseline(shot.storageKey, toKey);
    return prisma.screenshot.create({
      data: {
        kind: 'BASELINE',
        viewport: shot.viewport,
        width: shot.width,
        height: shot.height,
        storageKey: toKey,
        mimeType: 'image/png',
        sizeBytes,
      },
    });
  }

  const BASELINE_INCLUDE = {
    createdBy: { select: { id: true, name: true } },
    comparisons: { orderBy: { createdAt: 'desc' }, take: 1 },
    _count: { select: { comparisons: true } },
  } satisfies Prisma.VisualBaselineInclude;

  function toBaselineDto(
    row: Prisma.VisualBaselineGetPayload<{ include: typeof BASELINE_INCLUDE }>,
  ): VisualBaselineDto {
    return {
      id: row.id,
      websiteId: row.websiteId,
      pageUrl: row.pageUrl,
      viewport: row.viewport,
      screenshotId: row.screenshotId,
      failPercent: row.failPercent,
      ...splitIgnore(row.ignoreRegions),
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      latest: row.comparisons[0] ? toComparisonDto(row.comparisons[0]) : null,
      comparisons: row._count.comparisons,
    };
  }

  return {
    /** Every baseline the user can see, for the Visual regression page. */
    async listAll(user: AuthUser) {
      const rows = await prisma.visualBaseline.findMany({
        where: { website: { project: visibleProjectsWhere(user) } },
        orderBy: [{ updatedAt: 'desc' }],
        take: 200,
        include: {
          ...BASELINE_INCLUDE,
          website: { select: { id: true, name: true, baseUrl: true } },
        },
      });
      return rows.map((row) => ({ ...toBaselineDto(row), website: row.website }));
    },

    async listBaselines(user: AuthUser, websiteId: string) {
      const { role } = await websiteAccess(user, websiteId, 'VIEWER', 'view visual baselines');
      const rows = await prisma.visualBaseline.findMany({
        where: { websiteId },
        orderBy: [{ pageUrl: 'asc' }, { viewport: 'asc' }],
        include: BASELINE_INCLUDE,
      });
      return { baselines: rows.map(toBaselineDto), myRole: role };
    },

    /** Explicit user action: make a scan snapshot the baseline for its page + screen size. */
    async createBaseline(
      user: AuthUser,
      websiteId: string,
      input: CreateVisualBaselineInput,
    ): Promise<VisualBaselineDto> {
      const { website } = await websiteAccess(user, websiteId, 'EDITOR', 'manage visual baselines');
      const { shot, pageUrl, viewport } = await snapshotFor(websiteId, input.screenshotId);
      const existing = await prisma.visualBaseline.findUnique({
        where: { websiteId_pageUrl_viewport: { websiteId, pageUrl, viewport } },
        select: { id: true },
      });
      if (existing) {
        throw new AppError(
          409,
          'BASELINE_EXISTS',
          'This page and screen size already has a baseline. Use "Replace baseline" to change it.',
          [{ path: 'screenshotId', message: existing.id }],
        );
      }
      const copy = await copyToBaseline(websiteId, shot);
      const row = await prisma.visualBaseline.create({
        data: {
          websiteId,
          pageUrl,
          viewport,
          screenshotId: copy.id,
          failPercent: input.failPercent,
          ignoreRegions: joinIgnore(input.ignoreSelectors, input.ignoreRects),
          createdById: user.id,
        },
        include: BASELINE_INCLUDE,
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId: website.projectId,
        action: 'visual.baseline_created',
        entityType: 'VisualBaseline',
        entityId: row.id,
        metadata: { websiteId, pageUrl, viewport },
      });
      return toBaselineDto(row);
    },

    async updateBaseline(
      user: AuthUser,
      baselineId: string,
      input: { failPercent?: number; ignoreSelectors?: string[]; ignoreRects?: VisualRegionDto[] },
    ): Promise<VisualBaselineDto> {
      const { baseline, website } = await baselineAccess(
        user,
        baselineId,
        'manage visual baselines',
      );
      const current = splitIgnore(baseline.ignoreRegions);
      const row = await prisma.visualBaseline.update({
        where: { id: baselineId },
        data: {
          failPercent: input.failPercent,
          ignoreRegions: joinIgnore(
            input.ignoreSelectors ?? current.ignoreSelectors,
            input.ignoreRects ?? current.ignoreRects,
          ),
        },
        include: BASELINE_INCLUDE,
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId: website.projectId,
        action: 'visual.baseline_updated',
        entityType: 'VisualBaseline',
        entityId: baselineId,
        metadata: { websiteId: website.id },
      });
      return toBaselineDto(row);
    },

    /** Explicit user action: "accept this snapshot as the new baseline". */
    async replaceBaseline(
      user: AuthUser,
      baselineId: string,
      screenshotId: string,
    ): Promise<VisualBaselineDto> {
      const { baseline, website } = await baselineAccess(
        user,
        baselineId,
        'manage visual baselines',
      );
      const { shot, pageUrl, viewport } = await snapshotFor(baseline.websiteId, screenshotId);
      if (pageUrl !== baseline.pageUrl || viewport !== baseline.viewport) {
        throw new AppError(
          422,
          'INVALID_SNAPSHOT',
          'The snapshot must be of the same page and screen size as the baseline.',
        );
      }
      const copy = await copyToBaseline(baseline.websiteId, shot);
      // The old baseline image row is removed; its file is deleted by the scanner's storage cleanup.
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.visualBaseline.update({
          where: { id: baselineId },
          data: { screenshotId: copy.id },
          include: BASELINE_INCLUDE,
        });
        await tx.screenshot.delete({ where: { id: baseline.screenshotId } });
        return updated;
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId: website.projectId,
        action: 'visual.baseline_replaced',
        entityType: 'VisualBaseline',
        entityId: baselineId,
        metadata: { websiteId: website.id, pageUrl, viewport, fromScreenshotId: screenshotId },
      });
      return toBaselineDto(row);
    },

    async deleteBaseline(user: AuthUser, baselineId: string): Promise<void> {
      const { baseline, website } = await baselineAccess(
        user,
        baselineId,
        'manage visual baselines',
      );
      // Deleting the BASELINE image row also deletes the baseline and its comparisons (cascade).
      await prisma.screenshot.delete({ where: { id: baseline.screenshotId } });
      await logActivity(prisma, {
        userId: user.id,
        projectId: website.projectId,
        action: 'visual.baseline_deleted',
        entityType: 'VisualBaseline',
        entityId: baselineId,
        metadata: { websiteId: website.id, pageUrl: baseline.pageUrl, viewport: baseline.viewport },
      });
    },

    async comparisons(user: AuthUser, baselineId: string): Promise<VisualComparisonDto[]> {
      const baseline = await prisma.visualBaseline.findUnique({
        where: { id: baselineId },
        select: { websiteId: true },
      });
      if (!baseline) throw notFound('Baseline');
      await websiteAccess(user, baseline.websiteId, 'VIEWER', 'view visual baselines');
      const rows = await prisma.visualComparison.findMany({
        where: { baselineId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map(toComparisonDto);
    },

    /** Snapshots one scan took, with their baselines and comparison results. */
    async scanSnapshots(user: AuthUser, scanId: string): Promise<ScanVisualDto> {
      const scan = await prisma.scan.findUnique({
        where: { id: scanId },
        select: { id: true, websiteId: true, website: { select: { projectId: true } } },
      });
      if (!scan) throw notFound('Scan');
      const { role } = await requireProjectRole(
        prisma,
        user,
        scan.website.projectId,
        'VIEWER',
        'view reports',
      );
      const [shots, comparisons, baselines] = await Promise.all([
        prisma.screenshot.findMany({
          where: { scanId, kind: 'VISUAL_CURRENT' },
          orderBy: [{ createdAt: 'asc' }],
          include: { scanPage: { select: { url: true, normalizedUrl: true } } },
        }),
        prisma.visualComparison.findMany({ where: { scanId } }),
        prisma.visualBaseline.findMany({
          where: { websiteId: scan.websiteId },
          select: {
            id: true,
            pageUrl: true,
            viewport: true,
            screenshotId: true,
            failPercent: true,
          },
        }),
      ]);
      return {
        scanId: scan.id,
        websiteId: scan.websiteId,
        myRole: role,
        snapshots: shots.map((shot) => {
          const baseline = baselines.find(
            (b) => b.pageUrl === shot.scanPage?.normalizedUrl && b.viewport === shot.viewport,
          );
          const comparison = comparisons.find((c) => c.currentScreenshotId === shot.id);
          return {
            screenshotId: shot.id,
            pageUrl: shot.scanPage?.url ?? '',
            viewport: shot.viewport ?? '',
            width: shot.width,
            height: shot.height,
            baseline: baseline
              ? {
                  id: baseline.id,
                  screenshotId: baseline.screenshotId,
                  failPercent: baseline.failPercent,
                }
              : null,
            comparison: comparison ? toComparisonDto(comparison) : null,
          };
        }),
      };
    },
  };
}
