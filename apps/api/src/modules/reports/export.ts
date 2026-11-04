import type { ReportData } from '@whc/db';

/**
 * A spreadsheet cell can't start a formula: values beginning with = + - @ (or tab/CR)
 * get a leading apostrophe ("CSV injection" protection). Everything is quoted.
 */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  'Severity',
  'Category',
  'Rule',
  'Title',
  'Page URL',
  'Screen size',
  'CSS selector',
  'WCAG',
  'Tracking status',
  'First detected',
  'Last detected',
  'Description',
  'HTML',
  'Suggested fix',
  'Issue ID',
];

const BOM = String.fromCharCode(0xfeff);

/** One row per issue. A UTF-8 byte-order mark makes Excel read accents correctly. */
export function toCsv(data: ReportData): string {
  const rows = data.issues.map((issue) =>
    [
      issue.severity,
      issue.category,
      issue.ruleId,
      issue.title,
      issue.pageUrl,
      issue.viewport,
      issue.selector,
      issue.accessibility?.wcagCriteria.join(' ') ?? '',
      issue.trackedIssue?.status ?? '',
      issue.trackedIssue?.firstSeenAt ?? '',
      issue.trackedIssue?.lastSeenAt ?? '',
      issue.description,
      issue.htmlSnippet,
      issue.suggestedFix,
      issue.id,
    ]
      .map(csvCell)
      .join(','),
  );
  return `${BOM}${[CSV_HEADER.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
}

export function toJson(data: ReportData) {
  return {
    generatedAt: new Date().toISOString(),
    project: data.project,
    website: data.website,
    scan: data.scan,
    category: data.category,
    totalIssues: data.totalIssues,
    issues: data.issues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      category: issue.category,
      ruleId: issue.ruleId,
      title: issue.title,
      description: issue.description,
      pageUrl: issue.pageUrl,
      viewport: issue.viewport,
      selector: issue.selector,
      htmlSnippet: issue.htmlSnippet,
      boundingBox: issue.boundingBox,
      suggestedFix: issue.suggestedFix,
      wcag: issue.accessibility?.wcagCriteria ?? [],
      wcagLevel: issue.accessibility?.wcagLevel ?? null,
      helpUrl: issue.accessibility?.helpUrl ?? null,
      detection: issue.accessibility?.detection ?? null,
      checkType: issue.uiHealth?.checkType ?? null,
      resourceUrl: issue.uiHealth?.resourceUrl ?? null,
      // Which browser differed from Chromium (cross-browser issues only).
      compatibility: issue.compatibility ?? null,
      tracking: issue.trackedIssue,
      screenshotId: issue.screenshotId,
    })),
    pages: data.pages,
  };
}

/** "report-homepage-2026-11-02.csv"; only safe characters in the download name. */
export function exportFilename(data: ReportData, extension: string): string {
  const slug =
    data.website.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'website';
  return `report-${slug}-${data.scan.createdAt.toISOString().slice(0, 10)}.${extension}`;
}
