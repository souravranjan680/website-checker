import { AXE_OPTIONS, type AxeOutput } from '@whc/dom-checks';
import axe from 'axe-core';
import type { Page } from 'playwright';

// The rule set (AXE_OPTIONS) is shared with the Chrome extension: @whc/dom-checks.
export {
  AXE_TAGS,
  axeSelector,
  type AxeNode,
  type AxeOutput,
  type AxeRuleResult,
} from '@whc/dom-checks';

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
