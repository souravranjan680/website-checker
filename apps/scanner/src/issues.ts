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
  'ACCESSIBILITY' | 'UI_HEALTH' | 'RESPONSIVE' | 'PERFORMANCE' | 'SEO' | 'SECURITY' | 'FUNCTIONAL';

/** Interaction and navigation checks of the safe explorer (Phase 9, Milestone 1). */
export type FunctionalCheck =
  | 'CONTROL_NO_EFFECT'
  | 'LAYER_CLIPPED'
  | 'LAYER_OCCLUDED'
  | 'LAYER_BLANK_AREA'
  | 'LAYER_NOT_DISMISSIBLE'
  | 'ESCAPE_NOT_SUPPORTED'
  | 'TAB_PANEL_NOT_SHOWN'
  | 'INTERACTION_ERROR'
  | 'BROKEN_ANCHOR'
  | 'NAV_CURRENT_MISMATCH'
  // Keyboard and form probes (Milestone 2, Checkpoint 2)
  | 'FOCUS_NOT_VISIBLE'
  | 'FOCUS_ON_HIDDEN'
  | 'FOCUS_LOST'
  | 'KEYBOARD_TRAP'
  | 'KEY_ACTIVATION_FAILED'
  | 'CLICK_NOT_FOCUSABLE'
  | 'FORM_REQUIRED_NOT_INDICATED'
  | 'FORM_INDICATOR_WITHOUT_REQUIRED'
  | 'FORM_DESCRIBEDBY_MISSING'
  | 'FORM_PLACEHOLDER_ONLY_LABEL'
  | 'FORM_ERROR_NOT_ASSOCIATED'
  | 'FORM_NO_BLUR_FEEDBACK';

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
    /** Set by the Milestone 2 checks, which decide the strength of their own evidence. */
    classification?: FindingClassification;
  };
  seo?: { checkType: string; expected: string | null; actual: string | null };
  functional?: {
    checkType: FunctionalCheck;
    /** Set by the explorer for every functional finding (see classifyDraft). */
    classification: FindingClassification;
    controlName: string | null;
    controlRole: string | null;
    controlSelector: string | null;
    interaction: Record<string, unknown> | null;
  };
  security?: {
    checkType: string;
    findingLevel: 'OBSERVATION' | 'WARNING' | 'CONFIRMED';
    headerName: string | null;
    observedValue: string | null;
    recommendedValue: string | null;
  };
}

export type FindingClassification =
  'DETECTED' | 'POTENTIAL_DEFECT' | 'OBSERVATION' | 'INCONCLUSIVE';

/** UI checks whose result is objective (measured or rule-based), not a judgement. */
const OBJECTIVE_UI_CHECKS = new Set<UiCheckType>([
  'HORIZONTAL_SCROLL',
  'EMPTY_BUTTON',
  'EMPTY_LINK',
]);
/** Resource checks: objective only when the re-check confirmed the failure. */
const RESOURCE_CHECKS = new Set<UiCheckType>([
  'BROKEN_IMAGE',
  'BROKEN_LINK',
  'FAILED_STYLESHEET',
  'FAILED_SCRIPT',
  'FAILED_REQUEST',
]);

/**
 * How strong the evidence for an issue is (Phase 9). Rules (the migration
 * 20261103001300_phase9_m0_classification_review applies the same to older rows):
 *   accessibility  axe violation → DETECTED; axe "needs review" → INCONCLUSIVE
 *   security       CONFIRMED → DETECTED; WARNING → POTENTIAL_DEFECT; OBSERVATION → OBSERVATION
 *   SEO            DETECTED (rule checks on page facts)
 *   performance    POTENTIAL_DEFECT (lab measurement)
 *   UI / responsive
 *     confirmed resource failures, horizontal scroll, unnamed button/link → DETECTED
 *     unconfirmed resource failures (scans before re-checks existed) → POTENTIAL_DEFECT
 *     console: third-party or network messages → OBSERVATION; others → POTENTIAL_DEFECT
 *     other layout heuristics → POTENTIAL_DEFECT
 * Human decisions (confirmed, intentional) are separate: TrackedIssue.reviewStatus.
 */
