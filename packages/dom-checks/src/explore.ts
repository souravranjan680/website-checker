/**
 * In-page part of the safe explorer (Phase 9, Milestone 1). The scanner opens
 * menus, tabs and expandable sections one at a time and asks this code:
 *   - which controls may be opened (eligibility: generic ARIA/HTML semantics plus a
 *     small "expand" vocabulary; anything that could change data is skipped),
 *   - what one interaction changed (new visible layers, aria-expanded/selected,
 *     DOM changes),
 *   - whether an opened layer is cut off, hidden behind other content, or mostly empty,
 *   - static navigation facts (broken in-page anchors, wrong "current" item).
 * Nothing here clicks: the scanner clicks with a real mouse, after these checks.
 * Generic by design: no site, page or text-specific rules.
 */
import { isVisible, pageBox, selectorFor, snippet } from './dom-utils';
import {
  areaOf,
  clippedPixels,
  intersect,
  eligibility,
  emptyBand,
  type BrokenAnchor,
  type ControlFacts,
  type ControlInventory,
  type InteractionChange,
  type Layer,
  type LayerReport,
  type NavMismatch,
  type Rect,
  type SkipReason,
} from './explore-rules';
import type { Box } from './types';

export { eligibility } from './explore-rules';

// ------------------------------------------------------------------ eligibility

// ------------------------------------------------------------------ page state

/** Elements the explorer has seen, by number (stable while the page lives). */
const registry = {
  ids: new WeakMap<Element, number>(),
  elements: new Map<number, Element>(),
  next: 1,
};
function idOf(el: Element): number {
  let id = registry.ids.get(el);
  if (!id) {
    id = registry.next++;
    registry.ids.set(el, id);
    registry.elements.set(id, el);
  }
  return id;
}

export function element(id: number): Element | null {
  return registry.elements.get(id) ?? null;
}

/** The registry id of an element (registering it if needed); used by the probes. */
export function register(el: Element): number {
  return idOf(el);
}

/** A rough accessible name: label attributes, then text, then images' alt text. */
export function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  const fromIds = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    : '';
  // Form fields are named by their <label>, as screen readers do (not by their value).
  const labels =
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
      ? Array.from(el.labels ?? [])
          .map((label) => label.textContent ?? '')
          .join(' ')
      : '';
  const candidates = [
    el.getAttribute('aria-label') ?? '',
    fromIds,
    labels,
    (el as HTMLElement).innerText ?? el.textContent ?? '',
    el.getAttribute('title') ?? '',
    el.querySelector('img[alt]')?.getAttribute('alt') ?? '',
    el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)
      ? el.value
      : '',
  ];
  const name = candidates.map((c) => c.replace(/\s+/g, ' ').trim()).find((c) => c.length > 0);
  return (name ?? '').slice(0, 80);
}

const CANDIDATES =
  'button, [role="button"], [role="tab"], summary, a[href], [aria-expanded], [aria-haspopup], input[type="submit"], input[type="button"]';

function factsOf(el: Element): ControlFacts {
  const controls = el.getAttribute('aria-controls');
  const controlled = controls ? document.getElementById(controls.split(/\s+/)[0]!) : null;
  const details = el.tagName === 'SUMMARY' ? el.parentElement : null;
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    type: el.getAttribute('type')?.toLowerCase() ?? null,
    name: accessibleName(el),
    href: el.getAttribute('href'),
    ariaExpanded: el.getAttribute('aria-expanded'),
    ariaHaspopup: el.getAttribute('aria-haspopup'),
    ariaControls: controls,
    ariaSelected: el.getAttribute('aria-selected'),
    controlsHiddenRegion: controlled !== null && !isVisible(controlled),
    inForm: el.closest('form') !== null,
    disabled:
      (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
    visible: isVisible(el),
    detailsOpen:
      details instanceof HTMLDetailsElement && details.firstElementChild === el
        ? details.open
        : null,
  };
}

const LISTED_SKIPS = new Set<SkipReason>([
  'destructive-or-state-changing',
  'form-submit',
  'opens-dialog',
  'unknown-action',
  'disabled',
  'limit',
]);

