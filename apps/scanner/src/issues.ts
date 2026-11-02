import { createHash, randomUUID } from 'node:crypto';
import type { Box, DomFinding } from '@whc/dom-checks';
import type { AxeOutput, AxeRuleResult } from './checks/axe';
import { axeSelector } from './checks/axe';
import type { PageNetworkLog } from './checks/collectors';
import { pathOf } from './crawler/urls';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type Category = 'ACCESSIBILITY' | 'UI_HEALTH' | 'RESPONSIVE';
export type UiCheckType =
  | DomFinding['check']
  | 'BROKEN_LINK'
  | 'FAILED_STYLESHEET'
  | 'FAILED_SCRIPT'
  | 'CONSOLE_ERROR'
  | 'JS_ERROR'
  | 'FAILED_REQUEST';

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

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

const truncate = (text: string | null | undefined, max: number) =>
  text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null;

// ------------------------------------------------------------------ axe-core

const IMPACT_TO_SEVERITY: Record<string, Severity> = {
  critical: 'CRITICAL',
  serious: 'HIGH',
  moderate: 'MEDIUM',
  minor: 'LOW',
};

/** "wcag111" → "1.1.1"; "wcag2aa"/"wcag21aa" → level "AA". */
export function wcagFromTags(tags: string[]): { criteria: string[]; level: string | null } {
  const criteria = tags
    .map((tag) => /^wcag(\d)(\d)(\d{1,2})$/.exec(tag))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  const level = tags.some((t) => /^wcag2\d?a$/.test(t))
    ? 'A'
    : tags.some((t) => /^wcag2\d?aa$/.test(t))
      ? 'AA'
      : tags.some((t) => /^wcag2\d?aaa$/.test(t))
        ? 'AAA'
        : null;
  return { criteria, level };
}

const MAX_NODES_PER_RULE = 25;

export function axeToDrafts(
  axe: AxeOutput,
  ctx: IssueContext,
  boxes: Map<string, Box | null>,
): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  const convert = (rule: AxeRuleResult, detection: 'AUTOMATED' | 'NEEDS_REVIEW') => {
    const { criteria, level } = wcagFromTags(rule.tags);
    const nodes = rule.nodes.slice(0, detection === 'AUTOMATED' ? MAX_NODES_PER_RULE : 10);
    for (const node of nodes) {
      const selector = axeSelector(node.target);
      const impact = node.impact ?? rule.impact ?? null;
      drafts.push({
        id: randomUUID(),
        category: 'ACCESSIBILITY',
        severity:
          detection === 'NEEDS_REVIEW' ? 'INFO' : (IMPACT_TO_SEVERITY[impact ?? ''] ?? 'MEDIUM'),
        ruleId: rule.id,
        title: detection === 'NEEDS_REVIEW' ? `Needs review: ${rule.help}` : rule.help,
        description: rule.description,
        pageUrl: ctx.pageUrl,
        viewport: ctx.viewport,
        selector,
        htmlSnippet: truncate(node.html, 2000),
        boundingBox: selector ? (boxes.get(selector) ?? null) : null,
        suggestedFix: [node.failureSummary, `Guidance: ${rule.helpUrl}`]
          .filter(Boolean)
          .join('\n\n'),
        details: rule.nodes.length > nodes.length ? { totalElements: rule.nodes.length } : null,
        fingerprint: fingerprint({
          ...ctx,
          category: 'ACCESSIBILITY',
          ruleId: rule.id,
          target: selector ?? node.html,
        }),
        accessibility: {
          axeRuleId: rule.id,
          impact,
          wcagCriteria: criteria,
          wcagLevel: level,
          tags: rule.tags,
          helpUrl: rule.helpUrl,
          detection,
          failureSummary: truncate(node.failureSummary, 2000),
        },
      });
    }
  };
  for (const rule of axe.violations) convert(rule, 'AUTOMATED');
  for (const rule of axe.incomplete) convert(rule, 'NEEDS_REVIEW');
  return drafts;
}

// ------------------------------------------------------------- UI checks

