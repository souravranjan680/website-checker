import { Prisma, type PrismaClient } from '@whc/db';
import {
  SEVERITIES,
  VIEWPORTS,
  WCAG_CRITERIA,
  type AccessibilityReportDto,
  type FunctionalReportDto,
  type ConsoleKindName,
  type ManualCheckState,
  type PerformanceReportDto,
  type ReportScanInfo,
  type ResourceVerdictName,
  type ResponsiveReportDto,
  type SecurityFindingLevel,
  type SecurityReportDto,
  type SeoReportDto,
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

/** Checks of Phase 9, Milestone 2, by group (none of them counts towards a score). */
const EXTRA_CHECK_GROUPS = {
  layout: [
    'TEXT_OVERFLOW_VISIBLE',
    'TEXT_OVERLAP',
    'FIXED_OUT_OF_VIEWPORT',
    'CONTROL_LABEL_CLIPPED',
  ],
  fontsAndIcons: ['FONT_LOAD_FAILED', 'FONT_FALLBACK_RENDERED', 'ICON_BROKEN', 'ICON_MISSING'],
  consistency: ['COMPONENT_INCONSISTENT'],
} as const;
const EXTRA_CHECKS = Object.values(EXTRA_CHECK_GROUPS).flat();

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
      performanceScore: scan.performanceScore,
      seoScore: scan.seoScore,
      securityScore: scan.securityScore,
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
      /** Milestone 2 checks at every screen size (the desktop list above is unchanged). */
      async function extraChecksSummary(id: string): Promise<UiHealthReportDto['extraChecks']> {
        const [extra, consistencyPages] = await Promise.all([
          prisma.issue.findMany({
            where: {
              scanId: id,
              category: { in: ['UI_HEALTH', 'RESPONSIVE'] },
              uiHealth: { checkType: { in: [...EXTRA_CHECKS] } },
            },
            select: { classification: true, uiHealth: { select: { checkType: true } } },
          }),
          prisma.scanPage.count({ where: { scanId: id, components: { not: Prisma.AnyNull } } }),
        ]);
        const inGroup = (group: readonly string[]) =>
          extra.filter((i) => group.includes(i.uiHealth?.checkType ?? '')).length;
        const byClassification: UiHealthReportDto['extraChecks']['byClassification'] = {};
        for (const issue of extra) {
          byClassification[issue.classification] =
            (byClassification[issue.classification] ?? 0) + 1;
        }
        return {
          layout: inGroup(EXTRA_CHECK_GROUPS.layout),
          fontsAndIcons: inGroup(EXTRA_CHECK_GROUPS.fontsAndIcons),
          consistency: inGroup(EXTRA_CHECK_GROUPS.consistency),
          consistencyPages,
          byClassification,
        };
      }

      const { info, scan } = await scanInfo(user, scanId);
      const [issues, pages, perPage] = await Promise.all([
        prisma.issue.findMany({
          where: { scanId, category: 'UI_HEALTH' },
          select: { severity: true, uiHealth: { select: { checkType: true } } },
        }),
        prisma.scanPage.findMany({
          where: { scanId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            url: true,
            status: true,
            consoleErrors: true,
            pageErrors: true,
            failedRequests: true,
          },
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
      type Related = { url: string; status: number | null; relation: 'mentioned' | 'same-service' };
      type Console = {
        text?: string;
        message?: string;
        level?: 'error' | 'warning';
        kind?: ConsoleKindName;
        source?: string;
        line?: number;
        column?: number;
        related?: Related[];
      };
      type Failed = {
        url: string;
        resourceType: string;
        status?: number;
        error?: string;
        blockedByPolicy?: boolean;
        verdict?: ResourceVerdictName;
        verdictReason?: string;
      };
      const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

      // The same message from the same script is one row, however many pages logged it.
      const consoleRows = new Map<string, UiHealthReportDto['consoleErrors'][number]>();
      for (const page of pages) {
        const entries = [
          ...asArray<Console>(page.consoleErrors).map((c) => ({ ...c, level: c.level ?? 'error' })),
          ...asArray<Console>(page.pageErrors).map((c) => ({ ...c, level: 'exception' as const })),
        ];
        for (const entry of entries) {
          const text = entry.text ?? entry.message ?? '';
          const key = [entry.level, text, entry.source ?? ''].join('|');
          const row = consoleRows.get(key);
          if (row) {
            row.occurrences += 1;
            if (
              row.pageUrl !== page.url &&
              !row.otherPages.includes(page.url) &&
              row.otherPages.length < 5
            ) {
              row.otherPages.push(page.url);
            }
            continue;
          }
          if (consoleRows.size >= 200) continue;
          consoleRows.set(key, {
            pageUrl: page.url,
            otherPages: [],
            occurrences: 1,
            level: entry.level,
            kind: entry.kind ?? null,
            text,
            source: entry.source ?? null,
            line: entry.line ?? null,
            column: entry.column ?? null,
            related: (entry.related ?? []).map((r) => ({
              url: r.url,
              status: r.status ?? null,
              relation: r.relation,
            })),
          });
        }
      }
      const linkSummary =
        (scan.siteChecks as { links?: UiHealthReportDto['links'] } | null)?.links ?? null;

      return {
        scan: info,
        checks: [...checks.entries()]
          .map(([checkType, c]) => ({ checkType, ...c }))
          .sort((a, b) => RANK[b.highestSeverity] - RANK[a.highestSeverity] || b.count - a.count),
        consoleErrors: [...consoleRows.values()],
        failedRequests: pages
          .flatMap((p) =>
            asArray<Failed>(p.failedRequests).map((f) => ({
              pageUrl: p.url,
              url: f.url,
              resourceType: f.resourceType,
              status: f.status ?? null,
              error: f.error ?? null,
              verdict: f.verdict ?? (f.blockedByPolicy ? 'BLOCKED_BY_POLICY' : null),
              verdictReason: f.verdictReason ?? null,
            })),
          )
          .slice(0, 200),
        links: linkSummary,
        pages: pages.map((p) => ({
          url: p.url,
          status: p.status,
          consoleErrors: asArray(p.consoleErrors).length,
          failedRequests: asArray(p.failedRequests).length,
          issues: counts.get(p.id) ?? 0,
        })),
        extraChecks: await extraChecksSummary(scanId),
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

    /** On-page SEO: checks found, robots.txt/sitemap facts and each page's metadata. */
    async seo(user: AuthUser, scanId: string): Promise<SeoReportDto> {
      const { scan, info } = await scanInfo(user, scanId);
      const [issues, pages] = await Promise.all([
        prisma.issue.findMany({
          where: { scanId, category: 'SEO' },
          select: {
            severity: true,
            ruleId: true,
            title: true,
            scanPageId: true,
            seo: { select: { checkType: true } },
          },
        }),
        prisma.scanPage.findMany({
          where: { scanId, status: 'DONE' },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            url: true,
            title: true,
            metaDescription: true,
            canonicalUrl: true,
            h1Count: true,
            seoData: true,
            responseHeaders: true,
          },
        }),
      ]);

      const checks = new Map<string, SeoReportDto['checks'][number]>();
      const perPage = new Map<string, number>();
      for (const issue of issues) {
        const type = issue.seo?.checkType ?? 'OTHER';
        const entry = checks.get(type) ?? {
          checkType: type,
          ruleId: issue.ruleId,
          title: issue.title,
          count: 0,
          highestSeverity: issue.severity,
        };
        entry.count += 1;
        if (RANK[issue.severity] > RANK[entry.highestSeverity])
          entry.highestSeverity = issue.severity;
        checks.set(type, entry);
        if (issue.scanPageId)
          perPage.set(issue.scanPageId, (perPage.get(issue.scanPageId) ?? 0) + 1);
      }

      const siteChecks = (scan.siteChecks as { seo?: SeoReportDto['site'] } | null)?.seo ?? null;
      return {
        scan: info,
        site: siteChecks,
        checks: [...checks.values()].sort(
          (a, b) =>
            RANK[b.highestSeverity] - RANK[a.highestSeverity] ||
            b.count - a.count ||
            a.title.localeCompare(b.title),
        ),
        pages: pages.map((page) => {
          const data = page.seoData as {
            metaRobots?: string | null;
            ogTitle?: string | null;
            ogDescription?: string | null;
            ogImage?: string | null;
            imagesWithoutAlt?: number;
          } | null;
          const headers = (page.responseHeaders as Record<string, string> | null) ?? {};
          const directives = [data?.metaRobots, headers['x-robots-tag']].filter(Boolean).join(', ');
          return {
            url: page.url,
            title: page.title,
            metaDescriptionLength: page.metaDescription ? page.metaDescription.trim().length : null,
            canonical: page.canonicalUrl,
            h1Count: page.h1Count,
            metaRobots: directives || null,
            indexable: !/\bnoindex\b|\bnone\b/i.test(directives),
            hasOpenGraph: Boolean(data?.ogTitle && data?.ogDescription && data?.ogImage),
            imagesWithoutAlt: data?.imagesWithoutAlt ?? null,
            issues: perPage.get(page.id) ?? 0,
          };
        }),
      };
    },

    /**
     * Performance and security: the scanners for these arrive later in Phase 6.
     * We return whatever REAL rows exist (none yet) and say so plainly.
     */
    /** Passive security configuration: findings by level, TLS / redirect facts, header matrix. */
    /**
     * What the safe explorer (Phase 9) did and found: findings per check, and per page
     * the controls it explored, what it skipped (and why) and what it blocked.
     */
    async functional(user: AuthUser, scanId: string): Promise<FunctionalReportDto> {
      const { info } = await scanInfo(user, scanId);
      const [issues, openState, pages] = await Promise.all([
        prisma.issue.findMany({
          where: { scanId, category: 'FUNCTIONAL' },
          select: {
            severity: true,
            classification: true,
            functional: { select: { checkType: true } },
          },
        }),
        prisma.issue.count({
          where: {
            scanId,
            category: 'ACCESSIBILITY',
            details: { path: ['interactionState'], not: Prisma.AnyNull },
          },
        }),
        prisma.scanPage.findMany({
          where: { scanId, exploration: { not: Prisma.AnyNull } },
          orderBy: { createdAt: 'asc' },
          select: { url: true, exploration: true },
        }),
      ]);
      const checks = new Map<string, FunctionalReportDto['checks'][number]>();
      for (const issue of issues) {
        const type = issue.functional?.checkType ?? 'OTHER';
        const entry = checks.get(type) ?? {
          checkType: type,
          count: 0,
          highestSeverity: issue.severity,
          byClassification: {},
        };
        entry.count += 1;
        if (RANK[issue.severity] > RANK[entry.highestSeverity])
          entry.highestSeverity = issue.severity;
        entry.byClassification[issue.classification] =
          (entry.byClassification[issue.classification] ?? 0) + 1;
        checks.set(type, entry);
      }
      type Summary = Partial<{
        explored: number;
        eligible: number;
        error: string;
        stoppedEarly: string | null;
        controls: { name: string; kind: string; result: string }[];
        skipped: { name: string; role: string; reason: string }[];
        skippedCounts: Record<string, number>;
        blocked: { kind: string; method?: string; url?: string; detail?: string }[];
        keyboard: Partial<NonNullable<FunctionalReportDto['pages'][number]['keyboard']>> | null;
        forms: Partial<NonNullable<FunctionalReportDto['pages'][number]['forms']>> | null;
      }>;
      const rows = pages.map((page) => {
        const summary = (page.exploration ?? {}) as Summary;
        return {
          url: page.url,
          explored: summary.explored ?? 0,
          eligible: summary.eligible ?? 0,
          error: summary.error ?? null,
          stoppedEarly: summary.stoppedEarly ?? null,
          controls: summary.controls ?? [],
          // Selectors stay in the database; the report shows names and reasons.
          skipped: (summary.skipped ?? []).map(({ name, role, reason }) => ({
            name,
            role,
            reason,
          })),
          skippedCounts: summary.skippedCounts ?? {},
          blocked: summary.blocked ?? [],
          // Keyboard and form probes (Milestone 2, Checkpoint 2); null on older scans.
          keyboard: summary.keyboard
            ? {
                error: summary.keyboard.error ?? null,
                steps: summary.keyboard.steps ?? 0,
                stoppedBy: summary.keyboard.stoppedBy ?? 'error',
                focusOrder: summary.keyboard.focusOrder ?? [],
                activation: summary.keyboard.activation ?? [],
                skipped: summary.keyboard.skipped ?? [],
                clickableNotFocusable: summary.keyboard.clickableNotFocusable ?? 0,
              }
            : null,
          forms: summary.forms
            ? {
                error: summary.forms.error ?? null,
                mode: summary.forms.mode ?? 'BLUR',
                fields: summary.forms.fields ?? 0,
                probed: summary.forms.probed ?? [],
                skipped: summary.forms.skipped ?? [],
                skippedCounts: summary.forms.skippedCounts ?? {},
              }
            : null,
        };
      });
      return {
        scan: info,
        checks: [...checks.values()].sort(
          (a, b) => RANK[b.highestSeverity] - RANK[a.highestSeverity] || b.count - a.count,
        ),
        openStateAccessibilityIssues: openState,
        totals: {
          pagesExplored: rows.filter((r) => !r.error).length,
          controlsExplored: rows.reduce((n, r) => n + r.explored, 0),
          controlsSkipped: rows.reduce(
            (n, r) => n + Object.values(r.skippedCounts).reduce((a, b) => a + b, 0),
            0,
          ),
          actionsBlocked: rows.reduce((n, r) => n + r.blocked.length, 0),
          pagesKeyboardChecked: rows.filter((r) => r.keyboard && !r.keyboard.error).length,
          formFieldsProbed: rows.reduce((n, r) => n + (r.forms?.probed.length ?? 0), 0),
          probesSkipped: rows.reduce(
            (n, r) => n + (r.keyboard?.skipped.length ?? 0) + (r.forms?.skipped.length ?? 0),
            0,
          ),
        },
        pages: rows,
      };
    },

    async security(user: AuthUser, scanId: string): Promise<SecurityReportDto> {
      const { scan, info } = await scanInfo(user, scanId);
      const [issues, pages] = await Promise.all([
        prisma.issue.findMany({
          where: { scanId, category: 'SECURITY' },
          select: {
            severity: true,
            ruleId: true,
            title: true,
            security: { select: { checkType: true, findingLevel: true } },
          },
        }),
        prisma.scanPage.findMany({
          where: { scanId, status: 'DONE' },
          orderBy: { createdAt: 'asc' },
          take: 50,
          select: { url: true, responseHeaders: true },
        }),
      ]);
      const levels: Record<SecurityFindingLevel, number> = {
        CONFIRMED: 0,
        WARNING: 0,
        OBSERVATION: 0,
      };
      const LEVEL_RANK: Record<SecurityFindingLevel, number> = {
        CONFIRMED: 3,
        WARNING: 2,
        OBSERVATION: 1,
      };
      const checks = new Map<string, SecurityReportDto['checks'][number]>();
      for (const issue of issues) {
        const level = (issue.security?.findingLevel ?? 'WARNING') as SecurityFindingLevel;
        levels[level] += 1;
        // Same check at two levels (e.g. active vs passive mixed content) = two rows.
        const key = `${issue.security?.checkType ?? 'OTHER'}|${level}`;
        const entry = checks.get(key) ?? {
          checkType: issue.security?.checkType ?? 'OTHER',
          ruleId: issue.ruleId,
          title: issue.title,
          findingLevel: level,
          count: 0,
          highestSeverity: issue.severity,
        };
        entry.count += 1;
        if (RANK[issue.severity] > RANK[entry.highestSeverity])
          entry.highestSeverity = issue.severity;
        checks.set(key, entry);
      }
      const HEADERS = [
        'content-security-policy',
        'strict-transport-security',
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy',
      ];
      return {
        scan: info,
        site:
          (scan.siteChecks as { security?: SecurityReportDto['site'] } | null)?.security ?? null,
        levels,
        checks: [...checks.values()].sort(
          (a, b) =>
            LEVEL_RANK[b.findingLevel] - LEVEL_RANK[a.findingLevel] ||
            RANK[b.highestSeverity] - RANK[a.highestSeverity] ||
            a.title.localeCompare(b.title),
        ),
        headers: pages.map((page) => {
          const headers = (page.responseHeaders as Record<string, string> | null) ?? {};
          return {
            url: page.url,
            present: Object.fromEntries(HEADERS.map((h) => [h, Boolean(headers[h])])),
          };
        }),
      };
    },

    /** Lighthouse results of this scan plus the website's performance history. */
    async performance(user: AuthUser, scanId: string): Promise<PerformanceReportDto> {
      const { scan, info } = await scanInfo(user, scanId);
      const [results, history] = await Promise.all([
        prisma.performanceResult.findMany({
          where: { scanId },
          orderBy: { createdAt: 'asc' },
          include: { scanPage: { select: { url: true } } },
        }),
        prisma.scan.findMany({
          where: {
            websiteId: scan.websiteId,
            status: { in: ['COMPLETED', 'PARTIAL'] },
            performanceResults: { some: {} },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, createdAt: true, performanceScore: true },
        }),
      ]);
      const averages = await prisma.performanceResult.groupBy({
        by: ['scanId'],
        where: { scanId: { in: history.map((h) => h.id) } },
        _avg: { lcpMs: true, cls: true, tbtMs: true },
      });
      const avgOf = new Map(averages.map((a) => [a.scanId, a._avg]));
      const round = (v: number | null | undefined, digits = 0) =>
        v === null || v === undefined ? null : Number(v.toFixed(digits));

      return {
        scan: info,
        pages: results.map((r) => {
          const diagnostics = (r.diagnostics ?? {}) as {
            error?: string | null;
            slowestRequests?: PerformanceReportDto['pages'][number]['slowestRequests'];
            totalByteWeight?: number | null;
            warnings?: string[];
          };
          return {
            resultId: r.id,
            url: r.scanPage.url,
            formFactor: r.formFactor,
            error: diagnostics.error ?? null,
            scores: {
              performance: r.performanceScore,
              accessibility: r.accessibilityScore,
              bestPractices: r.bestPracticesScore,
              seo: r.seoScore,
            },
            metrics: {
              fcpMs: r.fcpMs,
              lcpMs: r.lcpMs,
              cls: r.cls,
              tbtMs: r.tbtMs,
              speedIndexMs: r.speedIndexMs,
              inpMs: null,
            },
            opportunities: (r.opportunities ??
              []) as PerformanceReportDto['pages'][number]['opportunities'],
            slowestRequests: diagnostics.slowestRequests ?? [],
            totalByteWeight: diagnostics.totalByteWeight ?? null,
            warnings: diagnostics.warnings ?? [],
            lighthouseVersion: r.lighthouseVersion,
            rawReportAvailable: Boolean(r.rawReportKey),
          };
        }),
        notMeasuredReason:
          results.length > 0
            ? null
            : scan.status === 'COMPLETED' || scan.status === 'PARTIAL'
              ? 'Lighthouse did not run for this scan: it was made before the performance audit existed (Phase 6), Lighthouse is switched off on this scanner, or the "Lighthouse pages" setting of the website is 0. Nothing is estimated.'
              : 'This scan did not finish, so performance was not measured.',
        history: history.reverse().map((h) => ({
          scanId: h.id,
          createdAt: h.createdAt.toISOString(),
          performanceScore: h.performanceScore,
          lcpMs: round(avgOf.get(h.id)?.lcpMs),
          cls: round(avgOf.get(h.id)?.cls, 3),
          tbtMs: round(avgOf.get(h.id)?.tbtMs),
        })),
      };
    },

    /** Storage key of a raw Lighthouse JSON report, after the permission check. */
    async lighthouseReportKey(user: AuthUser, scanId: string, resultId: string): Promise<string> {
      await scanInfo(user, scanId);
      const result = await prisma.performanceResult.findFirst({
        where: { id: resultId, scanId },
        select: { rawReportKey: true },
      });
      if (!result?.rawReportKey) throw notFound('Lighthouse report');
      return result.rawReportKey;
    },
  };
}
