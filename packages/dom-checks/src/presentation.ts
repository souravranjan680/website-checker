/**
 * How a check result is presented as an issue: rule ID, severity, title, WCAG
 * references and suggested fix. Shared by the server scanner (which adds IDs,
 * fingerprints and screenshots) and the Chrome extension, so both describe the
 * same problem in the same words. No imports at runtime: safe for Node.js and browsers.
 */
import { axeSelector, type AxeNode, type AxeOutput, type AxeRuleResult } from './axe-config';
import type { Box, DomCheckName, DomFinding } from './types';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

export type UiCheckType =
  | DomCheckName
  | 'BROKEN_LINK'
  | 'FAILED_STYLESHEET'
  | 'FAILED_SCRIPT'
  | 'CONSOLE_ERROR'
  | 'JS_ERROR'
  | 'FAILED_REQUEST'
  | ExtraCheckName;

/**
 * Checks added in Phase 9, Milestone 2 (layout, fonts and icons, component
 * consistency). They run only when the scanner asks for them (never in the Chrome
 * extension) and do not count towards any score.
 */
export const EXTRA_CHECKS = [
  'TEXT_OVERFLOW_VISIBLE',
  'TEXT_OVERLAP',
  'FIXED_OUT_OF_VIEWPORT',
  'CONTROL_LABEL_CLIPPED',
  'FONT_LOAD_FAILED',
  'FONT_FALLBACK_RENDERED',
  'ICON_BROKEN',
  'ICON_MISSING',
  'COMPONENT_INCONSISTENT',
] as const;
export type ExtraCheckName = (typeof EXTRA_CHECKS)[number];

export const truncate = (text: string | null | undefined, max: number): string | null =>
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
const MAX_NODES_NEEDS_REVIEW = 10;

/** One element that failed (or needs review for) one axe rule, ready to show. */
export interface AxeFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  selector: string | null;
  html: string | null;
  suggestedFix: string;
  /** Set when the rule matched more elements than are listed. */
  totalElements: number | null;
  impact: string | null;
  wcagCriteria: string[];
  wcagLevel: string | null;
  tags: string[];
  helpUrl: string;
  detection: 'AUTOMATED' | 'NEEDS_REVIEW';
  failureSummary: string | null;
}

/** axe violations (automated) and incomplete results ("needs review") → findings. */
export function axeFindings(axe: Pick<AxeOutput, 'violations' | 'incomplete'>): AxeFinding[] {
  const findings: AxeFinding[] = [];
  const convert = (rule: AxeRuleResult, detection: 'AUTOMATED' | 'NEEDS_REVIEW') => {
    const { criteria, level } = wcagFromTags(rule.tags);
    const limit = detection === 'AUTOMATED' ? MAX_NODES_PER_RULE : MAX_NODES_NEEDS_REVIEW;
    const nodes: AxeNode[] = rule.nodes.slice(0, limit);
    for (const node of nodes) {
      const impact = node.impact ?? rule.impact ?? null;
      findings.push({
        ruleId: rule.id,
        severity:
          detection === 'NEEDS_REVIEW' ? 'INFO' : (IMPACT_TO_SEVERITY[impact ?? ''] ?? 'MEDIUM'),
        title: detection === 'NEEDS_REVIEW' ? `Needs review: ${rule.help}` : rule.help,
        description: rule.description,
        selector: axeSelector(node.target),
        html: truncate(node.html, 2000),
        suggestedFix: [node.failureSummary, `Guidance: ${rule.helpUrl}`]
          .filter(Boolean)
          .join('\n\n'),
        totalElements: rule.nodes.length > nodes.length ? rule.nodes.length : null,
        impact,
        wcagCriteria: criteria,
        wcagLevel: level,
        tags: rule.tags,
        helpUrl: rule.helpUrl,
        detection,
        failureSummary: truncate(node.failureSummary, 2000),
      });
    }
  };
  for (const rule of axe.violations) convert(rule, 'AUTOMATED');
  for (const rule of axe.incomplete) convert(rule, 'NEEDS_REVIEW');
  return findings;
}

// ------------------------------------------------------------- UI checks

export const UI_CHECK_TEXT: Record<UiCheckType, { title: string; fix: string }> = {
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
  TEXT_OVERFLOW_VISIBLE: {
    title: 'Text spills out of its box onto other content',
    fix: 'The box has a fixed or maximum height that is too small for its text. Let it grow (min-height instead of height), shorten the text, or let the container scroll.',
  },
  TEXT_OVERLAP: {
    title: 'Text overlaps other text',
    fix: 'Two pieces of text are drawn on top of each other. Check absolute positioning, negative margins and fixed heights around them, at this screen size.',
  },
  FIXED_OUT_OF_VIEWPORT: {
    title: 'Fixed element partly off the screen',
    fix: 'A fixed element does not scroll with the page, so its hidden part can never be reached. Limit its height (max-height: 100vh with overflow: auto) or reposition it.',
  },
  CONTROL_LABEL_CLIPPED: {
    title: 'Control label does not fit',
    fix: 'The button or link is too small for its label. Let it grow with its text (avoid fixed widths and heights), allow wrapping, or shorten the label.',
  },
  FONT_LOAD_FAILED: {
    title: 'Web font failed to load',
    fix: 'Check the @font-face src URL and that the font file is deployed and served with the right CORS headers. Until then, text uses a fallback font.',
  },
  FONT_FALLBACK_RENDERED: {
    title: 'Text shown in a fallback font',
    fix: 'The page asks for a web font that did not load, so the browser used another font. Fix the font loading, or choose a fallback stack that matches the design.',
  },
  ICON_BROKEN: {
    title: 'Broken icon',
    fix: 'The icon refers to an SVG symbol or icon font that is missing. Check the sprite file, the symbol id, or the icon font’s @font-face.',
  },
  ICON_MISSING: {
    title: 'Icon-only control shows nothing',
    fix: 'The control is labelled for screen readers but nothing is visible inside it. Check that its icon loads and has a size.',
  },
  COMPONENT_INCONSISTENT: {
    title: 'Component styled differently from its siblings',
    fix: 'Elements with the same classes in the same kind of place usually look the same. Check whether this difference is intended; if not, remove the overriding style.',
  },
};

/** "BROKEN_IMAGE" → "ui/broken-image". */
export function uiRuleId(check: UiCheckType): string {
  return `ui/${check.toLowerCase().replace(/_/g, '-')}`;
}

/** One DOM check finding, ready to show. */
export interface UiFinding {
  ruleId: string;
  check: DomCheckName;
  severity: Severity;
  title: string;
  description: string;
  selector: string;
  html: string | null;
  box: Box | null;
  suggestedFix: string;
  measurements?: DomFinding['measurements'];
}

export function domFindingPresentation(finding: DomFinding): UiFinding {
  return {
    ruleId: uiRuleId(finding.check),
    check: finding.check,
    severity: finding.severity,
    title: UI_CHECK_TEXT[finding.check].title,
    description: finding.message,
    selector: finding.selector,
    html: truncate(finding.html, 2000),
    box: finding.box,
    suggestedFix: UI_CHECK_TEXT[finding.check].fix,
    measurements: finding.measurements,
  };
}
