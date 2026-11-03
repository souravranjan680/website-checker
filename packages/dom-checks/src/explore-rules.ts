/**
 * The pure part of the safe explorer (Phase 9): which controls may be opened, the
 * geometry of opened layers, and the result types. No DOM access here, so Node.js
 * code (the scanner) and unit tests can import it; the in-page part is explore.ts.
 */
import type { Box } from './types';

export type ControlKind = 'menu' | 'disclosure' | 'tab' | 'details';

export type SkipReason =
  | 'destructive-or-state-changing'
  | 'form-submit'
  | 'navigation-link'
  | 'opens-dialog'
  | 'native-form-control'
  | 'unknown-action'
  | 'disabled'
  | 'not-visible'
  | 'already-open'
  | 'limit';

/** What eligibility needs to know about an element (all plain data: unit-testable). */
export interface ControlFacts {
  tag: string;
  role: string | null;
  type: string | null;
  name: string;
  href: string | null;
  ariaExpanded: string | null;
  ariaHaspopup: string | null;
  ariaControls: string | null;
  ariaSelected: string | null;
  /** The element aria-controls points to exists and is currently hidden. */
  controlsHiddenRegion: boolean;
  inForm: boolean;
  disabled: boolean;
  visible: boolean;
  /** <summary> of a <details>: whether the details element is open. */
  detailsOpen: boolean | null;
}

export type Eligibility =
  { eligible: true; kind: ControlKind; reason: string } | { eligible: false; reason: SkipReason };

/**
 * Words of actions that create, change, send or remove something. A control whose
 * name contains one is never clicked, whatever its semantics. Deliberately broad:
 * missing a menu is acceptable, changing data is not.
 */
export const STATE_CHANGING_WORDS =
  /\b(delete|remove|erase|destroy|purchase|buy|pay|checkout|check out|order|send|submit|sign|create|save|publish|post|confirm|approve|accept|decline|reject|void|cancel|unsubscribe|subscribe|log ?out|sign ?out|reset|clear|apply|add|upload|download|export|import|share|invite|transfer|archive|restore|duplicate|copy|move|rename|edit|update|install|uninstall|enable|disable|activate|deactivate|book|reserve|donate|register|join|follow|like|vote|report|print|start|run|launch|generate|sync|refresh|reload)\b/i;

/** Wording of controls that only reveal more content. */
const EXPAND_WORDS =
  /^(?:(?:show|see|view) (?:more|all|less|details|options)|more|menu|filters?|options|details|expand(?: all)?)$/i;

export function eligibility(facts: ControlFacts): Eligibility {
  const role = facts.role?.toLowerCase() ?? null;
  const popup = facts.ariaHaspopup?.toLowerCase() ?? null;
  if (facts.disabled) return { eligible: false, reason: 'disabled' };
  if (!facts.visible) return { eligible: false, reason: 'not-visible' };
  if (['input', 'select', 'textarea', 'option'].includes(facts.tag) && facts.type !== 'button') {
    return {
      eligible: false,
      reason: facts.type === 'submit' ? 'form-submit' : 'native-form-control',
    };
  }
  if (facts.tag === 'a') {
    const href = (facts.href ?? '').trim();
    const navigates = href !== '' && href !== '#' && !/^javascript:/i.test(href);
    // Following links is the crawler's job (GET only, same rules as every scan).
    if (navigates) return { eligible: false, reason: 'navigation-link' };
  }
  if (STATE_CHANGING_WORDS.test(facts.name))
    return { eligible: false, reason: 'destructive-or-state-changing' };
  if (facts.tag === 'button' && facts.inForm && (facts.type === null || facts.type === 'submit')) {
    return { eligible: false, reason: 'form-submit' };
  }
  if (facts.tag === 'input' && facts.type === 'submit')
    return { eligible: false, reason: 'form-submit' };
  if (facts.tag === 'summary' && facts.detailsOpen !== null) {
    return facts.detailsOpen
      ? { eligible: false, reason: 'already-open' }
      : { eligible: true, kind: 'details', reason: 'expandable section (<details>)' };
  }
  if (role === 'tab') {
    return facts.ariaSelected === 'true'
      ? { eligible: false, reason: 'already-open' }
      : { eligible: true, kind: 'tab', reason: 'tab (role="tab")' };
  }
  if (popup && popup !== 'false') {
    if (popup === 'dialog') return { eligible: false, reason: 'opens-dialog' };
    return facts.ariaExpanded === 'true'
      ? { eligible: false, reason: 'already-open' }
      : {
          eligible: true,
          kind: 'menu',
          reason: `opens a ${popup === 'true' ? 'menu' : popup} (aria-haspopup)`,
        };
  }
  if (facts.ariaExpanded === 'true') return { eligible: false, reason: 'already-open' };
  if (facts.ariaExpanded === 'false') {
    return { eligible: true, kind: 'disclosure', reason: 'expandable control (aria-expanded)' };
  }
  const buttonLike = facts.tag === 'button' || role === 'button' || facts.tag === 'a';
  if (buttonLike && facts.ariaControls && facts.controlsHiddenRegion) {
    return {
      eligible: true,
      kind: 'disclosure',
      reason: 'controls a hidden region (aria-controls)',
    };
  }
  if (buttonLike && EXPAND_WORDS.test(facts.name.trim())) {
    return { eligible: true, kind: 'disclosure', reason: 'expand wording' };
  }
  return { eligible: false, reason: 'unknown-action' };
}

