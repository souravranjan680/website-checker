import type { Prisma } from '@whc/db';

/**
 * Turns a stored issue into a bug report. Everything comes from what the scanner
 * recorded. Reproduction steps contain only facts it established (URL, browser,
 * window size, element, the check that failed). "Expected behavior" is filled in
 * only where the check itself defines it; otherwise it stays empty and the UI says
 * "Not determined by the scanner" so a person writes it.
 */

export const BUG_REPORT_ISSUE_INCLUDE = {
  accessibility: true,
  uiHealth: true,
  seo: true,
  security: true,
  scanPage: {
    select: {
      screenshots: {
        where: { kind: { in: ['PAGE_FULL', 'VIEWPORT'] } },
        select: { id: true, kind: true, viewport: true },
      },
    },
  },
  scan: {
    select: {
      id: true,
      createdAt: true,
      browserVersion: true,
      website: { select: { id: true, name: true, baseUrl: true, projectId: true } },
    },
  },
} satisfies Prisma.IssueInclude;

export type BugReportIssue = Prisma.IssueGetPayload<{ include: typeof BUG_REPORT_ISSUE_INCLUDE }>;

export interface BugReportDraft {
  title: string;
  description: string;
  severity: BugReportIssue['severity'];
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  affectedUrl: string;
  browser: string;
  viewport: string;
  stepsToReproduce: string[];
  expectedBehavior: string;
  actualBehavior: string;
  selector: string | null;
  htmlSnippet: string | null;
  suggestedFix: string | null;
  screenshotId: string | null;
}

const PRIORITY: Record<string, BugReportDraft['priority']> = {
  CRITICAL: 'P1',
  HIGH: 'P2',
  MEDIUM: 'P3',
  LOW: 'P4',
  INFO: 'P4',
};

const CATEGORY: Record<string, string> = {
  ACCESSIBILITY: 'accessibility',
  UI_HEALTH: 'UI health',
  RESPONSIVE: 'responsive layout',
  PERFORMANCE: 'performance (Lighthouse)',
  SEO: 'SEO',
  SECURITY: 'security configuration',
};

/** What each UI check guarantees when it passes (the check's own definition). */
const UI_EXPECTED: Record<string, string> = {
  BROKEN_LINK: 'The link target loads successfully (HTTP 2xx or a working redirect).',
  BROKEN_IMAGE: 'The image loads and is displayed.',
  FAILED_REQUEST: 'The request completes successfully.',
  FAILED_STYLESHEET: 'The stylesheet loads successfully.',
  FAILED_SCRIPT: 'The script loads successfully.',
  CONSOLE_ERROR: 'The page loads without errors in the browser console.',
  JS_ERROR: 'The page loads without uncaught JavaScript errors.',
  HORIZONTAL_SCROLL: 'The page fits the window width without horizontal scrolling.',
  CONTENT_OVERFLOW: 'The content stays inside its container.',
  OVERLAPPING_ELEMENTS: 'Interactive elements are not covered by other elements.',
  TEXT_CLIPPING: 'Text is fully visible, not cut off.',
  OUT_OF_VIEWPORT: 'The element is inside the visible page area.',
  EMPTY_BUTTON: 'The button has a visible label or an accessible name.',
  EMPTY_LINK: 'The link has text or an accessible name.',
};

const SEO_PLACE: Record<string, string> = {
  MISSING_TITLE: 'the <title> element in <head>',
  DUPLICATE_TITLE: 'the <title> element in <head>',
  TITLE_LENGTH: 'the <title> element in <head>',
  MISSING_META_DESCRIPTION: 'the <meta name="description"> tag in <head>',
  DUPLICATE_META_DESCRIPTION: 'the <meta name="description"> tag in <head>',
  META_DESCRIPTION_LENGTH: 'the <meta name="description"> tag in <head>',
  MISSING_H1: 'the <h1> headings',
  MULTIPLE_H1: 'the <h1> headings',
  SKIPPED_HEADING_LEVEL: 'the heading levels (h1–h6)',
  MISSING_CANONICAL: 'the <link rel="canonical"> tag in <head>',
  INVALID_CANONICAL: 'the <link rel="canonical"> tag in <head>',
  NOINDEX: 'the <meta name="robots"> tag and the X-Robots-Tag response header',
  MISSING_OPEN_GRAPH: 'the og:title / og:description / og:image meta tags',
  MISSING_IMAGE_ALT: 'the alt attributes of the <img> elements',
};

