/**
 * Keyboard probe (Phase 9, Milestone 2, Checkpoint 2). Runs after the explorer on the
 * same page, in the explorer's context with the safety layer armed:
 *   1. Tab walk from the top (at most 100 steps): is focus visible, can the focused
 *      element be seen, is focus lost, is there a trap? Tab activates nothing.
 *   2. Enter (and Space, for buttons) only on controls whose click the explorer proved
 *      safe in this scan; every other control is skipped with its reason.
 *   3. Elements that look clickable (pointer cursor, a click listener) but that Tab
 *      never reaches. The listener is read from the browser; nothing is clicked.
 * Dialogs are never opened. Each step watches for side effects; a finding from a step
 * during which something else happened is INCONCLUSIVE (see probe-common.ts).
 */
import {
  detectTrap,
  type ExploreControl,
  type FocusStep,
  type SideEffectReport,
} from '@whc/dom-checks';
import type { Page } from 'playwright';
import { functionalDraft, type IssueContext, type IssueDraft } from '../issues';
import type { Logger } from '../logger';
import { captureHighlightedIssue, type CapturedImage } from '../screenshots';
import {
  freshPage,
  inPage,
  markDisturbed,
  sideEffectBaseline,
  stepMarks,
  type Disturbance,
  type ProbeParams,
} from './probe-common';

const TAB_STEPS = 100;
const MAX_ACTIVATIONS = 30;
const MAX_RELOADS = 10;
const MAX_PER_CHECK = 10;
const CLICK_LISTENERS = new Set(['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']);

type KeyResult = 'works' | 'fails' | 'not-focusable' | 'inconclusive';

/** Stored on the page (ScanPage.exploration.keyboard) and shown in the Interactions report. */
export interface KeyboardSummary {
  steps: number;
  stoppedBy: 'end' | 'limit' | 'trap' | 'error';
  /** The names of the first focused elements, in order. */
  focusOrder: string[];
  activation: { name: string; keys: { key: string; result: KeyResult }[] }[];
  skipped: { name: string; reason: string }[];
  clickableNotFocusable: number;
}