export interface ExploreControl {
  kind: ControlKind;
  role: string;
  name: string;
  selector: string;
  html: string;
  box: Box;
  reason: string;
}

export interface SkippedControl {
  name: string;
  role: string;
  selector: string;
  reason: SkipReason;
}

export interface ControlInventory {
  controls: ExploreControl[];
  /** Skipped controls worth listing (not ordinary links or hidden elements), max 50. */
  skipped: SkippedControl[];
  /** How many elements were skipped, per reason. */
  skippedCounts: Partial<Record<SkipReason, number>>;
}

export interface Layer {
  id: number;
  selector: string;
  box: Box;
  /** position of the layer or its nearest positioned ancestor: fixed/absolute/static… */
  position: string;
  area: number;
}

export interface InteractionChange {
  /** Elements that became visible (topmost only), biggest first, max 5. */
  newLayers: Layer[];
  /** How many previously visible elements are now hidden. */
  hiddenCount: number;
  expandedBefore: string | null;
  expandedAfter: string | null;
  selectedBefore: string | null;
  selectedAfter: string | null;
  controlledVisibleBefore: boolean | null;
  controlledVisibleAfter: boolean | null;
  detailsOpenBefore: boolean | null;
  detailsOpenAfter: boolean | null;
  mutations: number;
  urlChanged: boolean;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const intersect = (a: Rect, b: Rect): Rect => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});
export const areaOf = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

/**
 * How much of `own` is cut off by clipping rectangles (viewport and containers that
 * hide their overflow). Pure geometry, exported for unit tests.
 */
export function clippedPixels(own: Rect, clips: Rect[]): number {
  let visible = own;
  for (const clip of clips) visible = intersect(visible, clip);
  return Math.round(areaOf(own) - areaOf(visible));
}

/**
 * The tallest band of rows without content, as a share of the layer height. `rows`
 * says, for each horizontal slice of the layer, whether any content touches it.
 * Pure, exported for unit tests.
 */
export function emptyBand(rows: boolean[], rowHeight: number): { height: number; share: number } {
  let longest = 0;
  let current = 0;
  for (const filled of rows) {
    current = filled ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  return { height: longest * rowHeight, share: rows.length ? longest / rows.length : 0 };
}

export interface LayerReport {
  /** Pixels of the layer that cannot be seen, and what cuts them off. */
  clipped: {
    pixels: number;
    share: number;
    by: 'window' | 'container';
    container: string | null;
  } | null;
  /** Items of the layer that another element covers. */
  occluded: { name: string; selector: string; coveredBy: string }[];
  /** A large empty area inside the layer. */
  blank: { height: number; share: number } | null;
}

export interface BrokenAnchor {
  name: string;
  href: string;
  selector: string;
  html: string;
  box: Box;
}

export interface NavMismatch {
  navSelector: string;
  marked: { name: string; href: string; selector: string };
  current: { name: string; href: string; selector: string };
}
