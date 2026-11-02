import { z } from 'zod';
import { idSchema, listQuerySchema } from './schemas/common';
import type { SeverityName } from './constants';

/** Bug reports: generated from a real detected issue, then editable by people. */

export const BUG_REPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

export interface BugReportDto {
  id: string;
  projectId: string;
  website: { id: string; name: string } | null;
  issueId: string | null;
  scanId: string | null;
  title: string;
  description: string;
  severity: SeverityName;
  priority: (typeof PRIORITIES)[number];
  status: (typeof BUG_REPORT_STATUSES)[number];
  affectedUrl: string;
  browser: string;
  viewport: string;
  stepsToReproduce: string[];
  /** Empty = the scanner could not establish it; a person must fill it in. */
  expectedBehavior: string;
  actualBehavior: string;
  selector: string | null;
  htmlSnippet: string | null;
  suggestedFix: string | null;
  screenshotId: string | null;
  aiGenerated: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  myRole: 'OWNER' | 'EDITOR' | 'VIEWER';
}

export const bugReportListQuerySchema = listQuerySchema.extend({
  projectId: idSchema.optional(),
  websiteId: idSchema.optional(),
  status: z.enum(BUG_REPORT_STATUSES).optional(),
});

export const updateBugReportSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(BUG_REPORT_STATUSES).optional(),
    stepsToReproduce: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
    expectedBehavior: z.string().trim().max(2000).optional(),
    actualBehavior: z.string().trim().max(2000).optional(),
    suggestedFix: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update.' });

export const bugReportExportQuerySchema = z.object({
  format: z.enum(['markdown', 'jira', 'json']),
});

const NOT_DETERMINED = 'Not determined by the scanner. Please describe.';

/** Markdown (GitHub, GitLab, Azure DevOps, Linear...). */
export function bugReportToMarkdown(report: BugReportDto, screenshotUrl?: string | null): string {
  const lines = [
    `# ${report.title}`,
    '',
    `**Severity:** ${report.severity} · **Priority:** ${report.priority} · **Status:** ${report.status}`,
    '',
    `**Affected URL:** ${report.affectedUrl}`,
    `**Browser:** ${report.browser}`,
    `**Viewport:** ${report.viewport}`,
    '',
    '## Description',
    '',
    report.description,
    '',
    '## Steps to reproduce',
    '',
    ...report.stepsToReproduce.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## Expected behavior',
    '',
    report.expectedBehavior || `_${NOT_DETERMINED}_`,
    '',
    '## Actual behavior',
    '',
    report.actualBehavior,
  ];
  if (report.selector) lines.push('', '## Element', '', '```css', report.selector, '```');
  if (report.htmlSnippet) lines.push('', '```html', report.htmlSnippet, '```');
  if (report.suggestedFix) lines.push('', '## Suggested fix', '', report.suggestedFix);
  if (screenshotUrl) lines.push('', '## Screenshot', '', `![Screenshot](${screenshotUrl})`);
  return `${lines.join('\n')}\n`;
}

/** Jira wiki markup, ready to paste into a Jira issue description. */
export function bugReportToJira(report: BugReportDto, screenshotUrl?: string | null): string {
  // Jira treats {braces} and [brackets] specially inside plain text.
  const text = (value: string) => value.replace(/([{}[\]])/g, '\\$1');
  const lines = [
    `h2. ${text(report.title)}`,
    '',
    `*Severity:* ${report.severity} | *Priority:* ${report.priority} | *Status:* ${report.status}`,
    `*Affected URL:* ${report.affectedUrl}`,
    `*Browser:* ${text(report.browser)}`,
    `*Viewport:* ${text(report.viewport)}`,
    '',
    'h3. Description',
    text(report.description),
    '',
    'h3. Steps to reproduce',
    ...report.stepsToReproduce.map((step) => `# ${text(step)}`),
    '',
    'h3. Expected behavior',
    report.expectedBehavior ? text(report.expectedBehavior) : `_${NOT_DETERMINED}_`,
    '',
    'h3. Actual behavior',
    text(report.actualBehavior),
  ];
  if (report.selector) lines.push('', 'h3. Element', '{code:css}', report.selector, '{code}');
  if (report.htmlSnippet) lines.push('{code:html}', report.htmlSnippet, '{code}');
  if (report.suggestedFix) lines.push('', 'h3. Suggested fix', text(report.suggestedFix));
  if (screenshotUrl) lines.push('', `Screenshot: ${screenshotUrl}`);
  return `${lines.join('\n')}\n`;
}