/** Eligible controls in page order (up to `limit`) and what was skipped and why. */
export function findControls(limit: number): ControlInventory {
  const result: ControlInventory = { controls: [], skipped: [], skippedCounts: {} };
  const seen = new Set<Element>();
  const skip = (el: Element, facts: ControlFacts, reason: SkipReason) => {
    result.skippedCounts[reason] = (result.skippedCounts[reason] ?? 0) + 1;
    if (LISTED_SKIPS.has(reason) && result.skipped.length < 50) {
      result.skipped.push({
        name: facts.name,
        role: facts.role ?? facts.tag,
        selector: selectorFor(el),
        reason,
      });
    }
  };
  for (const el of Array.from(document.querySelectorAll(CANDIDATES))) {
    if (seen.has(el)) continue;
    seen.add(el);
    const facts = factsOf(el);
    const decision = eligibility(facts);
    if (!decision.eligible) {
      // Plain links are counted, not listed: following links is the crawler's job.
      skip(el, facts, decision.reason);
      continue;
    }
    if (result.controls.length >= limit) {
      skip(el, facts, 'limit');
      continue;
    }
    result.controls.push({
      kind: decision.kind,
      role: facts.role ?? facts.tag,
      name: facts.name,
      selector: selectorFor(el),
      html: snippet(el),
      box: pageBox(el),
      reason: decision.reason,
    });
  }
  return result;
}

// ------------------------------------------------------------- one interaction

interface Mark {
  selector: string;
  visible: Set<number>;
  expanded: string | null;
  selected: string | null;
  controlledVisible: boolean | null;
  detailsOpen: boolean | null;
  url: string;
  observer: MutationObserver;
  mutations: number;
}
let mark: Mark | null = null;

function visibleIds(): Set<number> {
  const ids = new Set<number>();
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    if (isVisible(el)) ids.add(idOf(el));
  }
  return ids;
}

function controlledOf(el: Element): Element | null {
  const controls = el.getAttribute('aria-controls');
  return controls ? document.getElementById(controls.split(/\s+/)[0]!) : null;
}

function detailsOf(el: Element): HTMLDetailsElement | null {
  const parent = el.parentElement;
  return el.tagName === 'SUMMARY' && parent instanceof HTMLDetailsElement ? parent : null;
}

/** Remembers the page state before the scanner clicks `selector`. */
export function before(selector: string): boolean {
  const el = document.querySelector(selector);
  if (!el) return false;
  mark?.observer.disconnect();
  const controlled = controlledOf(el);
  // Only real changes count: scripts often re-set an attribute to the value it already has.
  const observer = new MutationObserver((records) => {
    if (!mark) return;
    for (const record of records) {
      if (record.type === 'childList') {
        if (record.addedNodes.length > 0 || record.removedNodes.length > 0) mark.mutations += 1;
      } else if (record.type === 'attributes') {
        const now = (record.target as Element).getAttribute(record.attributeName ?? '');
        if (now !== record.oldValue) mark.mutations += 1;
      } else if (record.target.textContent !== record.oldValue) {
        mark.mutations += 1;
      }
    }
  });
  mark = {
    selector,
    visible: visibleIds(),
    expanded: el.getAttribute('aria-expanded'),
    selected: el.getAttribute('aria-selected'),
    controlledVisible: controlled ? isVisible(controlled) : null,
    detailsOpen: detailsOf(el)?.open ?? null,
    url: location.href,
    observer,
    mutations: 0,
  };
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
  });
  return true;
}

function positionOf(el: Element): string {
  for (let current: Element | null = el; current; current = current.parentElement) {
    const position = getComputedStyle(current).position;
    if (position !== 'static') return position;
  }
  return 'static';
}

/** What changed since before(), for the control `selector`. */
export function after(selector: string): InteractionChange | null {
  if (!mark || mark.selector !== selector) return null;
  const el = document.querySelector(selector);
  const now = visibleIds();
  const fresh = new Set<number>([...now].filter((id) => !mark!.visible.has(id)));
  const layers: Layer[] = [];
  for (const id of fresh) {
    const node = registry.elements.get(id);
    if (!node) continue;
    const parent = node.parentElement;
    if (parent && fresh.has(idOf(parent))) continue; // only the topmost new element
    const rect = node.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 64) continue;
    layers.push({
      id,
      selector: selectorFor(node),
      box: pageBox(node),
      position: positionOf(node),
      area,
    });
  }
  layers.sort((a, b) => b.area - a.area);
  const controlled = el ? controlledOf(el) : null;
  const change: InteractionChange = {
    newLayers: layers.slice(0, 5),
    hiddenCount: [...mark.visible].filter((id) => !now.has(id)).length,
    expandedBefore: mark.expanded,
    expandedAfter: el?.getAttribute('aria-expanded') ?? null,
    selectedBefore: mark.selected,
    selectedAfter: el?.getAttribute('aria-selected') ?? null,
    controlledVisibleBefore: mark.controlledVisible,
    controlledVisibleAfter: controlled ? isVisible(controlled) : null,
    detailsOpenBefore: mark.detailsOpen,
    detailsOpenAfter: el ? (detailsOf(el)?.open ?? null) : null,
    mutations: mark.mutations,
    urlChanged: location.href !== mark.url,
  };
  mark.observer.disconnect();
  return change;
}

