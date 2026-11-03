import {
  AXE_OPTIONS,
  axeSelector,
  type AxeOutput,
  type Box,
  type BrokenAnchor,
  type ControlInventory,
  type ExploreControl,
  type InteractionChange,
  type LayerReport,
  type NavMismatch,
  type SkippedControl,
} from '@whc/dom-checks';
import axe from 'axe-core';
import type { Page } from 'playwright';
import { STABILIZE_CSS } from '../audits/visual';
import type { PageNetworkLog } from '../checks/collectors';
import { runExtraChecksInPage } from '../checks/dom';
import { extraFindingDrafts } from '../extra-issues';
import { classifyConsoleMessage } from '../checks/console-classify';
import {
  axeToDrafts,
  fingerprint,
  functionalDraft,
  type IssueContext,
  type IssueDraft,
} from '../issues';
import type { Logger } from '../logger';
import { captureHighlightedIssue, type CapturedImage } from '../screenshots';
import { PAGE_GUARDS, type BlockedAction } from './safety';

/** Stored on the page (ScanPage.exploration) and shown in the Functional report. */
export interface ExplorationSummary {
  url: string;
  eligible: number;
  explored: number;
  /** What happened with each explored control. */
  controls: { name: string; kind: string; result: ControlResult }[];
  skipped: SkippedControl[];
  skippedCounts: Record<string, number>;
  /** Requests, navigations, pop-ups… the safety layer prevented on this page. */
  blocked: BlockedAction[];
  reloads: number;
  /** Set when exploration of this page stopped early, and why. */
  stoppedEarly: string | null;
}

type ControlResult =
  'opened' | 'no-visible-effect' | 'changed-without-new-content' | 'not-clickable' | 'disappeared';

export interface ExplorationResult {
  summary: ExplorationSummary;
  drafts: IssueDraft[];
  crops: Map<string, CapturedImage>;
  /**
   * For the keyboard probe (Milestone 2, Checkpoint 2): controls whose click was proven
   * safe in this scan (it opened something, with nothing blocked, no navigation and no
   * error), and the others with the reason they may not be activated by keyboard.
   */
  /** "rule|selector" of the page's accessibility violations (the form probe skips them). */
  knownViolations: Set<string>;
  activation: {
    established: ExploreControl[];
    skipped: {
      name: string;
      reason: 'activation-not-established' | 'side-effect-observed' | 'opens-dialog' | 'limit';
    }[];
  };
}

const SETTLE_MS = 300;
const MAX_RELOADS = 5;
const MAX_LAYER_AXE_RUNS = 10;
/** Milestone 2 layout checks on opened layers (same cap as the accessibility runs). */
const MAX_LAYER_LAYOUT_RUNS = 10;

/** Calls window.__whcDomChecks.explore.<fn>(...args) inside the page. */
function call<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    `window.__whcDomChecks.explore.${fn}(...${JSON.stringify(args)})`,
  ) as Promise<T>;
}

/**
 * Explores one page (Phase 9, Milestone 1). The caller has loaded it in the explorer's
 * own context with the safety layer installed (see safety.ts) and the collectors
 * attached. For each eligible control (menus, tabs, expandable sections; max `limit`):
 *   1. remember the page state, click it with a real mouse, wait briefly
 *   2. what changed? nothing → "does nothing"; a new layer → check it (cut off,
 *      items covered, large empty area) and run axe on it; a tab → its panel shown?
 *   3. JavaScript errors thrown meanwhile
 *   4. menus: close with Escape, else by clicking outside, else with the control
 *   5. put the page back (close again, or reload the same address if needed)
 * Static navigation facts (broken in-page anchors, wrong current item) are checked first.
 */
