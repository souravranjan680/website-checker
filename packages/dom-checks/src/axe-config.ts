/**
 * The axe-core configuration shared by the server scanner and the Chrome extension,
 * so both run exactly the same accessibility rules on a page.
 * No imports at runtime: safe for Node.js and for the browser.
 */

/** Subset of axe-core's result shape that we use. */
export interface AxeNode {
  target: unknown[];
  html: string;
  impact?: string | null;
  failureSummary?: string;
}

export interface AxeRuleResult {
  id: string;
  impact?: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

export interface AxeOutput {
  violations: AxeRuleResult[];
  incomplete: AxeRuleResult[];
  axeVersion: string;
}

/** WCAG 2.0/2.1/2.2 level A and AA rules plus axe's best practices (e.g. heading order). */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Options passed to axe.run(document, AXE_OPTIONS). */
export const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: AXE_TAGS },
  resultTypes: ['violations', 'incomplete'],
  elementRef: false,
  ancestry: false,
  xpath: false,
};

/** axe rules about unnamed controls; the DOM checks skip elements these already reported. */
export const UNNAMED_CONTROL_RULES = ['button-name', 'link-name', 'input-button-name'];

/** axe targets are CSS selectors; nested arrays mean "inside an iframe/shadow root". */
export function axeSelector(target: unknown[]): string | null {
  const first = target[0];
  if (typeof first === 'string') return first;
  if (Array.isArray(first))
    return first.filter((part) => typeof part === 'string').join(' >>> ') || null;
  return null;
}

/** Selectors of controls axe already reported as unnamed (passed to the DOM checks). */
export function unnamedControlSelectors(axe: Pick<AxeOutput, 'violations'>): string[] {
  return axe.violations
    .filter((rule) => UNNAMED_CONTROL_RULES.includes(rule.id))
    .flatMap((rule) => rule.nodes.map((node) => axeSelector(node.target)))
    .filter((s): s is string => Boolean(s));
}