/** "1920x1080" → { width: 1920, height: 1080 }; anything else → null. */
function windowSize(viewport: string | null): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(viewport ?? '');
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? parsed.host : `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function buildBugReport(issue: BugReportIssue): BugReportDraft {
  const url = issue.pageUrl ?? issue.scan.website.baseUrl;
  const lighthouse = issue.category === 'PERFORMANCE';
  const browser = lighthouse
    ? `${issue.scan.browserVersion ?? 'Chromium'} (Lighthouse, simulated mobile device)`
    : (issue.scan.browserVersion ?? 'Chromium (exact version not recorded for this scan)');
  const size = windowSize(issue.viewport);
  const viewport = size
    ? `${size.width}×${size.height}`
    : lighthouse
      ? 'Mobile (Lighthouse emulation)'
      : (issue.viewport ?? 'Not recorded');

  // ---------------------------------------------------------------- steps
  const steps = [
    `Open ${url} in ${browser}${size ? ` with a ${size.width}×${size.height} browser window` : ''}.`,
  ];
  if (issue.selector) steps.push(`Find the element matching the CSS selector: ${issue.selector}`);
  let expected = '';
  let actual = issue.description;

  switch (issue.category) {
    case 'ACCESSIBILITY': {
      const a11y = issue.accessibility;
      if (a11y?.detection === 'NEEDS_REVIEW') {
        steps.push(
          `Check it by hand: axe-core could not decide automatically${a11y.wcagCriteria.length ? ` (WCAG ${a11y.wcagCriteria.join(', ')})` : ''}.`,
        );
      } else if (a11y) {
        steps.push(
          `Check the page with the axe-core rule "${a11y.axeRuleId}" (for example with the axe DevTools browser extension).`,
        );
        // axe rule titles are written as the requirement ("Images must have alternative text").
        expected = issue.title.endsWith('.') ? issue.title : `${issue.title}.`;
        if (a11y.failureSummary) actual = a11y.failureSummary;
      }
      break;
    }
    case 'UI_HEALTH':
    case 'RESPONSIVE': {
      const ui = issue.uiHealth;
      if (ui?.resourceUrl) {
        steps.push(
          `Request ${ui.resourceUrl}: the scanner received ${ui.statusCode ? `HTTP ${ui.statusCode}` : 'no successful response'}.`,
        );
      } else if (ui && (ui.checkType === 'CONSOLE_ERROR' || ui.checkType === 'JS_ERROR')) {
        steps.push('Open the browser DevTools Console and reload the page.');
      } else if (ui) {
        steps.push('Look at the element at this window size.');
      }
      expected = ui ? (UI_EXPECTED[ui.checkType] ?? '') : '';
      break;
    }
    case 'SEO': {
      const seo = issue.seo;
      const place = seo ? SEO_PLACE[seo.checkType] : undefined;
      if (place) steps.push(`View the page source (Ctrl+U) and check ${place}.`);
      if (seo?.expected) expected = seo.expected;
      if (seo?.actual) actual = `${issue.description} Found: ${seo.actual}.`;
      break;
    }
    case 'SECURITY': {
      const security = issue.security;
      if (security?.headerName) {
        steps.push(
          `Open DevTools → Network, reload the page, select the document request and read its response header "${security.headerName}".`,
        );
      } else if (
        security?.checkType === 'INVALID_CERTIFICATE' ||
        security?.checkType === 'CERTIFICATE_EXPIRING'
      ) {
        steps.push(
          'Open the site in a browser and view the certificate (padlock icon in the address bar).',
        );
      } else if (
        security?.checkType === 'MIXED_CONTENT' ||
        security?.checkType === 'INSECURE_FORM'
      ) {
        steps.push('View the page source and look for http:// addresses in the listed elements.');
      }
      if (security?.recommendedValue) expected = `Recommended: ${security.recommendedValue}`;
      if (security?.observedValue)
        actual = `${issue.description} Observed: ${security.observedValue}.`;
      break;
    }
    case 'PERFORMANCE': {
      steps.push(
        'Run Lighthouse in Chrome DevTools (Lighthouse tab → Mobile → Performance). Lab results vary by a few points between runs.',
      );
      const details = (issue.details ?? {}) as { metric?: string; good?: number };
      if (details.metric && typeof details.good === 'number') {
        expected =
          details.metric === 'cls'
            ? `At most ${details.good}`
            : `At most ${(details.good / 1000).toFixed(1)} s`;
      }
      break;
    }
  }

  // Screenshot: the element crop, else the page screenshot at the issue's screen size.
  const shots = issue.scanPage?.screenshots ?? [];
  const pageShot =
    shots.find((s) => s.kind === 'VIEWPORT' && s.viewport === issue.viewport) ??
    shots.find((s) => s.kind === 'PAGE_FULL');

  return {
    title: `${issue.title} (${shortPath(url)})`.slice(0, 200),
    description: `${issue.description}\n\nFound by an automated ${CATEGORY[issue.category] ?? issue.category} check (rule ${issue.ruleId}) in the scan of ${issue.scan.createdAt.toISOString().slice(0, 10)} (UTC).`,
    severity: issue.severity,
    priority: PRIORITY[issue.severity] ?? 'P3',
    affectedUrl: url,
    browser,
    viewport,
    stepsToReproduce: steps,
    expectedBehavior: expected,
    actualBehavior: actual,
    selector: issue.selector,
    htmlSnippet: issue.htmlSnippet,
    suggestedFix: issue.suggestedFix?.replace(/\n*Guidance: \S+$/, '') ?? null,
    screenshotId: issue.screenshotId ?? pageShot?.id ?? null,
  };
}