/** Is this layer (or control-controlled region) still shown? */
export function isShown(id: number): boolean {
  const el = registry.elements.get(id);
  return el !== undefined && el.isConnected && isVisible(el);
}

/** The panel of a tab (aria-controls), and whether it is shown. */
export function tabPanel(selector: string): {
  found: boolean;
  visible: boolean;
  selector: string | null;
} {
  const tab = document.querySelector(selector);
  const panel = tab ? controlledOf(tab) : null;
  return {
    found: panel !== null,
    visible: panel !== null && isVisible(panel),
    selector: panel ? selectorFor(panel) : null,
  };
}

// ---------------------------------------------------------------- layer checks

const INTERACTIVE_ITEMS =
  'a[href], button, input, select, textarea, label, [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="link"], [role="button"]';

function isContent(el: Element): boolean {
  if (el.matches('img, svg, video, canvas, input, select, textarea, button, iframe')) return true;
  return Array.from(el.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0,
  );
}

/** Checks one opened layer: cut off, items covered, large empty area. */
export function checkLayer(id: number): LayerReport | null {
  const layer = registry.elements.get(id);
  if (!layer || !isVisible(layer)) return null;
  const rect = layer.getBoundingClientRect();
  const own: Rect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  const report: LayerReport = { clipped: null, occluded: [], blank: null };

  // 1) Cut off. The window cuts horizontally; vertically only for fixed layers (other
  //    content can be scrolled to). Containers that hide overflow cut in any direction,
  //    unless they scroll (the user can scroll to the rest).
  const fixed = positionOf(layer) === 'fixed';
  const windowClip: Rect = {
    left: 0,
    top: fixed ? 0 : -Infinity,
    right: document.documentElement.clientWidth,
    bottom: fixed ? window.innerHeight : Infinity,
  };
  const windowLoss = clippedPixels(own, [windowClip]);
  let containerLoss = 0;
  let container: Element | null = null;
  // Where the layer can actually be seen (window and every hiding container).
  let visibleArea: Rect = intersect(own, windowClip);
  for (
    let parent = layer.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const hides = [style.overflowX, style.overflowY].some((o) => o === 'hidden' || o === 'clip');
    const scrolls = [style.overflowX, style.overflowY].some((o) => o === 'auto' || o === 'scroll');
    if (!hides || scrolls) continue;
    const r = parent.getBoundingClientRect();
    const clip: Rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    visibleArea = intersect(visibleArea, clip);
    const loss = clippedPixels(own, [clip]);
    if (loss > containerLoss) {
      containerLoss = loss;
      container = parent;
    }
  }
  const total = areaOf(own);
  const loss = Math.max(windowLoss, containerLoss);
  if (total > 0 && loss >= 64 && loss / total >= 0.05) {
    report.clipped = {
      pixels: loss,
      share: Math.round((loss / total) * 100) / 100,
      by: containerLoss >= windowLoss ? 'container' : 'window',
      container: containerLoss >= windowLoss && container ? selectorFor(container) : null,
    };
  }

  // 2) Items covered by something outside the layer (checked at their centre).
  const items = Array.from(layer.querySelectorAll(INTERACTIVE_ITEMS))
    .filter((el) => isVisible(el))
    .slice(0, 30);
  for (const item of items) {
    const r = item.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= document.documentElement.clientWidth || y >= window.innerHeight)
      continue;
    // A clipped part is reported as "cut off" above, not again as "covered".
    if (
      x < visibleArea.left ||
      x > visibleArea.right ||
      y < visibleArea.top ||
      y > visibleArea.bottom
    )
      continue;
    const top = document.elementFromPoint(x, y);
    if (!top || item.contains(top) || top.contains(item) || layer.contains(top)) continue;
    report.occluded.push({
      name: accessibleName(item),
      selector: selectorFor(item),
      coveredBy: selectorFor(top),
    });
  }

  // 3) Large empty area: horizontal slices with no content at all.
  if (rect.height >= 150) {
    const rowCount = 24;
    const rowHeight = rect.height / rowCount;
    const rows = new Array<boolean>(rowCount).fill(false);
    for (const el of Array.from(layer.querySelectorAll('*')).concat(layer)) {
      if (!isContent(el) || !isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const first = Math.max(0, Math.floor((r.top - rect.top) / rowHeight));
      const last = Math.min(rowCount - 1, Math.floor((r.bottom - 1 - rect.top) / rowHeight));
      for (let row = first; row <= last; row += 1) rows[row] = true;
    }
    const band = emptyBand(rows, rowHeight);
    if (band.height >= Math.max(80, rect.height * 0.4)) {
      report.blank = { height: Math.round(band.height), share: Math.round(band.share * 100) / 100 };
    }
  }
  return report;
}

