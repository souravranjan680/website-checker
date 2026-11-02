import { Prisma, type PrismaClient } from '@whc/db';
import {
  SEVERITIES,
  type DashboardQuery,
  type DashboardSummaryDto,
  type DashboardTrendPoint,
  type DashboardTrendsDto,
  type IssueCategoryName,
} from '@whc/shared';
import type { AuthUser } from '../../types/express';
import { visibleProjectsWhere } from '../projects/project-access';

const DAY = 86_400_000;

/** Default range: the last 30 days (whole UTC days). At most 366 days. */
export function resolveRange(query: { from?: Date; to?: Date }): { from: Date; to: Date } {
  const to = new Date(query.to ?? new Date());
  to.setUTCHours(23, 59, 59, 999);
  let from = new Date(query.from ?? to.getTime() - 29 * DAY);
  from.setUTCHours(0, 0, 0, 0);
  if (to.getTime() - from.getTime() > 366 * DAY) from = new Date(to.getTime() - 365 * DAY);
  if (from > to) from = new Date(to.getTime() - 29 * DAY);
  return { from, to };
}

/** "YYYY-MM-DD" for every UTC day in the range (so charts show days with zero activity). */
export function daysBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (
    let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    t <= to.getTime();
    t += DAY
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

const average = (values: (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null);
  return real.length ? Math.round(real.reduce((a, b) => a + b, 0) / real.length) : null;
};

export type DashboardService = ReturnType<typeof createDashboardService>;

export function createDashboardService({ prisma }: { prisma: PrismaClient }) {
  /** IDs of the websites the user may see, narrowed by the project/website filters. */
  async function websiteIds(user: AuthUser, query: DashboardQuery): Promise<string[]> {
    const websites = await prisma.website.findMany({
      where: {
        project: visibleProjectsWhere(user),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.websiteId ? { id: query.websiteId } : {}),
      },
      select: { id: true },
    });
    return websites.map((w) => w.id);
  }

  /** Each website's most recent finished scan (one indexed DISTINCT ON query). */
  async function latestFinishedScanIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON ("websiteId") id
      FROM "Scan"
      WHERE "websiteId" = ANY(${ids}) AND status IN ('COMPLETED', 'PARTIAL')
      ORDER BY "websiteId", "createdAt" DESC`;
    return rows.map((r) => r.id);
  }

  return {
    async summary(user: AuthUser, query: DashboardQuery): Promise<DashboardSummaryDto> {
      const range = resolveRange(query);
      const ids = await websiteIds(user, query);
      const inSites = { websiteId: { in: ids } };
      const scanWhere: Prisma.ScanWhereInput = {
        ...inSites,
        createdAt: { gte: range.from, lte: range.to },
        ...(query.status ? { status: query.status } : {}),
      };
      const visibleProjects = await prisma.project.findMany({
        where: {
          ...visibleProjectsWhere(user),
          ...(query.projectId ? { id: query.projectId } : {}),
        },
        select: { id: true },
      });

      const [
        scans,
        openIssues,
        resolvedIssues,
        bySeverity,
        byCategory,
        latestIds,
        recentScans,
        recentWebsites,
        activity,
      ] = await Promise.all([
        prisma.scan.count({ where: scanWhere }),
        prisma.trackedIssue.count({ where: { ...inSites, status: 'OPEN' } }),
        prisma.trackedIssue.count({
          where: { ...inSites, status: 'RESOLVED', resolvedAt: { gte: range.from, lte: range.to } },
        }),
        prisma.trackedIssue.groupBy({
          by: ['severity'],
          where: { ...inSites, status: 'OPEN' },
          _count: { _all: true },
        }),
        prisma.trackedIssue.groupBy({
          by: ['category'],
          where: { ...inSites, status: 'OPEN' },
          _count: { _all: true },
        }),
        latestFinishedScanIds(ids),
        prisma.scan.findMany({
          where: scanWhere,
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: {
            id: true,
            status: true,
            createdAt: true,
            durationMs: true,
            totalIssues: true,
            accessibilityScore: true,
            website: { select: { id: true, name: true } },
          },
        }),
        prisma.website.findMany({
          where: { id: { in: ids } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            project: { select: { name: true } },
            scans: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, status: true, createdAt: true, accessibilityScore: true },
            },
          },
        }),
        prisma.activityLog.findMany({
          where: {
            projectId: { in: visibleProjects.map((p) => p.id) },
            createdAt: { gte: range.from, lte: range.to },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: { user: { select: { id: true, name: true } } },
        }),
      ]);

      const [latestScores, perfAvg, openPerWebsite] = await Promise.all([
        prisma.scan.findMany({
          where: { id: { in: latestIds } },
          select: { accessibilityScore: true, uiHealthScore: true },
        }),
        prisma.performanceResult.aggregate({
          where: { scanId: { in: latestIds } },
          _avg: { performanceScore: true },
        }),
        prisma.trackedIssue.groupBy({
          by: ['websiteId'],
          where: { websiteId: { in: recentWebsites.map((w) => w.id) }, status: 'OPEN' },
          _count: { _all: true },
        }),
      ]);
      const openMap = new Map(openPerWebsite.map((row) => [row.websiteId, row._count._all]));
      const severityMap = new Map(bySeverity.map((row) => [row.severity, row._count._all]));

      return {
        range: { from: range.from.toISOString(), to: range.to.toISOString() },
        totals: {
          projects: visibleProjects.length,
          websites: ids.length,
          scans,
          openIssues,
          criticalIssues: severityMap.get('CRITICAL') ?? 0,
          highIssues: severityMap.get('HIGH') ?? 0,
          resolvedIssues,
        },
        scores: {
          accessibility: average(latestScores.map((s) => s.accessibilityScore)),
          uiHealth: average(latestScores.map((s) => s.uiHealthScore)),
          performance:
            perfAvg._avg.performanceScore === null
              ? null
              : Math.round(perfAvg._avg.performanceScore),
          websitesMeasured: latestScores.length,
        },
        openBySeverity: SEVERITIES.map((severity) => ({
          severity,
          count: severityMap.get(severity) ?? 0,
        })),
        openByCategory: byCategory
          .map((row) => ({ category: row.category as IssueCategoryName, count: row._count._all }))
          .sort((a, b) => b.count - a.count),
        recentScans: recentScans.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
        })),
        recentWebsites: recentWebsites.map((w) => ({
          id: w.id,
          name: w.name,
          baseUrl: w.baseUrl,
          projectName: w.project.name,
          openIssues: openMap.get(w.id) ?? 0,
          lastScan: w.scans[0]
            ? { ...w.scans[0], createdAt: w.scans[0].createdAt.toISOString() }
            : null,
        })),
        recentActivity: activity.map((a) => ({
          id: a.id,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          metadata: (a.metadata as Record<string, unknown> | null) ?? null,
          user: a.user,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },

    /** Day-by-day series for the charts, computed by PostgreSQL (GROUP BY day). */
    async trends(user: AuthUser, query: DashboardQuery): Promise<DashboardTrendsDto> {
      const range = resolveRange(query);
      const ids = await websiteIds(user, query);
      const days = daysBetween(range.from, range.to);
      const empty = (date: string): DashboardTrendPoint => ({
        date,
        completed: 0,
        partial: 0,
        failed: 0,
        cancelled: 0,
        other: 0,
        accessibilityScore: null,
        uiHealthScore: null,
        newIssues: 0,
        resolvedIssues: 0,
      });
      const points = new Map(days.map((d) => [d, empty(d)]));
      if (ids.length > 0) {
        const statusFilter = query.status
          ? Prisma.sql`AND status::text = ${query.status}`
          : Prisma.empty;
        const [scanRows, newRows, resolvedRows] = await Promise.all([
          prisma.$queryRaw<
            {
              day: string;
              completed: number;
              partial: number;
              failed: number;
              cancelled: number;
              other: number;
              a11y: number | null;
              ui: number | null;
            }[]
          >`
            SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
                   count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
                   count(*) FILTER (WHERE status = 'PARTIAL')::int AS partial,
                   count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                   count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
                   count(*) FILTER (WHERE status IN ('QUEUED', 'RUNNING', 'CANCELLING'))::int AS other,
                   avg("accessibilityScore") FILTER (WHERE status IN ('COMPLETED', 'PARTIAL'))::float AS a11y,
                   avg("uiHealthScore") FILTER (WHERE status IN ('COMPLETED', 'PARTIAL'))::float AS ui
            FROM "Scan"
            WHERE "websiteId" = ANY(${ids}) AND "createdAt" BETWEEN ${range.from} AND ${range.to} ${statusFilter}
            GROUP BY 1`,
          prisma.$queryRaw<{ day: string; n: number }[]>`
            SELECT to_char(date_trunc('day', "firstSeenAt"), 'YYYY-MM-DD') AS day, count(*)::int AS n
            FROM "TrackedIssue"
            WHERE "websiteId" = ANY(${ids}) AND "firstSeenAt" BETWEEN ${range.from} AND ${range.to}
            GROUP BY 1`,
          prisma.$queryRaw<{ day: string; n: number }[]>`
            SELECT to_char(date_trunc('day', "resolvedAt"), 'YYYY-MM-DD') AS day, count(*)::int AS n
            FROM "TrackedIssue"
            WHERE "websiteId" = ANY(${ids}) AND status = 'RESOLVED' AND "resolvedAt" BETWEEN ${range.from} AND ${range.to}
            GROUP BY 1`,
        ]);
        for (const row of scanRows) {
          const point = points.get(row.day);
          if (!point) continue;
          Object.assign(point, {
            completed: row.completed,
            partial: row.partial,
            failed: row.failed,
            cancelled: row.cancelled,
            other: row.other,
            accessibilityScore: row.a11y === null ? null : Math.round(row.a11y),
            uiHealthScore: row.ui === null ? null : Math.round(row.ui),
          });
        }
        for (const row of newRows) {
          const point = points.get(row.day);
          if (point) point.newIssues = row.n;
        }
        for (const row of resolvedRows) {
          const point = points.get(row.day);
          if (point) point.resolvedIssues = row.n;
        }
      }
      return {
        range: { from: range.from.toISOString(), to: range.to.toISOString() },
        points: [...points.values()],
      };
    },
  };
}