export async function explorePage(params: {
  page: Page;
  url: string;
  ctx: IssueContext;
  siteHostname: string;
  domBundle: string;
  log: PageNetworkLog;
  blocked: BlockedAction[];
  allowNavigation: (url: string) => void;
  collectPageBlocks: (page: Page) => Promise<void>;
  controlLimit: number;
  cropBudget: { remaining: number };
  checkpoint: () => void;
  logger: Logger;
}): Promise<ExplorationResult> {
  const { page, ctx } = params;
  const drafts: IssueDraft[] = [];
  const crops = new Map<string, CapturedImage>();
  const blockedAtStart = params.blocked.length;
  const summary: ExplorationSummary = {
    url: params.url,
    eligible: 0,
    explored: 0,
    controls: [],
    skipped: [],
    skippedCounts: {},
    blocked: [],
    reloads: 0,
    stoppedEarly: null,
  };

  const prepare = async () => {
    await page.addStyleTag({ content: STABILIZE_CSS });
    await page.evaluate(params.domBundle);
    await page.evaluate(axe.source);
    await page.evaluate(PAGE_GUARDS);
  };
  const settle = () => page.waitForTimeout(SETTLE_MS);
  const crop = async (draft: IssueDraft, box: Box | null | undefined) => {
    if (!box || box.width < 1 || box.height < 1 || params.cropBudget.remaining <= 0) return;
    try {
      crops.set(
        draft.id,
        await captureHighlightedIssue(page, box, `${draft.severity} · ${draft.title}`),
      );
      params.cropBudget.remaining -= 1;
    } catch (error) {
      params.logger.debug({ err: (error as Error).message }, 'interaction screenshot failed');
    }
  };
  const reload = async (): Promise<boolean> => {
    if (summary.reloads >= MAX_RELOADS) return false;
    summary.reloads += 1;
    params.allowNavigation(params.url);
    try {
      await page.goto(params.url, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      await prepare();
      return true;
    } catch {
      return false;
    }
  };

  await prepare();

  // Accessibility problems already present on the page are not repeated per opened layer.
  const pageAxe = (await page.evaluate(
    `axe.run(document, ${JSON.stringify(AXE_OPTIONS)}).then((r) => ({ violations: r.violations, incomplete: [], axeVersion: r.testEngine.version }))`,
  )) as AxeOutput;
  const knownViolations = new Set(
    pageAxe.violations.flatMap((rule) =>
      rule.nodes.map((node) => `${rule.id}|${axeSelector(node.target)}`),
    ),
  );
  // Likewise for the Milestone 2 layout problems already on the page.
  const knownLayout = new Set(
    (
      await runExtraChecksInPage(page, { layout: true }).catch(() => ({ findings: [] }))
    ).findings.map((f) => `${f.check}|${f.selector}`),
  );
  let layerLayoutRuns = 0;

  // ---------------------------------------------------------- navigation facts
  const nav = await call<{ brokenAnchors: BrokenAnchor[]; navMismatches: NavMismatch[] }>(
    page,
    'navigationFacts',
  );
  for (const anchor of nav.brokenAnchors) {
    drafts.push(
      functionalDraft('BROKEN_ANCHOR', ctx, {
        severity: 'LOW',
        classification: 'DETECTED',
        description: `The link “${anchor.name || anchor.href}” points to ${anchor.href}, but this page has no element with that id, so it goes nowhere.`,
        control: { name: anchor.name, role: 'link', selector: anchor.selector, html: anchor.html },
        box: anchor.box,
        interaction: { href: anchor.href },
        target: anchor.href,
      }),
    );
  }
  for (const mismatch of nav.navMismatches) {
    drafts.push(
      functionalDraft('NAV_CURRENT_MISMATCH', ctx, {
        severity: 'MEDIUM',
        classification: 'POTENTIAL_DEFECT',
        description: `On this page, the navigation marks “${mismatch.marked.name}” (${mismatch.marked.href}) as current, but the item for this page is “${mismatch.current.name}” (${mismatch.current.href}).`,
        control: {
          name: mismatch.marked.name,
          role: 'link',
          selector: mismatch.marked.selector,
        },
        interaction: {
          marked: mismatch.marked,
          expected: mismatch.current,
          nav: mismatch.navSelector,
        },
        target: `${mismatch.navSelector}|${mismatch.marked.href}`,
      }),
    );
  }

  // ------------------------------------------------------------------ controls
  const inventory = await call<ControlInventory>(page, 'findControls', params.controlLimit);
  summary.eligible = inventory.controls.length;
  summary.skipped = inventory.skipped;
  summary.skippedCounts = inventory.skippedCounts as Record<string, number>;
  let layerAxeRuns = 0;

  const activation: ExplorationResult['activation'] = { established: [], skipped: [] };
  for (const skipped of inventory.skipped) {
    if (skipped.reason === 'opens-dialog' || skipped.reason === 'limit') {
      activation.skipped.push({ name: skipped.name, reason: skipped.reason });
    }
  }
  for (const control of inventory.controls) {
    params.checkpoint();
    const blockedBeforeControl = params.blocked.length;
    const errorsBeforeControl = params.log.pageErrors.length;
    const outcome = await exploreControl(control);
    summary.controls.push({ name: control.name, kind: control.kind, result: outcome });
    if (
      params.blocked.length > blockedBeforeControl ||
      params.log.pageErrors.length > errorsBeforeControl
    ) {
      activation.skipped.push({ name: control.name, reason: 'side-effect-observed' });
    } else if (outcome === 'opened') {
      activation.established.push(control);
    } else {
      activation.skipped.push({ name: control.name, reason: 'activation-not-established' });
    }
    if (outcome !== 'not-clickable' && outcome !== 'disappeared') summary.explored += 1;
    if (summary.stoppedEarly) break;
  }

  await params.collectPageBlocks(page);
  summary.blocked = params.blocked.slice(blockedAtStart).slice(0, 50);
  return { summary, drafts, crops, activation, knownViolations };

  // ------------------------------------------------------------ one control
  async function exploreControl(control: ExploreControl): Promise<ControlResult> {
    const controlInfo = {
      name: control.name,
      role: control.role,
      selector: control.selector,
      html: control.html,
    };
    const label = control.name ? `“${control.name}”` : `the ${control.role}`;
    const errorsBefore = params.log.pageErrors.length;
    const blockedBefore = params.blocked.length;
    const draftsBefore = drafts.length;

    const attempt = async (): Promise<InteractionChange | 'not-clickable' | 'disappeared'> => {
      if (!(await call<boolean>(page, 'before', control.selector))) return 'disappeared';
      try {
        await page.locator(control.selector).first().click({ timeout: 2_000 });
      } catch {
        return 'not-clickable';
      }
      await settle();
      return (
        (await call<InteractionChange | null>(page, 'after', control.selector)) ?? 'disappeared'
      );
    };

    let change = await attempt();
    if (typeof change === 'string') return change;
    const visibleChange = (c: InteractionChange) =>
      c.newLayers.length > 0 ||
      (c.controlledVisibleBefore === false && c.controlledVisibleAfter === true) ||
      (c.detailsOpenBefore === false && c.detailsOpenAfter === true) ||
      c.hiddenCount > 0;
    const stateChange = (c: InteractionChange) =>
      c.expandedBefore !== c.expandedAfter || c.selectedBefore !== c.selectedAfter;

    let attempts = 1;
    if (
      !visibleChange(change) &&
      !change.urlChanged &&
      !stateChange(change) &&
      change.mutations === 0
    ) {
      // Nothing at all happened: try once more before reporting (focus, slow scripts).
      // (If the control changed its own state, e.g. aria-expanded="true", a second click
      // would only undo that: the first result is the evidence.)
      attempts = 2;
      const second = await attempt();
      if (typeof second === 'string') return second;
      change = second;
    }
    let result: ControlResult = 'opened';
    const interaction = {
      control: control.name,
      kind: control.kind,
      whyExplored: control.reason,
      attempts,
      steps: [`Clicked ${label}`],
    };
    // Each finding keeps the steps taken up to that moment (later steps are not its evidence).
    const stepsSoFar = () => ({ ...interaction, steps: [...interaction.steps] });

    // JavaScript errors thrown while interacting.
    for (const error of params.log.pageErrors.slice(errorsBefore, errorsBefore + 3)) {
      const kind = classifyConsoleMessage(
        {
          level: 'exception',
          text: error.message,
          source: error.source,
          line: error.line,
          column: error.column,
        },
        params.siteHostname,
        params.log.failedRequests,
      ).kind;
      const outside = kind === 'THIRD_PARTY' || kind === 'NETWORK';
      drafts.push(
        functionalDraft('INTERACTION_ERROR', ctx, {
          severity: outside ? 'LOW' : 'MEDIUM',
          classification: outside ? 'OBSERVATION' : 'POTENTIAL_DEFECT',
          description: `Using ${label} threw an error: ${error.message}${error.source ? ` (${error.source}${error.line ? `:${error.line}` : ''})` : ''}`,
          control: controlInfo,
          box: control.box,
          interaction: {
            ...stepsSoFar(),
            error: error.message,
            source: error.source ?? null,
            kind,
          },
          target: `${control.selector}|${error.message.slice(0, 120)}`,
        }),
      );
    }

    if (!visibleChange(change) && !change.urlChanged) {
      if (change.expandedAfter === 'true' || (change.mutations === 0 && !stateChange(change))) {
        const said = change.expandedAfter === 'true' && change.expandedBefore !== 'true';
        const draft = functionalDraft('CONTROL_NO_EFFECT', ctx, {
          severity: 'MEDIUM',
          classification: 'POTENTIAL_DEFECT',
          description: said
            ? `${capitalize(label)} reports that it opened (aria-expanded="true"), but nothing new became visible (tried ${attempts === 1 ? 'once' : `${attempts} times`}).`
            : `Clicking ${label} changed nothing on the page (tried ${attempts === 1 ? 'once' : `${attempts} times`}). It looks like a ${control.kind === 'tab' ? 'tab' : 'control that opens something'}, so users expect a result.`,
          control: controlInfo,
          box: control.box,
          interaction: { ...stepsSoFar(), change: summarizeChange(change) },
          target: control.selector,
        });
        drafts.push(draft);
        await crop(draft, control.box);
        result = 'no-visible-effect';
      } else {
        // The page changed, but nothing new became visible: not enough evidence.
        result = 'changed-without-new-content';
      }
    }

    if (control.kind === 'tab' && change.selectedAfter === 'true') {
      const panel = await call<{ found: boolean; visible: boolean; selector: string | null }>(
        page,
        'tabPanel',
        control.selector,
      );
      if (panel.found && !panel.visible) {
        drafts.push(
          functionalDraft('TAB_PANEL_NOT_SHOWN', ctx, {
            severity: 'MEDIUM',
            classification: 'POTENTIAL_DEFECT',
            description: `The tab ${label} became selected, but its panel (${panel.selector}) stays hidden.`,
            control: controlInfo,
            box: control.box,
            interaction: { ...stepsSoFar(), panel: panel.selector },
            target: control.selector,
          }),
        );
      }
    }

    // Check each opened layer (biggest first).
    const layers = change.newLayers.filter((l) => l.area >= 400).slice(0, 3);
    for (const layer of layers) {
      const report = await call<LayerReport | null>(page, 'checkLayer', layer.id);
      if (!report) continue;
      const where = `the ${control.kind === 'menu' ? 'menu' : 'content'} opened by ${label}`;
      if (report.clipped) {
        const draft = functionalDraft('LAYER_CLIPPED', ctx, {
          severity: 'HIGH',
          classification: 'POTENTIAL_DEFECT',
          description: `About ${Math.round(report.clipped.share * 100)}% of ${where} cannot be seen: it is cut off by ${report.clipped.by === 'window' ? 'the edge of the window' : `a container that hides overflow (${report.clipped.container})`}.`,
          control: controlInfo,
          box: layer.box,
          interaction: { ...stepsSoFar(), layer: layer.selector, clipped: report.clipped },
          target: `${control.selector}|clipped`,
        });
        drafts.push(draft);
        await crop(draft, layer.box);
      }
      if (report.occluded.length > 0) {
        const names = report.occluded.slice(0, 5).map((o) => `“${o.name || o.selector}”`);
        const draft = functionalDraft('LAYER_OCCLUDED', ctx, {
          severity: 'HIGH',
          classification: 'POTENTIAL_DEFECT',
          description: `In ${where}, ${report.occluded.length} item(s) are covered by other content and cannot be clicked: ${names.join(', ')} (covered by ${report.occluded[0]!.coveredBy}).`,
          control: controlInfo,
          box: layer.box,
          interaction: {
            ...interaction,
            layer: layer.selector,
            occluded: report.occluded.slice(0, 10),
          },
          target: `${control.selector}|occluded`,
        });
        drafts.push(draft);
        await crop(draft, layer.box);
      }
      if (report.blank) {
        const draft = functionalDraft('LAYER_BLANK_AREA', ctx, {
          severity: 'LOW',
          classification: 'OBSERVATION',
          description: `${capitalize(where)} has an empty area about ${report.blank.height} px tall (${Math.round(report.blank.share * 100)}% of its height) with no content.`,
          control: controlInfo,
          box: layer.box,
          interaction: { ...stepsSoFar(), layer: layer.selector, blank: report.blank },
          target: `${control.selector}|blank`,
        });
        drafts.push(draft);
        await crop(draft, layer.box);
      }
      // Accessibility of the opened content (only problems not already on the page).
      if (layerAxeRuns < MAX_LAYER_AXE_RUNS) {
        layerAxeRuns += 1;
        const layerAxe = (await page.evaluate(
          `axe.run(window.__whcDomChecks.explore.element(${layer.id}), ${JSON.stringify(AXE_OPTIONS)}).then((r) => ({ violations: r.violations, incomplete: [], axeVersion: r.testEngine.version }))`,
        )) as AxeOutput;
        layerAxe.violations = layerAxe.violations
          .map((rule) => ({
            ...rule,
            nodes: rule.nodes.filter(
              (node) => !knownViolations.has(`${rule.id}|${axeSelector(node.target)}`),
            ),
          }))
          .filter((rule) => rule.nodes.length > 0);
        for (const draft of axeToDrafts(layerAxe, ctx, new Map())) {
          draft.description = `${draft.description} Found after opening ${label}.`;
          draft.details = {
            ...(draft.details ?? {}),
            interactionState: { opened: control.name, controlSelector: control.selector },
          };
          draft.fingerprint = fingerprint({
            ...ctx,
            category: 'ACCESSIBILITY',
            ruleId: draft.ruleId,
            target: `${draft.selector ?? draft.htmlSnippet ?? ''}|opened:${control.selector}`,
          });
          knownViolations.add(`${draft.ruleId}|${draft.selector}`);
          drafts.push(draft);
        }
      }
    }

    // Layout of the opened content (Milestone 2; only problems not already on the page).
    // Cut-off layers are LAYER_CLIPPED above, so FIXED_OUT_OF_VIEWPORT is not repeated.
    for (const layer of layers) {
      if (layerLayoutRuns >= MAX_LAYER_LAYOUT_RUNS) break;
      layerLayoutRuns += 1;
      const layout = await runExtraChecksInPage(
        page,
        { layout: true },
        `window.__whcDomChecks.explore.element(${layer.id})`,
      ).catch(() => null);
      const fresh = (layout?.findings ?? []).filter(
        (f) => f.check !== 'FIXED_OUT_OF_VIEWPORT' && !knownLayout.has(`${f.check}|${f.selector}`),
      );
      for (const draft of extraFindingDrafts(fresh, ctx, 'UI_HEALTH')) {
        draft.description = `${draft.description} Found after opening ${label}.`;
        draft.details = {
          ...(draft.details ?? {}),
          interactionState: { opened: control.name, controlSelector: control.selector },
        };
        draft.fingerprint = fingerprint({
          ...ctx,
          category: 'UI_HEALTH',
          ruleId: draft.ruleId,
          target: `${draft.selector ?? ''}|opened:${control.selector}`,
        });
        knownLayout.add(`${draft.uiHealth?.checkType}|${draft.selector}`);
        drafts.push(draft);
      }
    }

    // Menus must close again: Escape, a click outside, or the control itself.
    const opened = layers.map((l) => l.id);
    if (control.kind === 'menu' && opened.length > 0) {
      const isOpen = async () => {
        const shown = await Promise.all(opened.map((id) => call<boolean>(page, 'isShown', id)));
        return shown.some(Boolean);
      };
      await page.keyboard.press('Escape');
      await settle();
      interaction.steps.push('Pressed Escape');
      const closedByEscape = !(await isOpen());
      let closed = closedByEscape;
      if (!closed) {
        const point = await call<{ x: number; y: number } | null>(page, 'safePoint', opened);
        if (point) {
          await page.mouse.click(point.x, point.y);
          await settle();
          interaction.steps.push('Clicked outside the menu');
          closed = !(await isOpen());
        }
      }
      if (!closed) {
        await page
          .locator(control.selector)
          .first()
          .click({ timeout: 2_000 })
          .catch(() => {});
        await settle();
        interaction.steps.push(`Clicked ${label} again`);
        closed = !(await isOpen());
      }
      if (!closed) {
        drafts.push(
          functionalDraft('LAYER_NOT_DISMISSIBLE', ctx, {
            severity: 'MEDIUM',
            classification: 'POTENTIAL_DEFECT',
            description: `The menu opened by ${label} stays open: Escape, clicking outside it and using the control again did not close it.`,
            control: controlInfo,
            box: control.box,
            interaction: { ...stepsSoFar() },
            target: `${control.selector}|dismiss`,
          }),
        );
      } else if (!closedByEscape) {
        drafts.push(
          functionalDraft('ESCAPE_NOT_SUPPORTED', ctx, {
            severity: 'LOW',
            classification: 'OBSERVATION',
            description: `The menu opened by ${label} does not close with Escape (it closes ${interaction.steps.includes('Clicked outside the menu') ? 'by clicking outside it' : 'with the control'}). Keyboard users expect Escape to close menus.`,
            control: controlInfo,
            box: control.box,
            interaction: { ...stepsSoFar() },
            target: `${control.selector}|escape`,
          }),
        );
      }
    } else if ((control.kind === 'disclosure' || control.kind === 'details') && opened.length > 0) {
      await page
        .locator(control.selector)
        .first()
        .click({ timeout: 2_000 })
        .catch(() => {});
      await settle();
    }

    await params.collectPageBlocks(page); // actions the in-page guards stopped
    // Requests the safety layer blocked during this interaction may change what users
    // would see (e.g. a menu that loads its items): such findings are not claimed.
    const blockedHere = params.blocked.slice(blockedBefore);
    if (blockedHere.length > 0) {
      for (const draft of drafts.slice(draftsBefore)) {
        if (!draft.functional || draft.functional.classification === 'INCONCLUSIVE') continue;
        draft.functional.classification = 'INCONCLUSIVE';
        draft.description = `${draft.description} Note: ${blockedHere.length} request(s) or action(s) of the page were blocked for safety during this interaction, so the result may differ for real users.`;
        draft.details = {
          ...(draft.details ?? {}),
          blockedDuringInteraction: blockedHere.slice(0, 10),
        };
        draft.functional.interaction = draft.details;
      }
    }

    // Put the page back if it changed address (a blocked navigation) or still shows layers.
    const stillOpen =
      control.kind === 'menu' &&
      (
        await Promise.all(opened.map((id) => call<boolean>(page, 'isShown', id).catch(() => false)))
      ).some(Boolean);
    if (page.url() !== params.url || stillOpen || params.blocked.length > blockedBefore) {
      if (!(await reload()))
        summary.stoppedEarly = 'The page could not be restored after an interaction.';
    }
    return result;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function summarizeChange(change: InteractionChange) {
  return {
    newLayers: change.newLayers.length,
    hidden: change.hiddenCount,
    expanded: [change.expandedBefore, change.expandedAfter],
    selected: [change.selectedBefore, change.selectedAfter],
    domChanges: change.mutations,
  };
}
