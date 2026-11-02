import type { Prisma, PrismaClient } from '@whc/db';
import {
  ACTIVE_SCAN_STATUSES,
  SEVERITIES,
  type IssueCategoryName,
  type IssueDto,
  type IssueRefDto,
  type Paginated,
  type ScanComparisonDto,
  type ScanDetailsDto,
  type ScanListItemDto,
  type ScanPageDto,
  type SeverityCounts,
  type StartScanInput,
} from '@whc/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { logActivity } from '../../lib/activity';
import { AppError, notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import type { ScanEventHub } from '../../lib/scan-events';
import type { ScanQueue } from '../../lib/scan-queue';
import type { AuthUser } from '../../types/express';
import { requireProjectRole, visibleProjectsWhere } from '../projects/project-access';
import type { issueListQuerySchema, scanListQuerySchema } from '@whc/shared';

type IssueQuery = z.output<typeof issueListQuerySchema>;
type ScanQuery = z.output<typeof scanListQuerySchema>;

export type ScansService = ReturnType<typeof createScansService>;

export function createScansService(deps: {
  prisma: PrismaClient;
  queue: ScanQueue;
  events: ScanEventHub;
  config: AppConfig;
}) {
  const { prisma, queue, events, config } = deps;

  /** Loads a scan the user may see (404 otherwise) and checks the minimum role. */
  async function loadScan(
    user: AuthUser,
    scanId: string,
    minimum: 'VIEWER' | 'EDITOR',
    action: string,
  ) {
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      include: {
        website: { include: { project: { select: { id: true, name: true } } } },
        triggeredBy: { select: { id: true, name: true } },
      },
    });
    if (!scan) throw notFound('Scan');
    const { role } = await requireProjectRole(
      prisma,
      user,
      scan.website.projectId,
      minimum,
      action,
    );
    return { scan, role };
  }

  async function details(user: AuthUser, scanId: string): Promise<ScanDetailsDto> {
    const { scan, role } = await loadScan(user, scanId, 'VIEWER', 'view scans');
    const [bySeverity, byCategory] = await Promise.all([
      prisma.issue.groupBy({ by: ['severity'], where: { scanId }, _count: { _all: true } }),
      prisma.issue.groupBy({ by: ['category'], where: { scanId }, _count: { _all: true } }),
    ]);
    const severityCounts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as SeverityCounts;
    for (const row of bySeverity) severityCounts[row.severity] = row._count._all;
    const categoryCounts: Partial<Record<IssueCategoryName, number>> = {};
    for (const row of byCategory) categoryCounts[row.category] = row._count._all;

    return {
      id: scan.id,
      status: scan.status,
      trigger: scan.trigger,
      mode: scan.mode,
      progress: scan.progress,
      currentStep: scan.currentStep,
      pagesDiscovered: scan.pagesDiscovered,
      pagesScanned: scan.pagesScanned,
      pagesFailed: scan.pagesFailed,
      errorMessage: scan.errorMessage,
      accessibilityScore: scan.accessibilityScore,
      uiHealthScore: scan.uiHealthScore,
      totalIssues: Object.values(severityCounts).reduce((a, b) => a + b, 0),
      severityCounts,
      categoryCounts,
      queuedAt: scan.queuedAt.toISOString(),
      startedAt: scan.startedAt?.toISOString() ?? null,
      finishedAt: scan.finishedAt?.toISOString() ?? null,
      durationMs: scan.durationMs,
      previousScanId: scan.previousScanId,
      myRole: role,
      website: {
        id: scan.website.id,
        name: scan.website.name,
        baseUrl: scan.website.baseUrl,
        projectId: scan.website.project.id,
        projectName: scan.website.project.name,
      },
      triggeredBy: scan.triggeredBy,
    };
  }

  async function start(
    user: AuthUser,
    input: StartScanInput,
    trigger: 'MANUAL' | 'RESCAN' = 'MANUAL',
  ): Promise<ScanDetailsDto> {
    const website = await prisma.website.findUnique({ where: { id: input.websiteId } });
    if (!website) throw notFound('Website');
    await requireProjectRole(prisma, user, website.projectId, 'EDITOR', 'start scans');

    if (
      config.scans.requireDomainVerification &&
      website.verificationStatus !== 'VERIFIED' &&
      input.mode === 'CRAWL'
    ) {
      throw new AppError(
        403,
        'VERIFICATION_REQUIRED',
        'Verify the domain before crawling it. Single-page scans are allowed.',
      );
    }
    const running = await prisma.scan.findFirst({
      where: { websiteId: website.id, status: { in: [...ACTIVE_SCAN_STATUSES] } },
      select: { id: true },
    });
    if (running) {
      throw new AppError(
        409,
        'SCAN_ALREADY_RUNNING',
        'A scan of this website is already queued or running.',
        {
          scanId: running.id,
        },
      );
    }
    const myActive = await prisma.scan.count({
      where: { triggeredById: user.id, status: { in: [...ACTIVE_SCAN_STATUSES] } },
    });
    if (myActive >= config.scans.maxActivePerUser) {
      throw new AppError(
        429,
        'TOO_MANY_ACTIVE_SCANS',
        `You can run at most ${config.scans.maxActivePerUser} scans at the same time.`,
      );
    }

    const scan = await prisma.scan.create({
      data: {
        websiteId: website.id,
        triggeredById: user.id,
        trigger,
        mode: input.mode,
        status: 'QUEUED',
        currentStep: 'Waiting in the queue',
        // Snapshot of the settings used, so old results stay explainable after edits.
        config: {
          baseUrl: website.baseUrl,
          maxDepth: website.maxDepth,
          maxPages: website.maxPages,
          includePatterns: website.includePatterns,
          excludePatterns: website.excludePatterns,
          respectRobotsTxt: website.respectRobotsTxt,
          responsivePageLimit: website.responsivePageLimit,
        } satisfies Prisma.InputJsonObject,
      },
    });

    try {
      await queue.enqueue(scan.id);
    } catch {
      await prisma.scan.update({
        where: { id: scan.id },
        data: {
          status: 'FAILED',
          errorMessage: 'The scan could not be queued. Please try again.',
          finishedAt: new Date(),
        },
      });
      throw new AppError(
        503,
        'QUEUE_UNAVAILABLE',
        'The scan queue is unavailable right now. Please try again in a moment.',
      );
    }

    await logActivity(prisma, {
      userId: user.id,
      projectId: website.projectId,
      action: trigger === 'RESCAN' ? 'scan.rescanned' : 'scan.started',
      entityType: 'Scan',
      entityId: scan.id,
      metadata: { website: website.name, mode: input.mode },
    });
    return details(user, scan.id);
  }

  return {
    details,
    start,

    async list(user: AuthUser, query: ScanQuery): Promise<Paginated<ScanListItemDto>> {
      const where: Prisma.ScanWhereInput = {
        website: { project: visibleProjectsWhere(user) },
        ...(query.websiteId ? { websiteId: query.websiteId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              website: {
                project: visibleProjectsWhere(user),
                name: { contains: query.q, mode: 'insensitive' },
              },
            }
          : {}),
      };
      const [total, scans] = await Promise.all([
        prisma.scan.count({ where }),
        prisma.scan.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
          include: { website: { select: { id: true, name: true, baseUrl: true } } },
        }),
      ]);
      return {
        data: scans.map((s) => ({
          id: s.id,
          status: s.status,
          trigger: s.trigger,
          mode: s.mode,
          progress: s.progress,
          totalIssues: s.totalIssues,
          criticalCount: s.criticalCount,
          highCount: s.highCount,
          accessibilityScore: s.accessibilityScore,
          uiHealthScore: s.uiHealthScore,
          pagesScanned: s.pagesScanned,
          createdAt: s.createdAt.toISOString(),
          finishedAt: s.finishedAt?.toISOString() ?? null,
          durationMs: s.durationMs,
          website: s.website,
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async rescan(user: AuthUser, scanId: string): Promise<ScanDetailsDto> {
      const { scan } = await loadScan(user, scanId, 'EDITOR', 'start scans');
      return start(
        user,
        { websiteId: scan.websiteId, mode: scan.mode === 'SINGLE_PAGE' ? 'SINGLE_PAGE' : 'CRAWL' },
        'RESCAN',
      );
    },

    /**
     * Queued: removed from the queue and marked CANCELLED at once.
     * Running: marked CANCELLING and the worker is told via Redis; it closes the
     * browser and sets CANCELLED itself.
     */
    async cancel(user: AuthUser, scanId: string): Promise<ScanDetailsDto> {
      const { scan } = await loadScan(user, scanId, 'EDITOR', 'cancel scans');
      if (scan.status === 'QUEUED') {
        const updated = await prisma.scan.updateMany({
          where: { id: scanId, status: 'QUEUED' },
          data: { status: 'CANCELLED', finishedAt: new Date(), currentStep: 'Cancelled' },
        });
        if (updated.count === 1) {
          await queue.remove(scanId);
          await events.publish({
            type: 'finished',
            scanId,
            status: 'CANCELLED',
            at: new Date().toISOString(),
          });
        } else {
          await this.cancel(user, scanId); // it started meanwhile: cancel it as a running scan
          return details(user, scanId);
        }
      } else if (scan.status === 'RUNNING') {
        await prisma.scan.update({
          where: { id: scanId },
          data: { status: 'CANCELLING', currentStep: 'Cancelling' },
        });
        await events.requestCancel(scanId);
      } else if (scan.status !== 'CANCELLING') {
        throw new AppError(422, 'INVALID_STATE', 'This scan has already finished.');
      }
      await logActivity(prisma, {
        userId: user.id,
        projectId: scan.website.projectId,
        action: 'scan.cancelled',
        entityType: 'Scan',
        entityId: scanId,
      });
      return details(user, scanId);
    },

    async pages(user: AuthUser, scanId: string): Promise<ScanPageDto[]> {
      await loadScan(user, scanId, 'VIEWER', 'view scans');
      const [pages, issueCounts] = await Promise.all([
        prisma.scanPage.findMany({
          where: { scanId },
          orderBy: { createdAt: 'asc' },
          include: {
            screenshots: {
              where: { kind: { in: ['PAGE_FULL', 'VIEWPORT'] } },
              select: { id: true, kind: true, viewport: true, width: true, height: true },
            },
          },
        }),
        prisma.issue.groupBy({ by: ['scanPageId'], where: { scanId }, _count: { _all: true } }),
      ]);
      const counts = new Map(issueCounts.map((c) => [c.scanPageId, c._count._all]));
      return pages.map((p) => ({
        id: p.id,
        url: p.url,
        depth: p.depth,
        status: p.status,
        httpStatus: p.httpStatus,
        title: p.title,
        loadTimeMs: p.loadTimeMs,
        errorMessage: p.errorMessage,
        consoleErrorCount: Array.isArray(p.consoleErrors) ? p.consoleErrors.length : 0,
        failedRequestCount: Array.isArray(p.failedRequests) ? p.failedRequests.length : 0,
        issueCount: counts.get(p.id) ?? 0,
        screenshots: p.screenshots,
      }));
    },

    async issues(user: AuthUser, scanId: string, query: IssueQuery): Promise<Paginated<IssueDto>> {
      await loadScan(user, scanId, 'VIEWER', 'view scans');
      const where: Prisma.IssueWhereInput = {
        scanId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.viewport ? { viewport: query.viewport } : {}),
        ...(query.pageId ? { scanPageId: query.pageId } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { ruleId: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.issue.count({ where }),
        prisma.issue.findMany({
          where,
          // Severity enum order is CRITICAL → INFO, so "asc" lists the worst first.
          orderBy: [{ severity: 'asc' }, { ruleId: 'asc' }, { createdAt: 'asc' }],
          ...toSkipTake(query.page, query.pageSize),
          include: {
            accessibility: true,
            uiHealth: true,
            trackedIssue: {
              select: { id: true, status: true, occurrenceCount: true, firstSeenAt: true },
            },
            scanPage: {
              select: {
                screenshots: {
                  where: { kind: { in: ['PAGE_FULL', 'VIEWPORT'] } },
                  select: { id: true, kind: true, viewport: true },
                },
              },
            },
          },
        }),
      ]);

      const data: IssueDto[] = rows.map((row) => {
        const shots = row.scanPage?.screenshots ?? [];
        const pageShot =
          shots.find((s) => s.kind === 'VIEWPORT' && s.viewport === row.viewport) ??
          shots.find((s) => s.kind === 'PAGE_FULL');
        return {
          id: row.id,
          category: row.category,
          severity: row.severity,
          ruleId: row.ruleId,
          title: row.title,
          description: row.description,
          pageId: row.scanPageId,
          pageUrl: row.pageUrl,
          viewport: row.viewport,
          selector: row.selector,
          htmlSnippet: row.htmlSnippet,
          boundingBox: (row.boundingBox as IssueDto['boundingBox']) ?? null,
          suggestedFix: row.suggestedFix,
          details: (row.details as Record<string, unknown> | null) ?? null,
          fingerprint: row.fingerprint,
          screenshotId: row.screenshotId,
          pageScreenshotId: pageShot?.id ?? null,
          createdAt: row.createdAt.toISOString(),
          tracked: row.trackedIssue
            ? { ...row.trackedIssue, firstSeenAt: row.trackedIssue.firstSeenAt.toISOString() }
            : null,
          accessibility: row.accessibility
            ? {
                axeRuleId: row.accessibility.axeRuleId,
                impact: row.accessibility.impact,
                wcagCriteria: row.accessibility.wcagCriteria,
                wcagLevel: row.accessibility.wcagLevel,
                helpUrl: row.accessibility.helpUrl,
                detection: row.accessibility.detection,
              }
            : null,
          uiHealth: row.uiHealth
            ? {
                checkType: row.uiHealth.checkType,
                resourceUrl: row.uiHealth.resourceUrl,
                statusCode: row.uiHealth.statusCode,
              }
            : null,
        };
      });
      return { data, meta: pageMeta(query.page, query.pageSize, total) };
    },

    /** New / resolved / recurring issues between this scan and another (default: the previous one). */
    async compare(user: AuthUser, scanId: string, otherId?: string): Promise<ScanComparisonDto> {
      const { scan } = await loadScan(user, scanId, 'VIEWER', 'view scans');
      const compareWith = otherId ?? scan.previousScanId;
      if (compareWith) {
        const other = await prisma.scan.findUnique({
          where: { id: compareWith },
          select: { websiteId: true },
        });
        if (!other || other.websiteId !== scan.websiteId) throw notFound('Scan to compare with');
      }
      const select = {
        fingerprint: true,
        title: true,
        severity: true,
        category: true,
        ruleId: true,
        pageUrl: true,
        viewport: true,
      } as const;
      const [current, previous] = await Promise.all([
        prisma.issue.findMany({ where: { scanId }, select }),
        compareWith
          ? prisma.issue.findMany({ where: { scanId: compareWith }, select })
          : Promise.resolve([]),
      ]);
      const previousSet = new Set(previous.map((i) => i.fingerprint));
      const currentSet = new Set(current.map((i) => i.fingerprint));
      const newIssues: IssueRefDto[] = compareWith
        ? current.filter((i) => !previousSet.has(i.fingerprint))
        : current;
      const recurringIssues: IssueRefDto[] = current.filter((i) => previousSet.has(i.fingerprint));
      const resolvedIssues: IssueRefDto[] = previous.filter((i) => !currentSet.has(i.fingerprint));
      return {
        scanId,
        comparedWithScanId: compareWith ?? null,
        newIssues,
        resolvedIssues,
        recurringIssues,
        counts: {
          new: newIssues.length,
          resolved: resolvedIssues.length,
          recurring: recurringIssues.length,
        },
      };
    },
  };
}
