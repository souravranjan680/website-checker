import { createHash, randomUUID } from 'node:crypto';
import {
  axeFindings,
  domFindingPresentation,
  truncate,
  UI_CHECK_TEXT,
  uiRuleId,
  type AxeOutput,
  type Box,
  type DomFinding,
  type Severity,
  type UiCheckType,
} from '@whc/dom-checks';
import type { PageNetworkLog } from './checks/collectors';
import type { ConsoleGroup, ConsoleKind } from './checks/console-classify';
import { pathOf } from './crawler/urls';

// Presentation (severities, titles, fixes, WCAG references) is shared with the
// Chrome extension and lives in @whc/dom-checks; re-exported for scanner modules.
export { SEVERITY_RANK, wcagFromTags } from '@whc/dom-checks';
export type { Severity, UiCheckType } from '@whc/dom-checks';
export type Category =
  'ACCESSIBILITY' | 'UI_HEALTH' | 'RESPONSIVE' | 'PERFORMANCE' | 'SEO' | 'SECURITY';

/** An issue found during a scan, before it is saved. */
export interface IssueDraft {
  id: string;
  category: Category;
  severity: Severity;
  ruleId: string;
  title: string;
  description: string;
  pageUrl: string;
  viewport: string;
  selector: string | null;
  htmlSnippet: string | null;
  boundingBox: Box | null;
  suggestedFix: string | null;
  details: Record<string, unknown> | null;
  fingerprint: string;
  screenshotId?: string;
  accessibility?: {
    axeRuleId: string;
    impact: string | null;
    wcagCriteria: string[];
    wcagLevel: string | null;
    tags: string[];
    helpUrl: string;
    detection: 'AUTOMATED' | 'NEEDS_REVIEW';
    failureSummary: string | null;
  };
  uiHealth?: {
    checkType: UiCheckType;
    resourceUrl?: string | null;
    statusCode?: number | null;
    measurements?: Record<string, unknown>;
  };
  seo?: { checkType: string; expected: string | null; actual: string | null };
  security?: {
    checkType: string;
    findingLevel: 'OBSERVATION' | 'WARNING' | 'CONFIRMED';
    headerName: string | null;
    observedValue: string | null;
    recommendedValue: string | null;
  };
}

export interface IssueContext {
  websiteId: string;
  pageUrl: string;
  viewport: string;
}

/**
 * The identity of "the same problem" across scans. Database IDs change every scan;
 * this hash stays the same as long as the rule, page, screen size and element stay the same.
 */
export function fingerprint(parts: {
  websiteId: string;
  category: string;
  ruleId: string;
  pageUrl: string;
  viewport: string;
  target: string;
}): string {
  const stableTarget = parts.target.replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(
      [
        parts.websiteId,
        parts.category,
        parts.ruleId,
        pathOf(parts.pageUrl),
        parts.viewport,
        stableTarget,
      ].join('|'),
    )
    .digest('hex');
}

// ------------------------------------------------------------------ axe-core

export function axeToDrafts(
  axe: AxeOutput,
  ctx: IssueContext,
  boxes: Map<string, Box | null>,
): IssueDraft[] {
  return axeFindings(axe).map((finding) => ({
    id: randomUUID(),
    category: 'ACCESSIBILITY',
    severity: finding.severity,
    ruleId: finding.ruleId,
    title: finding.title,
    description: finding.description,
    pageUrl: ctx.pageUrl,
    viewport: ctx.viewport,
    selector: finding.selector,
    htmlSnippet: finding.html,
    boundingBox: finding.selector ? (boxes.get(finding.selector) ?? null) : null,
    suggestedFix: finding.suggestedFix,
    details: finding.totalElements ? { totalElements: finding.totalElements } : null,
    fingerprint: fingerprint({
      ...ctx,
      category: 'ACCESSIBILITY',
      ruleId: finding.ruleId,
      target: finding.selector ?? finding.html ?? '',
    }),
    accessibility: {
      axeRuleId: finding.ruleId,
      impact: finding.impact,
      wcagCriteria: finding.wcagCriteria,
      wcagLevel: finding.wcagLevel,
      tags: finding.tags,
      helpUrl: finding.helpUrl,
      detection: finding.detection,
      failureSummary: finding.failureSummary,
    },
  }));
}

