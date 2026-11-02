import type { AxeFinding, UiFinding } from '@whc/dom-checks';

/** Everything one local check of one page found. Kept in the popup's memory only. */
export interface PageCheckResult {
  url: string;
  title: string;
  checkedAt: string;
  axeVersion: string;
  viewport: { width: number; height: number };
  accessibility: AxeFinding[];
  ui: UiFinding[];
  /** Images that looked broken but displayed after one retry: not reported as issues. */
  imagesFixedOnRetry: string[];
  /** Embedded frames are not checked (their content belongs to their own page). */
  frames: { total: number; crossOrigin: number };
}

/** One row of the popup's issue list. */
export interface ExtensionIssue {
  key: string;
  category: 'ACCESSIBILITY' | 'UI_HEALTH';
  ruleId: string;
  severity: AxeFinding['severity'];
  title: string;
  description: string;
  selector: string | null;
  html: string | null;
  suggestedFix: string;
  wcag: string[];
  wcagLevel: string | null;
  needsReview: boolean;
}

export function toIssues(result: PageCheckResult): ExtensionIssue[] {
  return [
    ...result.accessibility.map((f, index) => ({
      key: `a${index}`,
      category: 'ACCESSIBILITY' as const,
      ruleId: f.ruleId,
      severity: f.severity,
      title: f.title,
      description: f.description,
      selector: f.selector,
      html: f.html,
      suggestedFix: f.suggestedFix,
      wcag: f.wcagCriteria,
      wcagLevel: f.wcagLevel,
      needsReview: f.detection === 'NEEDS_REVIEW',
    })),
    ...result.ui.map((f, index) => ({
      key: `u${index}`,
      category: 'UI_HEALTH' as const,
      ruleId: f.ruleId,
      severity: f.severity,
      title: f.title,
      description: f.description,
      selector: f.selector,
      html: f.html,
      suggestedFix: f.suggestedFix,
      wcag: [],
      wcagLevel: null,
      needsReview: false,
    })),
  ];
}
