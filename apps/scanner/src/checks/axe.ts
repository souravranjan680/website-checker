import axe from 'axe-core';
import type { Page } from 'playwright';

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

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: AXE_TAGS },
  resultTypes: ['violations', 'incomplete'],
  elementRef: false,
  ancestry: false,
  xpath: false,
};

/**
 * Runs axe-core inside the page. axe walks the live DOM and the accessibility
 * tree and tests each element against its rules (e.g. "every <img> needs an alt",
 * "text contrast ≥ 4.5:1"). It reports:
 *   violations: definite failures
 *   incomplete: "needs review": axe couldn't decide automatically
 * Injected with page.evaluate, which works even on pages whose CSP blocks inline scripts.
 */
export async function runAxe(page: Page): Promise<AxeOutput> {
  await page.evaluate(axe.source);
  const result = (await page.evaluate(
    `axe.run(document, ${JSON.stringify(AXE_OPTIONS)}).then((r) => ({ violations: r.violations, incomplete: r.incomplete, axeVersion: r.testEngine.version }))`,
  )) as AxeOutput;
  return result;
}

/** axe targets are CSS selectors; nested arrays mean "inside an iframe/shadow root". */
export function axeSelector(target: unknown[]): string | null {
  const first = target[0];
  if (typeof first === 'string') return first;
  if (Array.isArray(first))
    return first.filter((part) => typeof part === 'string').join(' >>> ') || null;
  return null;
}

/** Page-coordinate boxes for a list of selectors (null if not found). */
export async function boxesFor(
  page: Page,
  selectors: string[],
): Promise<({ x: number; y: number; width: number; height: number } | null)[]> {
  if (selectors.length === 0) return [];
  const script = `(${JSON.stringify(selectors)}).map((s) => {
    try {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
    } catch { return null; }
  })`;
  return (await page.evaluate(script)) as ({
    x: number;
    y: number;
    width: number;
    height: number;
  } | null)[];
}