export async function keyboardProbe(
  params: ProbeParams & {
    ctx: IssueContext;
    established: ExploreControl[];
    activationSkipped: { name: string; reason: string }[];
    cropBudget: { remaining: number };
    logger: Logger;
  },
): Promise<{ summary: KeyboardSummary; drafts: IssueDraft[]; crops: Map<string, CapturedImage> }> {
  const { page, ctx } = params;
  const drafts: IssueDraft[] = [];
  const crops = new Map<string, CapturedImage>();
  const summary: KeyboardSummary = {
    steps: 0,
    stoppedBy: 'end',
    focusOrder: [],
    activation: [],
    skipped: [...params.activationSkipped],
    clickableNotFocusable: 0,
  };
  const crop = async (draft: IssueDraft, box: FocusStep['box']) => {
    if (!box || box.width < 1 || box.height < 1 || params.cropBudget.remaining <= 0) return;
    try {
      crops.set(
        draft.id,
        await captureHighlightedIssue(page, box, `${draft.severity} · ${draft.title}`),
      );
      params.cropBudget.remaining -= 1;
    } catch (error) {
      params.logger.debug({ err: (error as Error).message }, 'keyboard screenshot failed');
    }
  };
  const control = (s: Pick<FocusStep, 'name' | 'role' | 'selector' | 'html'>) => ({
    name: s.name,
    role: s.role,
    selector: s.selector,
    html: s.html,
  });
  const label = (name: string, role: string) => (name ? `“${name}”` : `a ${role}`);

  // ------------------------------------------------------------------ Tab walk
  if (!(await freshPage(params))) {
    summary.stoppedBy = 'error';
    return { summary, drafts, crops };
  }
  await inPage(page, 'probes.snapshotFocusStyles');
  await sideEffectBaseline(page);
  const steps: FocusStep[] = [];
  const disturbed = new Map<number, Disturbance>();
  const reported = { hidden: new Set<number>(), notVisible: new Set<number>() };
  let lost = 0;
  const walked = () =>
    `Pressed Tab ${steps.length} time${steps.length === 1 ? '' : 's'} from the top of the page`;

  for (let i = 0; i < TAB_STEPS; i += 1) {
    params.checkpoint();
    const done = stepMarks(params);
    await page.evaluate(
      `(() => { const a = document.activeElement; window.__whcDomChecks.sideEffects.start(a && a !== document.body ? [a] : []); })()`,
    );
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const step = await inPage<FocusStep>(page, 'probes.focusStep');
    // No style change on focus: compare pixels too (inside the same watched step, since
    // it moves focus away and back).
    const checkPixels =
      step.id !== 0 &&
      step.styleChanged === false &&
      !step.hidden &&
      !reported.notVisible.has(step.id) &&
      reported.notVisible.size < MAX_PER_CHECK;
    const pixels = checkPixels ? await focusPixelsDiffer(page, step.id) : null;
    const effects = (await page.evaluate(
      'window.__whcDomChecks.sideEffects.stop([document.activeElement])',
    )) as SideEffectReport;
    const disturbance = await done(effects);
    const previous = steps.at(-1);
    steps.push(step);
    if (disturbance) disturbed.set(steps.length - 1, disturbance);
    summary.steps = steps.length;
    if (step.id !== 0 && summary.focusOrder.length < 40)
      summary.focusOrder.push(step.name || step.role);

    if (step.id === 0) {
      // Back on the page: the end of the page, unless controls still follow.
      if (previous && previous.id !== 0 && previous.moreAfter && lost < MAX_PER_CHECK) {
        lost += 1;
        drafts.push(
          markDisturbed(
            functionalDraft('FOCUS_LOST', ctx, {
              severity: 'MEDIUM',
              classification: 'POTENTIAL_DEFECT',
              description: `After ${label(previous.name, previous.role)}, pressing Tab moved focus to no element at all (the page itself), although more controls follow. Keyboard users lose their place.`,
              control: control(previous),
              box: previous.box,
              interaction: { steps: [walked()], lastFocused: previous.selector },
              target: `${previous.selector}|focus-lost`,
            }),
            disturbance,
          ),
        );
        continue; // the browser goes on from where focus was lost
      }
      break;
    }
    // Wrapped around (came back to the first stop from another element): every stop seen.
    if (steps.length > 1 && step.id === steps[0]!.id && previous && previous.id !== 0) break;

    if (step.hidden && !reported.hidden.has(step.id) && reported.hidden.size < MAX_PER_CHECK) {
      reported.hidden.add(step.id);
      const why = {
        'not-rendered': 'it has no size or is not displayed',
        'off-screen': 'it is outside the page area',
        clipped: 'a container that hides its overflow cuts it off',
        transparent: 'it is fully transparent',
      }[step.hidden];
      drafts.push(
        markDisturbed(
          functionalDraft('FOCUS_ON_HIDDEN', ctx, {
            severity: 'MEDIUM',
            classification: 'POTENTIAL_DEFECT',
            description: `Tab moves focus to ${label(step.name, step.role)}, which cannot be seen: ${why}. Keyboard users see no focus and may activate something invisible.`,
            control: control(step),
            box: null,
            interaction: { steps: [walked()], hidden: step.hidden },
            target: `${step.selector}|focus-hidden`,
          }),
          disturbance,
        ),
      );
    }

    if (checkPixels) {
      reported.notVisible.add(step.id);
      if (pixels === false) {
        const draft = markDisturbed(
          functionalDraft('FOCUS_NOT_VISIBLE', ctx, {
            severity: 'MEDIUM',
            classification: 'POTENTIAL_DEFECT',
            description: `When ${label(step.name, step.role)} has keyboard focus, nothing about it looks different: no outline, border, shadow, colour or underline change (compared with its unfocused look, and pixel by pixel).`,
            control: control(step),
            box: step.box,
            interaction: { steps: [walked()] },
            target: `${step.selector}|focus-visible`,
          }),
          disturbance,
        );
        drafts.push(draft);
        await crop(draft, step.box);
      }
    }

    const cycle = detectTrap(steps);
    if (cycle?.inModal) break; // an open modal dialog keeps focus inside: correct
    if (cycle) {
      const trap = cycle.cycle;
      summary.stoppedBy = 'trap';
      const members = steps.slice(-trap.length);
      const anyDisturbed = [...disturbed.keys()].find(
        (index) => index >= steps.length - trap.length * 3,
      );
      drafts.push(
        markDisturbed(
          functionalDraft('KEYBOARD_TRAP', ctx, {
            severity: 'HIGH',
            classification: 'POTENTIAL_DEFECT',
            description: `Tab keeps cycling through the same ${trap.length} elements (${members.map((m) => label(m.name, m.role)).join(' → ')}) although more controls follow in the page, and they are not in a modal dialog. Keyboard users cannot get past them.`,
            control: control(members[0]!),
            box: members[0]!.box,
            interaction: { steps: [walked()], cycle: members.map((m) => m.selector) },
            target: `${members[0]!.selector}|trap`,
          }),
          anyDisturbed !== undefined ? disturbed.get(anyDisturbed)! : null,
        ),
      );
      break;
    }
    if (i === TAB_STEPS - 1) summary.stoppedBy = 'limit';
  }

  // ------------------------------------------- Enter / Space on proven controls
  let reloads = 0;
  if (params.established.length > 0 && (await freshPage(params))) {
    for (const [index, proven] of params.established.entries()) {
      params.checkpoint();
      if (index >= MAX_ACTIVATIONS) {
        summary.skipped.push({ name: proven.name, reason: 'limit' });
        continue;
      }
      const buttonLike =
        proven.role === 'button' ||
        proven.kind === 'details' ||
        /^(button|summary)$/i.test(proven.role);
      const keys = buttonLike ? ['Enter', 'Space'] : ['Enter'];
      const results: { key: string; result: KeyResult; disturbance: Disturbance | null }[] = [];
      for (const key of keys) {
        const done = stepMarks(params);
        if (!(await inPage<boolean>(page, 'probes.focusControl', proven.selector))) {
          results.push({ key, result: 'not-focusable', disturbance: await done(null) });
          break;
        }
        await page.evaluate(
          `window.__whcDomChecks.sideEffects.start(document.querySelector(${JSON.stringify(proven.selector)}))`,
        );
        await inPage(page, 'explore.before', proven.selector);
        await page.keyboard.press(key === 'Space' ? ' ' : key);
        await page.waitForTimeout(300);
        const change = await inPage<{
          newLayers: unknown[];
          hiddenCount: number;
          expandedBefore: string | null;
          expandedAfter: string | null;
          selectedBefore: string | null;
          selectedAfter: string | null;
          controlledVisibleBefore: boolean | null;
          controlledVisibleAfter: boolean | null;
          detailsOpenBefore: boolean | null;
          detailsOpenAfter: boolean | null;
          urlChanged: boolean;
        } | null>(page, 'explore.after', proven.selector);
        const effects = (await page.evaluate(
          'window.__whcDomChecks.sideEffects.stop()',
        )) as SideEffectReport;
        const disturbance = await done(effects);
        const works =
          change !== null &&
          (change.newLayers.length > 0 ||
            change.hiddenCount > 0 ||
            change.expandedBefore !== change.expandedAfter ||
            change.selectedBefore !== change.selectedAfter ||
            (change.controlledVisibleBefore === false && change.controlledVisibleAfter === true) ||
            (change.detailsOpenBefore === false && change.detailsOpenAfter === true));
        results.push({
          key,
          result: works ? 'works' : disturbance ? 'inconclusive' : 'fails',
          disturbance,
        });
        // Put the page back before the next key or control.
        if (works || disturbance || change?.urlChanged) {
          if (reloads >= MAX_RELOADS || !(await freshPage(params))) break;
          reloads += 1;
        }
      }
      summary.activation.push({
        name: proven.name,
        keys: results.map(({ key, result }) => ({ key, result })),
      });

      const failed = results.filter((r) => r.result !== 'works');
      if (failed.length === 0) continue;
      const notFocusable = failed.some((r) => r.result === 'not-focusable');
      const failedKeys = failed.map((r) => (r.key === 'Space' ? 'Space' : 'Enter'));
      const name = label(proven.name, proven.role);
      drafts.push(
        markDisturbed(
          functionalDraft('KEY_ACTIVATION_FAILED', ctx, {
            severity: notFocusable ? 'HIGH' : 'MEDIUM',
            classification: 'POTENTIAL_DEFECT',
            description: notFocusable
              ? `${capitalize(name)} works with a mouse click, but it cannot receive keyboard focus, so keyboard users cannot use it at all.`
              : `${capitalize(name)} works with a mouse click (proven earlier in this scan), but pressing ${failedKeys.join(' and ')} on it does nothing.`,
            control: {
              name: proven.name,
              role: proven.role,
              selector: proven.selector,
              html: proven.html,
            },
            box: proven.box,
            interaction: {
              steps: [
                `Clicked ${name}: it opened (explorer)`,
                ...results.map(
                  (r) => `Focused ${name} and pressed ${r.key}: ${r.result.replace('-', ' ')}`,
                ),
              ],
              keys: results.map(({ key, result }) => ({ key, result })),
            },
            target: `${proven.selector}|keys`,
          }),
          failed.find((r) => r.disturbance)?.disturbance ?? null,
        ),
      );
      if (failed.every((r) => r.result === 'inconclusive'))
        drafts.at(-1)!.functional!.classification = 'INCONCLUSIVE';
    }
  }

  // ---------------------- clickable elements that Tab never reaches (read-only)
  const candidates = await inPage<
    { id: number; selector: string; name: string; html: string; box: FocusStep['box'] }[]
  >(page, 'probes.clickCandidates', 50).catch(() => []);
  if (candidates.length > 0) {
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const candidate of candidates) {
        if (summary.clickableNotFocusable >= MAX_PER_CHECK) break;
        const { result } = (await cdp.send('Runtime.evaluate', {
          expression: `window.__whcDomChecks.explore.element(${candidate.id})`,
        })) as { result: { objectId?: string } };
        if (!result.objectId) continue;
        const { listeners } = (await cdp.send('DOMDebugger.getEventListeners', {
          objectId: result.objectId,
        })) as { listeners: { type: string }[] };
        await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
        const types = [
          ...new Set(listeners.map((l) => l.type).filter((t) => CLICK_LISTENERS.has(t))),
        ];
        if (types.length === 0) continue;
        summary.clickableNotFocusable += 1;
        drafts.push(
          functionalDraft('CLICK_NOT_FOCUSABLE', ctx, {
            severity: 'LOW',
            classification: 'OBSERVATION',
            description: `${capitalize(label(candidate.name, 'element'))} looks clickable (pointer cursor) and reacts to ${types.join('/')}, but it cannot receive keyboard focus, so Tab never reaches it. (Its click handler was not run.)`,
            control: {
              name: candidate.name,
              role: 'generic',
              selector: candidate.selector,
              html: candidate.html,
            },
            box: candidate.box,
            interaction: {
              listeners: types,
              steps: ['Read the element’s event listeners (nothing was clicked)'],
            },
            target: `${candidate.selector}|click-not-focusable`,
          }),
        );
      }
    } catch (error) {
      params.logger.debug({ err: (error as Error).message }, 'listener check failed');
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  return { summary, drafts, crops };
}

/**
 * Pixel check for an element whose styles do not change on focus: does it look any
 * different focused and unfocused (e.g. an indicator drawn by a child)? Compares two
 * screenshots of its area; true = different, false = identical, null = unknown.
 */
async function focusPixelsDiffer(page: Page, id: number): Promise<boolean | null> {
  try {
    const area = (await page.evaluate(`(() => {
      const el = window.__whcDomChecks.explore.element(${id});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.left - 6), y = Math.max(0, r.top - 6);
      const w = Math.min(innerWidth, r.right + 6) - x, h = Math.min(innerHeight, r.bottom + 6) - y;
      return w >= 2 && h >= 2 ? { x, y, width: w, height: h } : null;
    })()`)) as { x: number; y: number; width: number; height: number } | null;
    if (!area) return null;
    const focused = await page.screenshot({ clip: area, caret: 'initial' });
    await page.evaluate(`window.__whcDomChecks.explore.element(${id})?.blur()`);
    const unfocused = await page.screenshot({ clip: area, caret: 'initial' });
    await page.evaluate(`window.__whcDomChecks.probes.refocus(${id})`);
    return !focused.equals(unfocused);
  } catch {
    return null;
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
