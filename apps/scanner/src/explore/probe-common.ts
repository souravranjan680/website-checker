/**
 * What the keyboard and form probes share (Phase 9, Milestone 2, Checkpoint 2): a fresh,
 * prepared copy of the page, calls into the in-page code, and the rule that a probe step
 * during which something else happened is not claimed (INCONCLUSIVE).
 */
import type { SideEffectReport } from '@whc/dom-checks';
import type { Page } from 'playwright';
import { STABILIZE_CSS } from '../audits/visual';
import type { PageNetworkLog } from '../checks/collectors';
import type { IssueDraft } from '../issues';
import { PAGE_GUARDS, type BlockedAction } from './safety';

export interface ProbeParams {
  page: Page;
  url: string;
  domBundle: string;
  log: PageNetworkLog;
  blocked: BlockedAction[];
  allowNavigation: (url: string) => void;
  collectPageBlocks: (page: Page) => Promise<void>;
  checkpoint: () => void;
}

/** Loads the page again (the safety layer stays armed) and injects the in-page code. */
export async function freshPage(params: ProbeParams): Promise<boolean> {
  const { page } = params;
  params.allowNavigation(params.url);
  try {
    await page.goto(params.url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.addStyleTag({ content: STABILIZE_CSS });
    await page.evaluate(params.domBundle);
    await page.evaluate(PAGE_GUARDS);
    return true;
  } catch {
    return false;
  }
}

/** window.__whcDomChecks.<area>.<fn>(...args) inside the page. */
export function inPage<T>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(`window.__whcDomChecks.${path}(...${JSON.stringify(args)})`) as Promise<T>;
}

/** Learns which elements change on their own (clocks, carousels), for the side-effect watch. */
export async function sideEffectBaseline(page: Page): Promise<void> {
  await page.evaluate('window.__whcDomChecks.sideEffects.startBaseline()');
  await page.waitForTimeout(300);
  await page.evaluate('window.__whcDomChecks.sideEffects.stopBaseline()');
}

/** What else happened during one probe step. */
export interface Disturbance {
  blocked: BlockedAction[];
  errors: number;
  unrelatedChanges: SideEffectReport['unrelated'];
}

/** Starts counting blocked actions and page errors for one step. */
export function stepMarks(params: ProbeParams) {
  const blockedBefore = params.blocked.length;
  const errorsBefore = params.log.pageErrors.length;
  return async (effects: SideEffectReport | null): Promise<Disturbance | null> => {
    await params.collectPageBlocks(params.page);
    const blocked = params.blocked.slice(blockedBefore);
    const errors = params.log.pageErrors.length - errorsBefore;
    const unrelated = effects && effects.counts.unrelated > 0 ? effects.unrelated : [];
    return blocked.length > 0 || errors > 0 || unrelated.length > 0
      ? { blocked: blocked.slice(0, 10), errors, unrelatedChanges: unrelated }
      : null;
  };
}

/**
 * A finding from a step during which something else happened (a blocked request or
 * navigation, a JavaScript error, a change elsewhere in the page) is not claimed: real
 * users may see something different.
 */
export function markDisturbed(draft: IssueDraft, disturbance: Disturbance | null): IssueDraft {
  if (!disturbance || !draft.functional) return draft;
  draft.functional.classification = 'INCONCLUSIVE';
  const what = [
    disturbance.blocked.length > 0
      ? `${disturbance.blocked.length} action(s) blocked for safety`
      : null,
    disturbance.errors > 0 ? `${disturbance.errors} JavaScript error(s)` : null,
    disturbance.unrelatedChanges.length > 0 ? 'changes elsewhere in the page' : null,
  ].filter(Boolean);
  draft.description = `${draft.description} Not claimed: during this step there were ${what.join(', ')}, so the page may behave differently for real users.`;
  draft.details = { ...(draft.details ?? {}), disturbance };
  draft.functional.interaction = draft.details;
  return draft;
}