export function classifyDraft(draft: IssueDraft): FindingClassification {
  // Interaction findings are classified by the explorer, which has the evidence.
  if (draft.functional) return draft.functional.classification;
  // So are the Milestone 2 checks (layout, fonts and icons, consistency).
  if (draft.uiHealth?.classification) return draft.uiHealth.classification;
  if (draft.accessibility) {
    return draft.accessibility.detection === 'AUTOMATED' ? 'DETECTED' : 'INCONCLUSIVE';
  }
  if (draft.security) {
    const level = draft.security.findingLevel;
    return level === 'CONFIRMED'
      ? 'DETECTED'
      : level === 'WARNING'
        ? 'POTENTIAL_DEFECT'
        : 'OBSERVATION';
  }
  if (draft.category === 'SEO') return 'DETECTED';
  if (draft.category === 'PERFORMANCE') return 'POTENTIAL_DEFECT';
  const check = draft.uiHealth?.checkType;
  if (!check) return 'POTENTIAL_DEFECT';
  if (OBJECTIVE_UI_CHECKS.has(check)) return 'DETECTED';
  if (RESOURCE_CHECKS.has(check)) {
    return draft.uiHealth?.measurements?.verdict === 'CONFIRMED' ? 'DETECTED' : 'POTENTIAL_DEFECT';
  }
  if (check === 'CONSOLE_ERROR' || check === 'JS_ERROR') {
    const kind = draft.uiHealth?.measurements?.kind;
    return kind === 'THIRD_PARTY' || kind === 'NETWORK' ? 'OBSERVATION' : 'POTENTIAL_DEFECT';
  }
  return 'POTENTIAL_DEFECT';
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

const FUNCTIONAL_TEXT: Record<FunctionalCheck, { title: string; fix: string }> = {
  CONTROL_NO_EFFECT: {
    title: 'Control does nothing when used',
    fix: 'Check the control’s click handler and what it should open. If it opens a menu or section, make sure that content becomes visible and aria-expanded reflects the state.',
  },
  LAYER_CLIPPED: {
    title: 'Opened menu or panel is cut off',
    fix: 'A container with overflow: hidden, or the window edge, cuts the opened content. Position the layer outside the clipping container (e.g. render it at the end of <body>) or let it flip/shift to stay inside the window.',
  },
  LAYER_OCCLUDED: {
    title: 'Items of an opened menu are hidden behind other content',
    fix: 'Another element covers part of the opened layer. Give the layer a higher stacking order (z-index in the right stacking context) or move the covering element.',
  },
  LAYER_BLANK_AREA: {
    title: 'Opened menu or panel has a large empty area',
    fix: 'Check for missing content (failed data, an empty list) or a fixed height that is too large for its contents.',
  },
  LAYER_NOT_DISMISSIBLE: {
    title: 'Opened menu cannot be closed',
    fix: 'Let users close the menu with Escape, by clicking outside it, and by using the control again.',
  },
  ESCAPE_NOT_SUPPORTED: {
    title: 'Opened menu does not close with Escape',
    fix: 'Close menus and pop-ups when Escape is pressed and return focus to the control that opened them (WAI-ARIA menu pattern).',
  },
  TAB_PANEL_NOT_SHOWN: {
    title: 'Selected tab does not show its panel',
    fix: 'When a tab becomes selected, show the panel named by its aria-controls (and hide the others).',
  },
  INTERACTION_ERROR: {
    title: 'JavaScript error while using a control',
    fix: 'Open developer tools, use the control and fix the error. Errors during interactions often leave menus or panels half-working.',
  },
  BROKEN_ANCHOR: {
    title: 'Link points to a section that does not exist',
    fix: 'Add an element with the matching id to the page, or correct the link’s #fragment.',
  },
  NAV_CURRENT_MISMATCH: {
    title: 'Navigation marks the wrong page as current',
    fix: 'Mark the item of the page being shown as current (aria-current="page" and the "active" style), not another item.',
  },
  FOCUS_NOT_VISIBLE: {
    title: 'Keyboard focus is not visible',
    fix: 'Give focused elements a clear indicator (e.g. :focus-visible { outline: 2px solid } ). Do not remove the outline without a replacement (WCAG 2.4.7).',
  },
  FOCUS_ON_HIDDEN: {
    title: 'Keyboard focus lands on something hidden',
    fix: 'Elements that cannot be seen (closed menus, off-screen panels) must not be reachable with Tab: hide them with display: none, visibility: hidden or the inert attribute while closed.',
  },
  FOCUS_LOST: {
    title: 'Keyboard focus is lost',
    fix: 'When the focused element disappears or is replaced, move focus to a sensible element (the next control, or the new content) instead of letting it fall back to the page.',
  },
  KEYBOARD_TRAP: {
    title: 'Keyboard trap',
    fix: 'Tab must be able to leave every component (WCAG 2.1.2). Only an open modal dialog may keep focus inside, and it must close with Escape.',
  },
  KEY_ACTIVATION_FAILED: {
    title: 'Control cannot be used with the keyboard',
    fix: 'Use a native <button> (or <a href>), or make the custom control focusable (tabindex="0") and activate it on Enter and, for buttons, on Space.',
  },
  CLICK_NOT_FOCUSABLE: {
    title: 'Clickable element cannot be reached with the keyboard',
    fix: 'Use a <button> or <a href> for things people click, or add tabindex="0", a role and keyboard handling.',
  },
  FORM_REQUIRED_NOT_INDICATED: {
    title: 'Required field is not marked as required',
    fix: 'Show that the field is required in its label (e.g. "Name *", with a note explaining the asterisk, or the word "required").',
  },
  FORM_INDICATOR_WITHOUT_REQUIRED: {
    title: 'Field marked as required but not required in the code',
    fix: 'Add the required attribute (or aria-required="true") so assistive technology and the browser know, or remove the mark if the field is optional.',
  },
  FORM_DESCRIBEDBY_MISSING: {
    title: 'Field points to a description that does not exist',
    fix: 'aria-describedby and aria-errormessage must name the id of an element in the page; fix the id or add the element.',
  },
  FORM_PLACEHOLDER_ONLY_LABEL: {
    title: 'Field has only a placeholder as its label',
    fix: 'Add a visible <label>. Placeholders disappear while typing and often have low contrast.',
  },
  FORM_ERROR_NOT_ASSOCIATED: {
    title: 'Error message is not linked to its field',
    fix: 'Link the message with aria-describedby (or aria-errormessage) and set aria-invalid="true" on the field, so screen readers announce it.',
  },
  FORM_NO_BLUR_FEEDBACK: {
    title: 'No feedback when leaving an empty required field',
    fix: 'Many sites validate only when the form is submitted, which is fine. If yours should validate earlier, show the message next to the field and link it.',
  },
};

/** A finding of the safe explorer (Phase 9). Fingerprinted by check + control. */
export function functionalDraft(
  check: FunctionalCheck,
  ctx: IssueContext,
  values: {
    severity: Severity;
    classification: FindingClassification;
    description: string;
    control: { name: string; role: string; selector: string; html?: string | null } | null;
    box?: Box | null;
    interaction?: Record<string, unknown> | null;
    target: string;
  },
): IssueDraft {
  const ruleId = `functional/${check.toLowerCase().replace(/_/g, '-')}`;
  return {
    id: randomUUID(),
    category: 'FUNCTIONAL',
    severity: values.severity,
    ruleId,
    title: FUNCTIONAL_TEXT[check].title,
    description: values.description,
    pageUrl: ctx.pageUrl,
    viewport: ctx.viewport,
    selector: values.control?.selector ?? null,
    htmlSnippet: truncate(values.control?.html, 2000),
    boundingBox: values.box ?? null,
    suggestedFix: FUNCTIONAL_TEXT[check].fix,
    details: values.interaction ?? null,
    fingerprint: fingerprint({ ...ctx, category: 'FUNCTIONAL', ruleId, target: values.target }),
    functional: {
      checkType: check,
      classification: values.classification,
      controlName: values.control?.name ?? null,
      controlRole: values.control?.role ?? null,
      controlSelector: values.control?.selector ?? null,
      interaction: values.interaction ?? null,
    },
  };
}

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
    classification?: FindingClassification;
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
      ...(values.classification ? { classification: values.classification } : {}),
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
 * `reportedElsewhere`: URLs a more specific issue already explains (a font face that
 * failed, a missing icon sprite), verified to be the same file; all others stay.
 */
export function networkToDrafts(
  log: PageNetworkLog,
  ctx: IssueContext,
  siteHostname: string,
  alreadyReportedImages: Set<string>,
  reportedElsewhere: Set<string> = new Set(),
): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  const seen = new Set<string>();

  for (const request of log.failedRequests) {
    if (request.blockedByPolicy || request.verdict !== 'CONFIRMED') continue;
    const key = `${request.resourceType}|${request.url}`;
    if (seen.has(key) || request.resourceType === 'document') continue;
    if (reportedElsewhere.has(request.url)) continue;
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
