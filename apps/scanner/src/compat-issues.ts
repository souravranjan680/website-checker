/**
 * Issue drafts for cross-browser differences (Phase 9, Milestone 3, Checkpoint 2). They are
 * ordinary issues in the COMPATIBILITY category, which no score uses: saved, tracked,
 * reviewed and exported like every other issue, with a CompatibilityIssue detail row.
 */
import { randomUUID } from 'node:crypto';
import { truncate } from '@whc/dom-checks';
import { fingerprint, type IssueContext, type IssueDraft } from './issues';
import type { CompatCheck, Difference } from './pipeline/compat-diff';

const TEXT: Record<CompatCheck, { title: string; fix: string }> = {
  BROWSER_ONLY_ERROR: {
    title: 'JavaScript error in one browser only',
    fix: 'Reproduce in that browser and fix or guard the code: it probably uses a feature this browser lacks. Feature-detect it (e.g. "if (\'x\' in Element.prototype)") or add a fallback.',
  },
  BROWSER_ONLY_RESOURCE_FAILURE: {
    title: 'Resource fails in one browser only',
    fix: 'This browser requested a file the others did not (for example a different image format, a polyfill or a browser-specific bundle) and the server refused it. Deploy the file or fix the URL.',
  },
  BROWSER_ONLY_FONT_FAILURE: {
    title: 'Web font fails in one browser only',
    fix: 'Check the font sources and formats this browser uses (the @font-face src list and any browser-specific styles) and that the files exist.',
  },
  BROWSER_ONLY_LAYOUT: {
    title: 'Layout problem in one browser only',
    fix: 'Open the page in that browser at this size. Usually a CSS or JavaScript feature the browser does not support changes the layout; add a fallback or use @supports.',
  },
  BROWSER_ONLY_ACCESSIBILITY: {
    title: 'Accessibility result differs in one browser',
    fix: 'Check the element in that browser. Differences are often caused by rendering (e.g. measured colour contrast) rather than by the markup.',
  },
  UNSUPPORTED_CSS: {
    title: 'CSS the browser does not support',
    fix: 'The page applies CSS this browser reports it cannot use. Check whether the page still looks right there; if not, add a fallback (for example inside @supports).',
  },
};

const SEVERITY = {
  DETECTED: 'MEDIUM',
  POTENTIAL_DEFECT: 'MEDIUM',
  OBSERVATION: 'LOW',
  INCONCLUSIVE: 'INFO',
} as const;
const NAME = { FIREFOX: 'Firefox', WEBKIT: 'WebKit' } as const;

export function compatibilityDraft(
  difference: Difference,
  ctx: IssueContext,
  browser: { engine: 'FIREFOX' | 'WEBKIT'; version: string; baselineVersion: string },
): IssueDraft {
  const ruleId = `compat/${difference.check.toLowerCase().replace(/_/g, '-')}`;
  const evidence = {
    browser: browser.engine,
    browserVersion: browser.version,
    baselineVersion: browser.baselineVersion,
    underlying: difference.underlying,
    ...difference.evidence,
  };
  return {
    id: randomUUID(),
    category: 'COMPATIBILITY',
    severity: SEVERITY[difference.classification],
    ruleId,
    title: `${TEXT[difference.check].title}: ${NAME[browser.engine]}`,
    description: `${difference.summary} Compared with ${browser.baselineVersion} on the same page at ${ctx.viewport}; ${browser.version}.`,
    pageUrl: ctx.pageUrl,
    viewport: ctx.viewport,
    selector: difference.selector,
    htmlSnippet: truncate(difference.html, 2000),
    boundingBox: null,
    suggestedFix: TEXT[difference.check].fix,
    details: evidence,
    fingerprint: fingerprint({
      ...ctx,
      category: 'COMPATIBILITY',
      ruleId,
      target: `${browser.engine}|${difference.key}`,
    }),
    compatibility: {
      browser: browser.engine,
      browserVersion: browser.version,
      baselineVersion: browser.baselineVersion,
      checkType: difference.check,
      classification: difference.classification,
      matchMethod: difference.matchMethod,
      evidence,
    },
  };
}
