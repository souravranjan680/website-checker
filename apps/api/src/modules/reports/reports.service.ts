import type { Prisma, PrismaClient } from '@whc/db';
import {
  SEVERITIES,
  VIEWPORTS,
  WCAG_CRITERIA,
  type AccessibilityReportDto,
  type ManualCheckState,
  type PendingReportDto,
  type ReportScanInfo,
  type ResponsiveReportDto,
  type SeverityName,
  type UiHealthReportDto,
} from '@whc/shared';
import { MANUAL_CHECKLIST } from '@whc/shared';
import { AppError, notFound } from '../../lib/errors';
import type { AuthUser } from '../../types/express';
import { requireProjectRole } from '../projects/project-access';

const RANK: Record<SeverityName, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
const DESKTOP = '1920x1080';
/** UI checks that are about layout, shown per screen size in the Responsive report. */
export const LAYOUT_CHECKS = [
  'HORIZONTAL_SCROLL',
  'CONTENT_OVERFLOW',
  'OUT_OF_VIEWPORT',
  'TEXT_CLIPPING',
  'OVERLAPPING_ELEMENTS',
  'IMAGE_SIZING',
] as const;

export type ReportsService = ReturnType<typeof createReportsService>;

/**
 * Report endpoints aggregate one scan's saved issues in different ways.
 * Nothing is estimated: every number is counted from rows in the database.
 */