const UI_TEXT: Record<UiCheckType, { title: string; fix: string }> = {
  BROKEN_IMAGE: {
    title: 'Broken image',
    fix: 'Check that the image URL is correct and the file exists on the server. Remove the image if it is no longer needed.',
  },
  HORIZONTAL_SCROLL: {
    title: 'Page scrolls sideways',
    fix: 'Find the element that is wider than the screen (see the related "content wider than the screen" issues) and give it max-width: 100%, flexible widths, or wrapping.',
  },
  CONTENT_OVERFLOW: {
    title: 'Content wider than the screen',
    fix: 'Avoid fixed widths larger than the screen. Use max-width: 100%, relative units, flex-wrap, or a responsive layout for small screens.',
  },
  OUT_OF_VIEWPORT: {
    title: 'Content cut off at the screen edge',
    fix: 'Keep the element inside the screen width (max-width: 100%, responsive layout). Hidden overflow can hide important content.',
  },
  TEXT_CLIPPING: {
    title: 'Text is cut off',
    fix: 'Let the container grow with its text (avoid fixed heights/widths), allow wrapping, or use text-overflow: ellipsis with the full text available (e.g. in a title).',
  },
  OVERLAPPING_ELEMENTS: {
    title: 'Control is covered by another element',
    fix: 'Adjust positioning or z-index so the control is not covered, and check the layout at this screen size.',
  },
  EMPTY_BUTTON: {
    title: 'Button without text or label',
    fix: 'Add visible text, or an aria-label describing the action (e.g. aria-label="Close").',
  },
  EMPTY_LINK: {
    title: 'Link without text or label',
    fix: 'Add link text, or an aria-label / alt text on the image inside the link describing where it goes.',
  },
  IMAGE_SIZING: {
    title: 'Stretched (distorted) image',
    fix: 'Keep the original aspect ratio: set only width or height, or use object-fit: cover / contain.',
  },
  BROKEN_LINK: {
    title: 'Broken link',
    fix: 'Update the link to a working address or remove it. Internal broken links usually mean a page was moved or deleted.',
  },
  FAILED_STYLESHEET: {
    title: 'Stylesheet failed to load',
    fix: 'Check the stylesheet URL and that the file is deployed. Missing CSS can break the whole layout.',
  },
  FAILED_SCRIPT: {
    title: 'Script failed to load',
    fix: 'Check the script URL and that the file is deployed. Missing JavaScript can break interactive features.',
  },
  CONSOLE_ERROR: {
    title: 'Console error',
    fix: 'Open the browser developer tools on this page, reproduce the message and fix its cause.',
  },
  JS_ERROR: {
    title: 'Uncaught JavaScript error',
    fix: 'An exception was thrown and not handled. Open developer tools, reproduce it and fix or catch the error.',
  },
  FAILED_REQUEST: {
    title: 'Failed network request',
    fix: 'Check the request URL and the server response. Repeated failures can mean missing files or a broken API.',
  },
};

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
  const ruleId = `ui/${check.toLowerCase().replace(/_/g, '-')}`;
  return {
    id: randomUUID(),
    category,
    severity: values.severity,
    ruleId,
    title: UI_TEXT[check].title,
    description: values.description,
    pageUrl: ctx.pageUrl,
    viewport: ctx.viewport,
    selector: values.selector ?? null,
    htmlSnippet: truncate(values.html, 2000),
    boundingBox: values.box ?? null,
    suggestedFix: UI_TEXT[check].fix,
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
  return findings.map((finding) =>
    uiDraft(finding.check, ctx, category, {
      severity: finding.severity,
      description: finding.message,
      selector: finding.selector,
      html: finding.html,
      box: finding.box,
      resourceUrl: typeof finding.measurements?.src === 'string' ? finding.measurements.src : null,
      measurements: finding.measurements,
      target:
        finding.check === 'BROKEN_IMAGE'
          ? String(finding.measurements?.src ?? finding.selector)
          : finding.selector,
    }),
  );
}

/** Failed resources, console messages and uncaught exceptions → issues. */
export function networkToDrafts(
  log: PageNetworkLog,
  ctx: IssueContext,
  siteHostname: string,
  alreadyReportedImages: Set<string>,
): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  const seen = new Set<string>();

  for (const request of log.failedRequests) {
    if (request.blockedByPolicy) continue; // our proxy refused it (private address): not the site's fault
    const key = `${request.resourceType}|${request.url}`;
    if (seen.has(key) || request.resourceType === 'document') continue;
    seen.add(key);
    const problem = request.status ? `HTTP ${request.status}` : (request.error ?? 'failed');
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
          description: `${request.url} could not be loaded (${problem}).`,
          resourceUrl: request.url,
          statusCode: request.status ?? null,
          target: request.url,
        }),
      );
    } else if (request.resourceType === 'image') {
      if (alreadyReportedImages.has(request.url)) continue; // the DOM check already pointed at the <img>
      drafts.push(
        uiDraft('BROKEN_IMAGE', ctx, 'UI_HEALTH', {
          severity: 'MEDIUM',
          description: `The image ${request.url} could not be loaded (${problem}).`,
          resourceUrl: request.url,
          statusCode: request.status ?? null,
          target: request.url,
        }),
      );
    } else if (drafts.filter((d) => d.uiHealth?.checkType === 'FAILED_REQUEST').length < 20) {
      const isFavicon = /favicon\.ico($|\?)/.test(request.url);
      drafts.push(
        uiDraft('FAILED_REQUEST', ctx, 'UI_HEALTH', {
          severity: isFavicon || thirdParty ? 'INFO' : 'LOW',
          description: `A ${request.resourceType} request to ${request.url} failed (${problem}).`,
          resourceUrl: request.url,
          statusCode: request.status ?? null,
          target: request.url,
        }),
      );
    }
  }

  const consoleSeen = new Set<string>();
  for (const entry of log.consoleErrors.slice(0, 10)) {
    if (consoleSeen.has(entry.text)) continue;
    consoleSeen.add(entry.text);
    drafts.push(
      uiDraft('CONSOLE_ERROR', ctx, 'UI_HEALTH', {
        severity: 'LOW',
        description: entry.text,
        resourceUrl: entry.source ?? null,
        target: entry.text.slice(0, 200),
      }),
    );
  }
  const errorSeen = new Set<string>();
  for (const entry of log.pageErrors.slice(0, 10)) {
    if (errorSeen.has(entry.message)) continue;
    errorSeen.add(entry.message);
    drafts.push(
      uiDraft('JS_ERROR', ctx, 'UI_HEALTH', {
        severity: 'MEDIUM',
        description: entry.message,
        target: entry.message.slice(0, 200),
      }),
    );
  }
  return drafts;
}
