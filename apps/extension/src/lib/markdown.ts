import { SEVERITY_RANK } from '@whc/dom-checks';
import type { ExtensionIssue, PageCheckResult } from '../types';

const NOTE =
  'Found by a local check with the UI Health Checker extension (not a saved scan; automated checks find only part of all accessibility problems).';

/** A code block that cannot be broken out of by backticks inside the snippet. */
function codeBlock(text: string, language = ''): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function issueBody(issue: ExtensionIssue): string[] {
  const lines = [
    `- **Severity:** ${issue.severity}${issue.needsReview ? ' (needs manual review)' : ''}`,
    `- **Rule:** \`${issue.ruleId}\``,
  ];
  if (issue.wcag.length > 0) {
    lines.push(
      `- **WCAG:** ${issue.wcag.join(', ')}${issue.wcagLevel ? ` (level ${issue.wcagLevel})` : ''}`,
    );
  }
  if (issue.selector) lines.push(`- **Element:** \`${issue.selector.replace(/`/g, "'")}\``);
  lines.push('', issue.description);
  if (issue.html) lines.push('', codeBlock(issue.html, 'html'));
  lines.push('', '**How to fix**', '', issue.suggestedFix);
  return lines;
}

export function issueMarkdown(issue: ExtensionIssue, result: PageCheckResult): string {
  return [
    `### ${issue.title}`,
    '',
    `- **Page:** ${result.url}`,
    ...issueBody(issue),
    '',
    `_${NOTE}_`,
  ].join('\n');
}

export function reportMarkdown(issues: ExtensionIssue[], result: PageCheckResult): string {
  const sorted = [...issues].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const lines = [
    `# Local check: ${result.title || result.url}`,
    '',
    `- **Page:** ${result.url}`,
    `- **Checked:** ${result.checkedAt.replace('T', ' ').slice(0, 19)} UTC, window ${result.viewport.width}×${result.viewport.height}, axe-core ${result.axeVersion}`,
    `- **Issues:** ${issues.length}`,
    '',
    `_${NOTE}_`,
  ];
  for (const issue of sorted) lines.push('', `## ${issue.title}`, '', ...issueBody(issue));
  return lines.join('\n');
}