export function createReportsService({ prisma }: { prisma: PrismaClient }) {
  async function scanInfo(user: AuthUser, scanId: string, minimum: 'VIEWER' | 'EDITOR' = 'VIEWER') {
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      include: { website: { include: { project: { select: { id: true, name: true } } } } },
    });
    if (!scan) throw notFound('Scan');
    const { role } = await requireProjectRole(
      prisma,
      user,
      scan.website.projectId,
      minimum,
      'view reports',
    );
    const info: ReportScanInfo = {
      id: scan.id,
      status: scan.status,
      createdAt: scan.createdAt.toISOString(),
      finishedAt: scan.finishedAt?.toISOString() ?? null,
      durationMs: scan.durationMs,
      pagesScanned: scan.pagesScanned,
      previousScanId: scan.previousScanId,
      accessibilityScore: scan.accessibilityScore,
      uiHealthScore: scan.uiHealthScore,
      myRole: role,
      website: { id: scan.website.id, name: scan.website.name, baseUrl: scan.website.baseUrl },
      project: scan.website.project,
    };
    return { scan, info };
  }

  return {
    scanInfo,

    async accessibility(user: AuthUser, scanId: string): Promise<AccessibilityReportDto> {
      const { scan, info } = await scanInfo(user, scanId);
      const issues = await prisma.issue.findMany({
        where: { scanId, category: 'ACCESSIBILITY' },
        select: {
          ruleId: true,
          title: true,
          severity: true,
          pageUrl: true,
          accessibility: {
            select: { wcagCriteria: true, wcagLevel: true, helpUrl: true, detection: true },
          },
        },
      });
      const automated = issues.filter((i) => i.accessibility?.detection !== 'NEEDS_REVIEW');

      const severity = new Map<SeverityName, number>();
      const criteria = new Map<
        string,
        { level: string | null; issues: number; pages: Set<string> }
      >();
      const rules = new Map<
        string,
        {
          title: string;
          severity: SeverityName;
          issues: number;
          pages: Set<string>;
          wcag: Set<string>;
          helpUrl: string | null;
        }
      >();
      const pages = new Map<string, { issues: number; critical: number }>();

      for (const issue of automated) {
        const page = issue.pageUrl ?? '';
        severity.set(issue.severity, (severity.get(issue.severity) ?? 0) + 1);
        for (const criterion of issue.accessibility?.wcagCriteria ?? []) {
          const entry = criteria.get(criterion) ?? {
            level: issue.accessibility?.wcagLevel ?? null,
            issues: 0,
            pages: new Set(),
          };
          entry.issues += 1;
          entry.pages.add(page);
          criteria.set(criterion, entry);
        }
        const rule = rules.get(issue.ruleId) ?? {
          title: issue.title,
          severity: issue.severity,
          issues: 0,
          pages: new Set<string>(),
          wcag: new Set<string>(),
          helpUrl: issue.accessibility?.helpUrl ?? null,
        };
        rule.issues += 1;
        rule.pages.add(page);
        if (RANK[issue.severity] > RANK[rule.severity]) rule.severity = issue.severity;
        issue.accessibility?.wcagCriteria.forEach((c) => rule.wcag.add(c));
        rules.set(issue.ruleId, rule);
        const pageEntry = pages.get(page) ?? { issues: 0, critical: 0 };
        pageEntry.issues += 1;
        if (issue.severity === 'CRITICAL') pageEntry.critical += 1;
        pages.set(page, pageEntry);
      }

      // Every checklist item is listed, with its saved state (or "not checked yet").
      const saved = (scan.manualChecklist as Record<string, ManualCheckState> | null) ?? {};
      const checklist = Object.fromEntries(
        MANUAL_CHECKLIST.map((item) => [item.id, saved[item.id] ?? { status: null }]),
      );

      const criterionKey = (c: string) =>
        c
          .split('.')
          .map((n) => n.padStart(3, '0'))
          .join('.');
      return {
        scan: info,
        totals: {
          violations: automated.length,
          needsReview: issues.length - automated.length,
          rules: rules.size,
          pagesAffected: pages.size,
          pagesScanned: scan.pagesScanned,
        },
        severity: SEVERITIES.map((s) => ({ severity: s, count: severity.get(s) ?? 0 })),
        criteria: [...criteria.entries()]
          .map(([criterion, entry]) => ({
            criterion,
            name: WCAG_CRITERIA[criterion]?.name ?? null,
            level: WCAG_CRITERIA[criterion]?.level ?? entry.level,
            issues: entry.issues,
            pages: entry.pages.size,
          }))
          .sort((a, b) => criterionKey(a.criterion).localeCompare(criterionKey(b.criterion))),
        rules: [...rules.entries()]
          .map(([ruleId, r]) => ({
            ruleId,
            title: r.title,
            severity: r.severity,
            issues: r.issues,
            pages: r.pages.size,
            wcag: [...r.wcag],
            helpUrl: r.helpUrl,
          }))
          .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.issues - a.issues),
        pages: [...pages.entries()]
          .map(([url, p]) => ({ url, ...p }))
          .sort((a, b) => b.issues - a.issues),
        checklist,
      };
    },

    /** Saves one manual checklist answer on the scan (editors and owners). */
    async updateChecklist(
      user: AuthUser,
      scanId: string,
      input: { itemId: string; status: ManualCheckState['status']; note?: string },
    ): Promise<Record<string, ManualCheckState>> {
      if (!MANUAL_CHECKLIST.some((item) => item.id === input.itemId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown checklist item.', [
          { path: 'itemId', message: 'Unknown item.' },
        ]);
      }
      const { scan } = await scanInfo(user, scanId, 'EDITOR');
      const current = (scan.manualChecklist as Record<string, ManualCheckState> | null) ?? {};
      const next = {
        ...current,
        [input.itemId]: {
          status: input.status,
          note: input.note,
          by: user.name,
          at: new Date().toISOString(),
        },
      };
      await prisma.scan.update({
        where: { id: scanId },
        data: { manualChecklist: next as Prisma.InputJsonObject },
      });
      return next;
    },

    async uiHealth(user: AuthUser, scanId: string): Promise<UiHealthReportDto> {
      const { info } = await scanInfo(user, scanId);
      const [issues, pages, perPage] = await Promise.all([
        prisma.issue.findMany({
          where: { scanId, category: 'UI_HEALTH' },
          select: { severity: true, uiHealth: { select: { checkType: true } } },
        }),
        prisma.scanPage.findMany({
          where: { scanId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, url: true, status: true, consoleErrors: true, failedRequests: true },
        }),
        prisma.issue.groupBy({
          by: ['scanPageId'],
          where: { scanId, category: 'UI_HEALTH' },
          _count: { _all: true },
        }),
      ]);
      const checks = new Map<string, { count: number; highestSeverity: SeverityName }>();
      for (const issue of issues) {
        const type = issue.uiHealth?.checkType ?? 'OTHER';
        const entry = checks.get(type) ?? { count: 0, highestSeverity: issue.severity };
        entry.count += 1;
        if (RANK[issue.severity] > RANK[entry.highestSeverity])
          entry.highestSeverity = issue.severity;
        checks.set(type, entry);
      }
      const counts = new Map(perPage.map((row) => [row.scanPageId, row._count._all]));
      type Console = { text: string };
      type Failed = {
        url: string;
        resourceType: string;
        status?: number;
        error?: string;
        blockedByPolicy?: boolean;
      };
      const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

      return {
        scan: info,
        checks: [...checks.entries()]
          .map(([checkType, c]) => ({ checkType, ...c }))
          .sort((a, b) => RANK[b.highestSeverity] - RANK[a.highestSeverity] || b.count - a.count),
        consoleErrors: pages
          .flatMap((p) =>
            asArray<Console>(p.consoleErrors).map((c) => ({ pageUrl: p.url, text: c.text })),
          )
          .slice(0, 200),
        failedRequests: pages
          .flatMap((p) =>
            asArray<Failed>(p.failedRequests)
              .filter((f) => !f.blockedByPolicy)
              .map((f) => ({
                pageUrl: p.url,
                url: f.url,
                resourceType: f.resourceType,
                status: f.status ?? null,
                error: f.error ?? null,
              })),
          )
          .slice(0, 200),
        pages: pages.map((p) => ({
          url: p.url,
          status: p.status,
          consoleErrors: asArray(p.consoleErrors).length,
          failedRequests: asArray(p.failedRequests).length,
          issues: counts.get(p.id) ?? 0,
        })),
      };
    },

    /**
     * Results per screen size. The desktop column uses the layout checks of the main
     * (1920 px) crawl; the other four come from the responsive pass. When a previous
     * finished scan exists, issues are compared by identity (fingerprint) and
     * screenshots of the same page/size are paired for before-and-after.
     */
    async responsive(user: AuthUser, scanId: string): Promise<ResponsiveReportDto> {
      const { scan, info } = await scanInfo(user, scanId);
      const previous = scan.previousScanId
        ? await prisma.scan.findUnique({
            where: { id: scan.previousScanId },
            select: { id: true, createdAt: true },
          })
        : null;

      const layoutWhere = (id: string): Prisma.IssueWhereInput => ({
        scanId: id,
        OR: [
          { category: 'RESPONSIVE' },
          {
            category: 'UI_HEALTH',
            viewport: DESKTOP,
            uiHealth: { checkType: { in: [...LAYOUT_CHECKS] } },
          },
        ],
      });
      const [issues, previousIssues, pages, previousPages] = await Promise.all([
        prisma.issue.findMany({
          where: layoutWhere(scanId),
          select: { viewport: true, severity: true, fingerprint: true, scanPageId: true },
        }),
        previous
          ? prisma.issue.findMany({
              where: layoutWhere(previous.id),
              select: { viewport: true, fingerprint: true },
            })
          : Promise.resolve([]),
        prisma.scanPage.findMany({
          where: { scanId, status: 'DONE' },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            url: true,
            normalizedUrl: true,
            screenshots: {
              where: { kind: { in: ['PAGE_FULL', 'VIEWPORT'] } },
              select: { id: true, kind: true, viewport: true },
            },
          },
        }),
        previous
          ? prisma.scanPage.findMany({
              where: { scanId: previous.id, status: 'DONE' },
              select: {
                normalizedUrl: true,
                screenshots: {
                  where: { kind: { in: ['PAGE_FULL', 'VIEWPORT'] } },
                  select: { id: true, viewport: true },
                },
              },
            })
          : Promise.resolve([]),
      ]);
      const previousShot = new Map(
        previousPages.flatMap((p) =>
          p.screenshots.map((s) => [`${p.normalizedUrl}|${s.viewport}`, s.id] as const),
        ),
      );
      // Only pages that were actually tested at several sizes.
      const testedPages = pages.filter((p) => p.screenshots.some((s) => s.kind === 'VIEWPORT'));

      return {
        scan: info,
        previousScan: previous
          ? { id: previous.id, createdAt: previous.createdAt.toISOString() }
          : null,
        viewports: VIEWPORTS.map((v) => {
          const label = `${v.width}x${v.height}`;
          const mine = issues.filter((i) => i.viewport === label);
          const bySeverity: Partial<Record<SeverityName, number>> = {};
          for (const issue of mine)
            bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
          const current = new Set(mine.map((i) => i.fingerprint));
          const before = new Set(
            previousIssues.filter((i) => i.viewport === label).map((i) => i.fingerprint),
          );
          return {
            label,
            name: v.name,
            width: v.width,
            height: v.height,
            issues: mine.length,
            bySeverity,
            comparison: previous
              ? {
                  newIssues: [...current].filter((f) => !before.has(f)).length,
                  resolvedIssues: [...before].filter((f) => !current.has(f)).length,
                }
              : null,
            pages: testedPages.map((page) => ({
              pageId: page.id,
              url: page.url,
              screenshotId: page.screenshots.find((s) => s.viewport === label)?.id ?? null,
              previousScreenshotId: previousShot.get(`${page.normalizedUrl}|${label}`) ?? null,
              issues: mine.filter((i) => i.scanPageId === page.id).length,
            })),
          };
        }),
      };
    },

    /**
     * Performance, SEO and security: the scanners for these arrive in Phase 6.
     * We return whatever REAL rows exist (none yet) and say so plainly.
     */
    async pending(
      user: AuthUser,
      scanId: string,
      kind: 'performance' | 'seo' | 'security',
    ): Promise<PendingReportDto> {
      const { info } = await scanInfo(user, scanId);
      const results =
        kind === 'performance'
          ? await prisma.performanceResult.findMany({ where: { scanId } })
          : await prisma.issue.findMany({
              where: { scanId, category: kind === 'seo' ? 'SEO' : 'SECURITY' },
              take: 500,
            });
      const names = {
        performance: 'Performance (Lighthouse)',
        seo: 'SEO',
        security: 'Security headers',
      };
      return {
        scan: info,
        available: results.length > 0,
        plannedPhase: 6,
        message:
          results.length > 0
            ? `${names[kind]} results for this scan.`
            : `${names[kind]} checks are not part of the scanner yet (planned for Phase 6), so this scan has no ${names[kind].toLowerCase()} data. Nothing is estimated.`,
        results,
      };
    },
  };
}