/**
 * A point to click "outside" an open layer: on nothing interactive, not inside any
 * of the given layers. Null when there is no such point (then that check is skipped).
 */
export function safePoint(layerIds: number[]): { x: number; y: number } | null {
  const layers = layerIds
    .map((id) => registry.elements.get(id))
    .filter((el): el is Element => !!el);
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  for (let row = 1; row < 8; row += 1) {
    for (let col = 1; col < 8; col += 1) {
      const x = Math.round((width * col) / 8);
      const y = Math.round((height * row) / 8);
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (layers.some((layer) => layer.contains(el))) continue;
      if (el.closest(`${INTERACTIVE_ITEMS}, [onclick], summary, [tabindex]`)) continue;
      return { x, y };
    }
  }
  return null;
}

// ------------------------------------------------------------ navigation facts

const MARKED_CLASS = /(^|\s)(active|current|selected|is-active|is-current|is-selected)(\s|$)/;

function normalizedPath(url: URL): string {
  return url.pathname.replace(/\/index\.html?$/, '/').replace(/\/+$/, '') || '/';
}

/** In-page links to missing sections, and navigation that marks the wrong page as current. */
export function navigationFacts(): { brokenAnchors: BrokenAnchor[]; navMismatches: NavMismatch[] } {
  const here = new URL(location.href);
  const brokenAnchors: BrokenAnchor[] = [];
  for (const link of Array.from(document.querySelectorAll('a[href]'))) {
    if (brokenAnchors.length >= 20) break;
    let target: URL;
    try {
      target = new URL(link.getAttribute('href')!, location.href);
    } catch {
      continue;
    }
    if (target.origin !== here.origin || normalizedPath(target) !== normalizedPath(here)) continue;
    if (target.search !== here.search) continue;
    const fragment = decodeURIComponent(target.hash.slice(1));
    // "#" and "#top" are valid by the HTML standard; "#/…" and "#!…" are app routes.
    if (!fragment || fragment.toLowerCase() === 'top' || /^[/!]/.test(fragment)) continue;
    if (document.getElementById(fragment) || document.getElementsByName(fragment).length > 0)
      continue;
    brokenAnchors.push({
      name: accessibleName(link),
      href: link.getAttribute('href')!,
      selector: selectorFor(link),
      html: snippet(link),
      box: pageBox(link),
    });
  }

  const navMismatches: NavMismatch[] = [];
  for (const nav of Array.from(document.querySelectorAll('nav, [role="navigation"]'))) {
    const links = Array.from(nav.querySelectorAll('a[href]')).flatMap((link) => {
      try {
        const url = new URL(link.getAttribute('href')!, location.href);
        if (
          url.origin !== here.origin ||
          (url.hash && normalizedPath(url) === normalizedPath(here))
        )
          return [];
        return [{ link, path: normalizedPath(url) }];
      } catch {
        return [];
      }
    });
    const isMarked = (link: Element) => {
      const current = link.getAttribute('aria-current');
      if (current && current !== 'false') return true;
      return (
        MARKED_CLASS.test(link.className) || MARKED_CLASS.test(link.parentElement?.className ?? '')
      );
    };
    const herePath = normalizedPath(here);
    const exact = links.find((l) => l.path === herePath);
    const marked = links.filter((l) => isMarked(l.link));
    if (!exact || marked.length === 0 || marked.some((m) => m.link === exact.link)) continue;
    // A section link that contains this page (e.g. "/docs" while on "/docs/intro") is fine.
    const wrong = marked.find(
      (m) => m.path !== '/' && !herePath.startsWith(`${m.path}/`) && m.path !== herePath,
    );
    if (!wrong) continue;
    navMismatches.push({
      navSelector: selectorFor(nav),
      marked: {
        name: accessibleName(wrong.link),
        href: wrong.link.getAttribute('href')!,
        selector: selectorFor(wrong.link),
      },
      current: {
        name: accessibleName(exact.link),
        href: exact.link.getAttribute('href')!,
        selector: selectorFor(exact.link),
      },
    });
  }
  return { brokenAnchors, navMismatches };
}

/** Page-coordinate box of a registered element (for evidence screenshots). */
export function boxOf(id: number): Box | null {
  const el = registry.elements.get(id);
  return el ? pageBox(el) : null;
}
