/**
 * Side-effect watch for the probes of Phase 9 (keyboard and form probes use it from
 * Milestone 2, Checkpoint 2). Focus, blur, key presses, checkValidity() and the page's
 * own event handlers can all change the page; this tells expected changes (inside the
 * probed component) from unrelated ones, so a probe step can be marked inconclusive.
 *
 * Every DOM mutation is put in one bucket:
 *   expected      inside the probed component: the element, its wrapper (the closest
 *                 ancestors that contain no other control), its labels, and the elements
 *                 it points to (aria-controls/-owns/-describedby/-errormessage/-activedescendant)
 *   announcement  inside a live region (role=alert/status/log, aria-live): feedback
 *   ambient       attributes of <html> or <body> (focus-style classes and similar)
 *   background    an element that also changed while nothing was probed (clocks, carousels)
 *   unrelated     anything else: a possible side effect of the probe
 * Our own markers (data-whc-*) are ignored.
 */
import { selectorFor } from './dom-utils';
import type { SideEffectBucket, SideEffectReport } from './extra-rules';

const FOCUSABLE =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable=true]';
const LIVE = '[aria-live]:not([aria-live=off]), [role=alert], [role=status], [role=log]';
const REFERENCES = [
  'aria-controls',
  'aria-owns',
  'aria-describedby',
  'aria-errormessage',
  'aria-activedescendant',
];

let observer: MutationObserver | null = null;
let records: MutationRecord[] = [];
let component: Element[] = [];
let background: Element[] = [];

/** The probed element plus everything that belongs to it (see the header). */
export function componentArea(el: Element): Element[] {
  const area = new Set<Element>([el]);
  // Wrapper: ancestors (up to 3 levels) that contain no other control.
  for (
    let node = el.parentElement, level = 0;
    node && level < 3;
    node = node.parentElement, level += 1
  ) {
    if (node === document.body || node === document.documentElement) break;
    const controls = Array.from(node.querySelectorAll(FOCUSABLE)).filter(
      (c) => c !== el && !el.contains(c),
    );
    if (controls.length > 0) break;
    area.add(node);
  }
  for (const attr of REFERENCES) {
    for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
      const target = document.getElementById(id);
      if (target) area.add(target);
    }
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels) Array.from(labels).forEach((label) => area.add(label));
  return [...area];
}

function targetElement(record: MutationRecord): Element | null {
  return record.target.nodeType === Node.ELEMENT_NODE
    ? (record.target as Element)
    : record.target.parentElement;
}

function bucketOf(record: MutationRecord): SideEffectBucket {
  const target = targetElement(record);
  if (!target) return 'background';
  if (component.some((c) => c.contains(target))) return 'expected';
  if (target.closest(LIVE)) return 'announcement';
  if (
    record.type === 'attributes' &&
    (target === document.documentElement || target === document.body)
  ) {
    return 'ambient';
  }
  if (background.some((b) => b.contains(target))) return 'background';
  return 'unrelated';
}

function observe(): void {
  observer?.disconnect();
  records = [];
  observer = new MutationObserver((list) => {
    for (const record of list) {
      if (record.type === 'attributes' && record.attributeName?.startsWith('data-whc')) continue;
      if (
        record.type === 'attributes' &&
        record.oldValue === (record.target as Element).getAttribute(record.attributeName ?? '')
      ) {
        continue; // set to the value it already had
      }
      records.push(record);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
  });
}

/**
 * Step 1: watch while nothing is probed, to learn which elements change on their own.
 * Call stopBaseline() after a short wait.
 */
export function startBaseline(): void {
  component = [];
  background = [];
  observe();
}

export function stopBaseline(): number {
  observer?.disconnect();
  observer = null;
  const changed = new Set<Element>();
  for (const record of records) {
    const target = targetElement(record);
    if (target && target !== document.documentElement && target !== document.body)
      changed.add(target);
  }
  background = [...changed];
  records = [];
  return background.length;
}

/** Step 2: watch while probing `element` (by the explorer's element registry or a selector). */
export function start(element: Element): void {
  component = componentArea(element);
  observe();
}

export function stop(): SideEffectReport {
  observer?.disconnect();
  observer = null;
  const counts: Record<SideEffectBucket, number> = {
    expected: 0,
    announcement: 0,
    ambient: 0,
    background: 0,
    unrelated: 0,
  };
  const unrelated: SideEffectReport['unrelated'] = [];
  for (const record of records) {
    const bucket = bucketOf(record);
    counts[bucket] += 1;
    if (bucket === 'unrelated' && unrelated.length < 10) {
      const target = targetElement(record);
      unrelated.push({
        selector: target ? selectorFor(target) : '(removed)',
        type: record.type,
        attribute: record.attributeName,
      });
    }
  }
  records = [];
  return { counts, unrelated };
}
