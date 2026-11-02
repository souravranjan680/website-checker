import type { ReportData } from '@whc/db';

/** Screenshot bytes for an issue, already read from storage (key = issue ID). */
export type EmbeddedImages = Map<string, { mimeType: string; data: Buffer }>;

/** Escapes text for HTML. Everything from a scanned website is untrusted. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORY_LABEL: Record<string, string> = {
  ACCESSIBILITY: 'Accessibility',
  UI_HEALTH: 'UI health',
  RESPONSIVE: 'Responsive',
};

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#d03b3b',
  HIGH: '#eb6834',
  MEDIUM: '#fab219',
  LOW: '#2a78d6',
  INFO: '#898781',
};

const PAGE_STATUS: Record<string, string> = {
  DONE: 'Scanned',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
  PENDING: 'Not scanned',
};

function formatDate(date: Date | null): string {
  return date ? date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** At most this many issues are printed in full; the rest are summarised in a table. */
export const PDF_DETAILED_ISSUES = 60;

/**
 * Builds a self-contained HTML document for the PDF. No scripts, no external
 * resources: images are embedded as data: URLs, and the browser that prints it
 * has JavaScript off and blocks every network request.
 */
export function buildReportHtml(
  data: ReportData,
  images: EmbeddedImages,
  generatedAt = new Date(),
): string {
  const { scan } = data;
  const title = data.category
    ? `${CATEGORY_LABEL[data.category] ?? data.category} report`
    : 'Scan report';
  const counts = scan.counts;
  const detailed = data.issues.slice(0, PDF_DETAILED_ISSUES);
  const rest = data.issues.slice(PDF_DETAILED_ISSUES);
  const score = (value: number | null) => (value == null ? '—' : `${Math.round(value)}`);

  const issueBlocks = detailed
    .map((issue) => {
      const image = images.get(issue.id);
      const wcag = issue.accessibility?.wcagCriteria?.length
        ? `<div><b>WCAG:</b> ${esc(issue.accessibility.wcagCriteria.join(', '))} ${esc(issue.accessibility.wcagLevel ?? '')}</div>`
        : '';
      return `<section class="issue">
  <div class="issue-head">
    <span class="sev" style="background:${SEVERITY_COLOR[issue.severity] ?? '#898781'}">${esc(issue.severity)}</span>
    <span class="cat">${esc(CATEGORY_LABEL[issue.category] ?? issue.category)}</span>
    <h3>${esc(issue.title)}</h3>
  </div>
  <p>${esc(issue.description)}</p>
  <div class="meta">
    <div><b>Page:</b> ${esc(issue.pageUrl ?? '—')}${issue.viewport ? ` <i>(${esc(issue.viewport.toLowerCase())})</i>` : ''}</div>
    ${issue.selector ? `<div><b>Element:</b> <code>${esc(issue.selector)}</code></div>` : ''}
    ${wcag}
    <div><b>Rule:</b> ${esc(issue.ruleId)}${issue.trackedIssue ? ` · <b>Status:</b> ${esc(issue.trackedIssue.status)} · first seen ${esc(formatDate(issue.trackedIssue.firstSeenAt))}` : ''}</div>
  </div>
  ${issue.htmlSnippet ? `<pre>${esc(issue.htmlSnippet.slice(0, 600))}</pre>` : ''}
  ${issue.suggestedFix ? `<div class="fix"><b>How to fix:</b> ${esc(issue.suggestedFix)}</div>` : ''}
  ${image ? `<img alt="Screenshot of the element" src="data:${esc(image.mimeType)};base64,${image.data.toString('base64')}">` : ''}
</section>`;
    })
    .join('\n');

  const restTable = rest.length
    ? `<h2>More issues (${rest.length})</h2>
<table><thead><tr><th>Severity</th><th>Issue</th><th>Page</th><th>Element</th></tr></thead><tbody>
${rest
  .map(
    (i) =>
      `<tr><td>${esc(i.severity)}</td><td>${esc(i.title)}</td><td>${esc(i.pageUrl ?? '')}</td><td><code>${esc(i.selector ?? '')}</code></td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : '';

  const truncatedNote =
    data.totalIssues > data.issues.length
      ? `<p class="note">This PDF lists ${data.issues.length} of ${data.totalIssues} issues. Download the CSV or JSON export for the complete list.</p>`
      : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f1f1e; font-size: 11px; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #e1e0d9; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 0; display: inline; }
  .muted { color: #6b6a64; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .tile { border: 1px solid #e1e0d9; border-radius: 6px; padding: 8px 10px; min-width: 90px; }
  .tile .v { font-size: 18px; font-weight: bold; }
  .tile .l { color: #6b6a64; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; border-bottom: 1px solid #e1e0d9; padding: 4px 6px; vertical-align: top; word-break: break-all; }
  th { background: #f6f6f3; }
  .issue { border: 1px solid #e1e0d9; border-radius: 6px; padding: 10px; margin-bottom: 10px; page-break-inside: avoid; }
  .issue-head { margin-bottom: 4px; }
  .sev { color: #fff; border-radius: 3px; padding: 1px 6px; font-size: 9px; font-weight: bold; margin-right: 4px; }
  .cat { color: #6b6a64; margin-right: 6px; }
  .meta div { margin: 2px 0; word-break: break-all; }
  pre { background: #f6f6f3; padding: 6px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-size: 9px; }
  code { font-family: Consolas, monospace; font-size: 9.5px; }
  .fix { background: #eef5fd; padding: 6px; border-radius: 4px; margin-top: 4px; }
  img { max-width: 100%; max-height: 220px; border: 1px solid #e1e0d9; margin-top: 6px; }
  .note { background: #fff7e0; padding: 6px; border-radius: 4px; }
</style></head>
<body>
  <h1>${esc(title)}: ${esc(data.website.name)}</h1>
  <div class="muted">${esc(data.website.baseUrl)} · Project ${esc(data.project.name)}</div>
  <div class="muted">Scan ${esc(scan.id)} · ${esc(scan.status)} · ${esc(scan.mode)} · started ${esc(formatDate(scan.startedAt ?? scan.createdAt))} · duration ${esc(formatDuration(scan.durationMs))}${scan.triggeredBy ? ` · by ${esc(scan.triggeredBy)}` : ''}</div>
  <div class="muted">Generated ${esc(formatDate(generatedAt))}</div>
  ${scan.errorMessage ? `<p class="note">${esc(scan.errorMessage)}</p>` : ''}

  <div class="grid">
    <div class="tile"><div class="v">${score(scan.accessibilityScore)}</div><div class="l">Accessibility score</div></div>
    <div class="tile"><div class="v">${score(scan.uiHealthScore)}</div><div class="l">UI health score</div></div>
    <div class="tile"><div class="v">${scan.pagesScanned}</div><div class="l">Pages scanned</div></div>
    <div class="tile"><div class="v">${scan.pagesFailed}</div><div class="l">Pages failed</div></div>
    <div class="tile"><div class="v">${counts.total}</div><div class="l">Issues (all categories)</div></div>
    <div class="tile"><div class="v">${counts.critical}</div><div class="l">Critical</div></div>
    <div class="tile"><div class="v">${counts.high}</div><div class="l">High</div></div>
    <div class="tile"><div class="v">${counts.medium}</div><div class="l">Medium</div></div>
    <div class="tile"><div class="v">${counts.low + counts.info}</div><div class="l">Low / info</div></div>
  </div>

  <h2>Pages (${data.pages.length})</h2>
  <table><thead><tr><th>URL</th><th>Status</th><th>HTTP</th><th>Load</th></tr></thead><tbody>
  ${data.pages
    .map(
      (p) =>
        `<tr><td>${esc(p.url)}</td><td>${esc(PAGE_STATUS[p.status] ?? p.status)}</td><td>${esc(p.httpStatus ?? '—')}</td><td>${p.loadTimeMs == null ? '—' : `${p.loadTimeMs} ms`}</td></tr>`,
    )
    .join('\n')}
  </tbody></table>

  <h2>Issues${data.category ? ` (${esc(CATEGORY_LABEL[data.category] ?? data.category)})` : ''}: ${data.totalIssues}</h2>
  ${truncatedNote}
  ${data.issues.length === 0 ? '<p>No issues were found in this scan.</p>' : issueBlocks}
  ${restTable}
  <p class="muted" style="margin-top:16px">Automated checks find many, not all, problems. Accessibility conformance also needs the manual review checklist.</p>
</body></html>`;
}
