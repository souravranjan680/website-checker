import type { PrismaClient } from './generated/prisma/client';

/** Everything an exported report contains, read from the database for one scan. */
export async function loadReportData(
  prisma: PrismaClient,
  scanId: string,
  options: {
    category?:
      | 'ACCESSIBILITY'
      | 'UI_HEALTH'
      | 'RESPONSIVE'
      | 'PERFORMANCE'
      | 'SEO'
      | 'SECURITY'
      | 'FUNCTIONAL'
      | 'COMPATIBILITY';
    maxIssues?: number;
  } = {},
) {
  const scan = await prisma.scan.findUniqueOrThrow({
    where: { id: scanId },
    include: {
      website: { include: { project: { select: { id: true, name: true } } } },
      triggeredBy: { select: { name: true } },
    },
  });
  const [issues, pages, totalIssues] = await Promise.all([
    prisma.issue.findMany({
      where: { scanId, ...(options.category ? { category: options.category } : {}) },
      // Severity enum order is CRITICAL → INFO, so ascending = worst first.
      orderBy: [{ severity: 'asc' }, { category: 'asc' }, { ruleId: 'asc' }, { createdAt: 'asc' }],
      take: options.maxIssues ?? 5000,
      include: {
        accessibility: {
          select: { wcagCriteria: true, wcagLevel: true, helpUrl: true, detection: true },
        },
        uiHealth: { select: { checkType: true, resourceUrl: true, statusCode: true } },
        seo: { select: { checkType: true, expected: true, actual: true } },
        security: {
          select: {
            checkType: true,
            findingLevel: true,
            observedValue: true,
            recommendedValue: true,
          },
        },
        compatibility: {
          select: { browser: true, browserVersion: true, baselineVersion: true, checkType: true },
        },
        trackedIssue: {
          select: { status: true, firstSeenAt: true, lastSeenAt: true, occurrenceCount: true },
        },
        screenshot: { select: { storageKey: true, mimeType: true } },
      },
    }),
    prisma.scanPage.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
      select: {
        url: true,
        status: true,
        httpStatus: true,
        title: true,
        loadTimeMs: true,
        errorMessage: true,
      },
    }),
    prisma.issue.count({
      where: { scanId, ...(options.category ? { category: options.category } : {}) },
    }),
  ]);
  return {
    scan: {
      id: scan.id,
      status: scan.status,
      mode: scan.mode,
      createdAt: scan.createdAt,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      durationMs: scan.durationMs,
      pagesScanned: scan.pagesScanned,
      pagesFailed: scan.pagesFailed,
      accessibilityScore: scan.accessibilityScore,
      uiHealthScore: scan.uiHealthScore,
      performanceScore: scan.performanceScore,
      seoScore: scan.seoScore,
      securityScore: scan.securityScore,
      errorMessage: scan.errorMessage,
      triggeredBy: scan.triggeredBy?.name ?? null,
      counts: {
        total: scan.totalIssues,
        critical: scan.criticalCount,
        high: scan.highCount,
        medium: scan.mediumCount,
        low: scan.lowCount,
        info: scan.infoCount,
      },
    },
    project: scan.website.project,
    website: { id: scan.website.id, name: scan.website.name, baseUrl: scan.website.baseUrl },
    category: options.category ?? null,
    totalIssues,
    issues,
    pages,
  };
}

export type ReportData = Awaited<ReturnType<typeof loadReportData>>;