// ------------------------------------------------------------- UI checks

export function uiDraft(
  check: UiCheckType,
  ctx: IssueContext,
  category: Category,
  values: {
    severity: Severity;
    description: string;
    selector?: string | null;
    html?: string | null;
    box?: Box | null;
    resourceUrl?: string | null;
    statusCode?: number | null;
    measurements?: Record<string, unknown>;
    target: string;
  },
): IssueDraft {
  const ruleId = uiRuleId(check);
  return {
    id: randomUUID(),
    category,
    severity: values.severity,
    ruleId,
    title: UI_CHECK_TEXT[check].title,
    description: values.description,
    pageUrl: ctx.pageUrl,
    viewport: ctx.viewport,
    selector: values.selector ?? null,
    htmlSnippet: truncate(values.html, 2000),
    boundingBox: values.box ?? null,
    suggestedFix: UI_CHECK_TEXT[check].fix,
    details: values.measurements ?? null,
    fingerprint: fingerprint({ ...ctx, category, ruleId, target: values.target }),
    uiHealth: {
      checkType: check,
      resourceUrl: values.resourceUrl ?? null,
      statusCode: values.statusCode ?? null,
      measurements: values.measurements,
    },
  };
}

export function domToDrafts(
  findings: DomFinding[],
  ctx: IssueContext,
  category: Category,
): IssueDraft[] {
  return findings.map((finding) => {
    const shown = domFindingPresentation(finding); // same wording as the Chrome extension
    return uiDraft(finding.check, ctx, category, {
      severity: shown.severity,
      description: shown.description,
      selector: shown.selector,
      html: shown.html,
      box: shown.box,
      resourceUrl: typeof finding.measurements?.src === 'string' ? finding.measurements.src : null,
      measurements: finding.measurements,
      target:
        finding.check === 'BROKEN_IMAGE'
          ? String(finding.measurements?.src ?? finding.selector)
          : finding.selector,
    });
  });
}

const CONSOLE_TITLES: Record<ConsoleKind, string> = {
  APPLICATION: 'JavaScript error in the site’s code',
  INTEGRATION_CONFIG: 'Integration not configured correctly',
  THIRD_PARTY: 'Error in a third-party script',
  NETWORK: 'Request failure reported in the console',
  HARMLESS: 'Console warning',
};

/** Problems that look the same on every page (a service, a widget): one issue per scan. */
const SITE_WIDE_KINDS = new Set<ConsoleKind>(['INTEGRATION_CONFIG', 'THIRD_PARTY', 'NETWORK']);

function locationText(location: {
  source?: string;
  line?: number;
  column?: number;
}): string | null {
  if (!location.source) return null;
  return `${location.source}${location.line ? `:${location.line}${location.column ? `:${location.column}` : ''}` : ''}`;
}

