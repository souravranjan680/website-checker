import type { Prisma } from '@whc/db';
import type { IssueDto } from '@whc/shared';

/** What every issue query loads, so the scan list and the issue page return the same shape. */
export const ISSUE_INCLUDE = {
  accessibility: true,
  uiHealth: true,
  trackedIssue: { select: { id: true, status: true, occurrenceCount: true, firstSeenAt: true } },
  scanPage: {
    select: {
      screenshots: {
        where: { kind: { in: ['PAGE_FULL', 'VIEWPORT'] } },
        select: { id: true, kind: true, viewport: true },
      },
    },
  },
} satisfies Prisma.IssueInclude;

export type IssueRow = Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

/** Database row → JSON for the frontend. */
export function toIssueDto(row: IssueRow): IssueDto {
  const shots = row.scanPage?.screenshots ?? [];
  // Prefer the screenshot taken at the issue's own screen size.
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
}