/** Console messages and uncaught exceptions (already classified and grouped) → issues. */
export function consoleToDrafts(groups: ConsoleGroup[], ctx: IssueContext): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  let consoleCount = 0;
  let exceptionCount = 0;
  for (const group of groups) {
    const { classification } = group;
    if (!classification.severity) continue; // HARMLESS: kept on the page record only
    const exception = group.level === 'exception';
    if (exception ? exceptionCount++ >= 10 : consoleCount++ >= 10) continue;
    const where = locationText(group.location);
    const related = classification.related
      .map(
        (r) =>
          `${r.url} (${r.status ? `HTTP ${r.status}` : (r.error ?? 'failed')}${r.relation === 'same-service' ? ', possibly related' : ''})`,
      )
      .join('; ');
    const description = [
      group.text,
      where ? `Source: ${where}` : null,
      group.occurrences > 1 ? `Logged ${group.occurrences} times on this page.` : null,
      related ? `Related failed requests: ${related}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const target = `${classification.kind}|${classification.normalized}|${classification.sourcePath ?? ''}`;
    const draft = uiDraft(exception ? 'JS_ERROR' : 'CONSOLE_ERROR', ctx, 'UI_HEALTH', {
      severity: classification.severity,
      description,
      resourceUrl: group.location.source ?? null,
      measurements: {
        kind: classification.kind,
        level: group.level,
        message: group.text,
        source: group.location.source ?? null,
        line: group.location.line ?? null,
        column: group.location.column ?? null,
        stack: group.stack ?? null,
        occurrences: group.occurrences,
        relatedRequests: classification.related,
      },
      target,
    });
    draft.title =
      exception && classification.kind === 'APPLICATION'
        ? UI_CHECK_TEXT.JS_ERROR.title
        : CONSOLE_TITLES[classification.kind];
    if (classification.kind === 'INTEGRATION_CONFIG') {
      draft.suggestedFix =
        'A service the page uses rejected the request or is missing its configuration (for example an API key or access token). Check the service’s settings and the keys/tokens in the site’s environment; the feature that depends on it does not work until then.';
    } else if (classification.kind === 'THIRD_PARTY') {
      draft.suggestedFix =
        'The error comes from a script loaded from another service. Check its configuration and version, or contact its provider; remove it if it is no longer needed.';
    } else if (classification.kind === 'NETWORK') {
      draft.suggestedFix =
        'A request made by the page failed. See the related failed requests (each is re-checked separately) and the server or CORS configuration.';
    }
    if (SITE_WIDE_KINDS.has(classification.kind)) {
      // Same service problem on every page → one issue per scan, stable across scans.
      draft.fingerprint = fingerprint({
        ...ctx,
        pageUrl: '/',
        category: 'UI_HEALTH',
        ruleId: draft.ruleId,
        target,
      });
    }
    drafts.push(draft);
  }
  return drafts;
}

/**
 * Failed resources → issues. Only CONFIRMED failures (see checks/verify-resources.ts)
 * are reported; inconclusive and policy-blocked ones stay on the page record.
 */
export function networkToDrafts(
  log: PageNetworkLog,
  ctx: IssueContext,
  siteHostname: string,
  alreadyReportedImages: Set<string>,
): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  const seen = new Set<string>();

  for (const request of log.failedRequests) {
    if (request.blockedByPolicy || request.verdict !== 'CONFIRMED') continue;
    const key = `${request.resourceType}|${request.url}`;
    if (seen.has(key) || request.resourceType === 'document') continue;
    seen.add(key);
    // "… could not be loaded. The server answered HTTP 404, and HTTP 404 again on a re-check."
    const problem =
      request.verdictReason ??
      (request.status ? `HTTP ${request.status}.` : `${request.error ?? 'failed'}.`);
    const verification = {
      verdict: request.verdict,
      verdictReason: request.verdictReason ?? null,
      error: request.error ?? null,
    };
    let host = '';
    try {
      host = new URL(request.url).hostname;
    } catch {
      /* keep empty */
    }
    const thirdParty = host !== '' && host !== siteHostname;

    if (request.resourceType === 'stylesheet' || request.resourceType === 'script') {
      const check = request.resourceType === 'stylesheet' ? 'FAILED_STYLESHEET' : 'FAILED_SCRIPT';
      drafts.push(
        uiDraft(check, ctx, 'UI_HEALTH', {
          severity: thirdParty ? 'MEDIUM' : 'HIGH',
          description: `${request.url} could not be loaded. ${problem}`,
          resourceUrl: request.url,
          statusCode: request.status ?? null,
          measurements: verification,
          target: request.url,
        }),
      );
    } else if (request.resourceType === 'image') {
      if (alreadyReportedImages.has(request.url)) continue; // the DOM check already pointed at the <img>
      drafts.push(
        uiDraft('BROKEN_IMAGE', ctx, 'UI_HEALTH', {
          severity: 'MEDIUM',
          description: `The image ${request.url} could not be loaded. ${problem}`,
          resourceUrl: request.url,
          statusCode: request.status ?? null,
          measurements: verification,
          target: request.url,
        }),
      );
    } else if (drafts.filter((d) => d.uiHealth?.checkType === 'FAILED_REQUEST').length < 20) {
      const isFavicon = /favicon\.ico($|\?)/.test(request.url);
      drafts.push(
        uiDraft('FAILED_REQUEST', ctx, 'UI_HEALTH', {
          severity: isFavicon || thirdParty ? 'INFO' : 'LOW',
          description: `A ${request.resourceType} request to ${request.url} failed. ${problem}`,
          resourceUrl: request.url,
          statusCode: request.status ?? null,
          measurements: verification,
          target: request.url,
        }),
      );
    }
  }
  return drafts;
}
