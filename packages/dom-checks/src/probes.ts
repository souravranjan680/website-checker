/**
 * In-page part of the keyboard and form probes (Phase 9, Milestone 2, Checkpoint 2).
 * Reads facts only; the scanner presses keys and focuses fields (keyboard-probe.ts,
 * form-probe.ts), with the safety layer armed and the side-effect watch running.
 * Elements are named by the explorer's registry (explore.ts), so they survive between calls.
 */
import { isVisible, pageBox, selectorFor, snippet } from './dom-utils';
import { accessibleName, element, register } from './explore';
import {
  ALL_REQUIRED,
  ASTERISK_LEGEND,
  OPTIONAL_MARK,
  REQUIRED_MARK,
  type Feedback,
  type FocusStep,
  type FormFacts,
  type FormField,
} from './probe-rules';

const FOCUSABLE =
  'a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable=true]';
const LIVE = '[aria-live]:not([aria-live=off]), [role=alert], [role=status], [role=log]';
const INTERACTIVE_ANCESTOR =
  'a[href], area[href], button, input, select, textarea, summary, label, iframe, [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex^="-"])';

function isTabbable(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest('[inert]')) return false;
  const tabindex = el.getAttribute('tabindex');
  return tabindex === null || Number(tabindex) >= 0;
}

function effectiveOpacity(el: Element): number {
  let opacity = 1;
  for (let node: Element | null = el; node && opacity > 0; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity);
  }
  return opacity;
}

/** Why a (focused) element cannot be seen, or null when it can. */
function hiddenReason(el: Element): FocusStep['hidden'] {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  if (
    rect.width < 1 ||
    rect.height < 1 ||
    style.visibility === 'hidden' ||
    style.display === 'none'
  ) {
    return 'not-rendered';
  }
  if (effectiveOpacity(el) < 0.05) return 'transparent';
  const docWidth = document.documentElement.scrollWidth;
  if (
    rect.right + window.scrollX <= 0 ||
    rect.bottom + window.scrollY <= 0 ||
    rect.left + window.scrollX >= docWidth ||
    (getComputedStyle(el).position === 'fixed' &&
      (rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= window.innerWidth ||
        rect.top >= window.innerHeight))
  ) {
    return 'off-screen';
  }
  if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)')
    return 'clipped';
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const s = getComputedStyle(node);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const clip = node.getBoundingClientRect();
    const w = Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left);
    const h = Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top);
    if (w < 1 || h < 1) return 'clipped';
  }
  return null;
}

// ---------------------------------------------------------------- keyboard

const SIGNATURE = [
  'outline-style',
  'outline-width',
  'outline-color',
  'outline-offset',
  'box-shadow',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-width',
  'border-bottom-width',
  'background-color',
  'background-image',
  'color',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-thickness',
  'opacity',
  'transform',
];
/** How an element looks, leaving out what cannot be seen (e.g. the offset of no outline). */
function signature(el: Element): string {
  const own = getComputedStyle(el);
  const noOutline = own.outlineStyle === 'none' || own.outlineWidth === '0px';
  const noBorderTop = own.borderTopStyle === 'none' || own.borderTopWidth === '0px';
  const noBorderBottom = own.borderBottomStyle === 'none' || own.borderBottomWidth === '0px';
  const noBorderSides =
    (own.borderLeftStyle === 'none' || own.borderLeftWidth === '0px') &&
    (own.borderRightStyle === 'none' || own.borderRightWidth === '0px');
  const noDecoration = own.textDecorationLine === 'none';
  const invisible = new Set<string>([
    ...(noOutline ? ['outline-width', 'outline-color', 'outline-offset'] : []),
    ...(noBorderTop ? ['border-top-color', 'border-top-width'] : []),
    ...(noBorderBottom ? ['border-bottom-color', 'border-bottom-width'] : []),
    ...(noBorderSides ? ['border-left-color', 'border-right-color'] : []),
    ...(noDecoration ? ['text-decoration-color', 'text-decoration-thickness'] : []),
  ]);
  const parts = SIGNATURE.map((p) => (invisible.has(p) ? '-' : own.getPropertyValue(p)));
  for (const pseudo of ['::before', '::after']) {
    const s = getComputedStyle(el, pseudo);
    parts.push(
      s.content,
      s.outlineStyle,
      s.boxShadow,
      s.backgroundColor,
      s.borderBottomColor,
      s.opacity,
    );
  }
  return parts.join('|');
}
const unfocused = new Map<number, [string, string]>();

/**
 * Before the Tab walk, with nothing focused: how each focusable element (and its parent)
 * looks unfocused, to compare with how it looks when focused.
 */
export function snapshotFocusStyles(limit = 600): number {
  (document.activeElement as HTMLElement | null)?.blur?.();
  unfocused.clear();
  for (const el of Array.from(document.querySelectorAll(FOCUSABLE)).slice(0, limit)) {
    unfocused.set(register(el), [
      signature(el),
      el.parentElement ? signature(el.parentElement) : '',
    ]);
  }
  window.scrollTo(0, 0);
  return unfocused.size;
}

/** What has focus now, whether it can be seen, and whether it looks focused. */
export function focusStep(): FocusStep {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    return {
      id: 0,
      selector: 'body',
      name: '',
      html: '',
      role: '',
      box: null,
      hidden: null,
      styleChanged: null,
      inModal: false,
      order: -1,
      moreAfter: false,
    };
  }
  const id = register(el);
  const candidates = Array.from(document.querySelectorAll(FOCUSABLE));
  const order = candidates.indexOf(el);
  const moreAfter = candidates
    .slice(order + 1)
    .some((c) => isTabbable(c) && isVisible(c) && hiddenReason(c) === null);
  const before = unfocused.get(id);
  const styleChanged = before
    ? before[0] !== signature(el) ||
      before[1] !== (el.parentElement ? signature(el.parentElement) : '')
    : null;
  const modal = el.closest('[aria-modal="true"], dialog');
  const inModal = Boolean(
    modal &&
    (modal.getAttribute('aria-modal') === 'true' ? isVisible(modal) : modal.matches(':modal')),
  );
  return {
    id,
    selector: selectorFor(el),
    name: accessibleName(el).slice(0, 80),
    html: snippet(el),
    role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
    box: pageBox(el),
    hidden: hiddenReason(el),
    styleChanged,
    inModal,
    order,
    moreAfter,
  };
}

/** Moves focus back to an element the walk left (for the screenshot comparison). */
export function refocus(id: number): boolean {
  const el = element(id) as HTMLElement | null;
  if (!el?.isConnected) return false;
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  return document.activeElement === el;
}

/** Programmatic focus of a control (before pressing Enter/Space on it). */
export function focusControl(selector: string): boolean {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return false;
  el.focus({ focusVisible: true } as FocusOptions);
  return document.activeElement === el;
}

/**
 * Elements that look clickable (pointer cursor) but Tab never reaches: not focusable,
 * no tabindex, not inside a focusable element or a label. The outermost one only.
 * (Whether they really have a click handler is asked of the browser by the scanner.)
 */
export function clickCandidates(
  limit = 50,
): { id: number; selector: string; name: string; html: string; box: ReturnType<typeof pageBox> }[] {
  const out: ReturnType<typeof clickCandidates> = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (out.length >= limit) break;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    const parent = el.parentElement;
    if (parent && getComputedStyle(parent).cursor === 'pointer') continue; // inherited
    // Inside a link, button, label or keyboard-reachable element: that one gets focus.
    // (A tabindex="-1" container, such as <main tabindex="-1">, does not count.)
    if (el.matches(FOCUSABLE) || el.closest(INTERACTIVE_ANCESTOR)) continue;
    if (!isVisible(el) || hiddenReason(el) !== null) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    out.push({
      id: register(el),
      selector: selectorFor(el),
      name: accessibleName(el).slice(0, 80),
      html: snippet(el),
      box: pageBox(el),
    });
  }
  return out;
}

// ------------------------------------------------------------------- forms

function visibleText(el: Element | null): string {
  if (!el || !isVisible(el)) return '';
  const s = getComputedStyle(el);
  if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return '';
  return ((el as HTMLElement).innerText ?? '').trim();
}

const idsOf = (value: string | null) => (value ?? '').split(/\s+/).filter(Boolean);

function labelText(el: Element): string {
  const parts: string[] = [];
  const labels = (el as HTMLInputElement).labels;
  if (labels) for (const label of Array.from(labels)) parts.push(visibleText(label));
  for (const id of idsOf(el.getAttribute('aria-labelledby')))
    parts.push(visibleText(document.getElementById(id)));
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function formOf(el: Element): Element | null {
  return (el as HTMLInputElement).form ?? el.closest('form, [role=form]');
}

/** Every form field's facts (no focus, no events), and each form's notes. */
export function formFacts(limit = 50): { fields: FormField[]; forms: FormFacts[] } {
  const fields: FormField[] = [];
  const forms = new Map<Element, FormFacts>();
  for (const el of Array.from(document.querySelectorAll('input, select, textarea')).slice(
    0,
    limit * 2,
  )) {
    if (fields.length >= limit) break;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : tag;
    if (type === 'hidden') continue;
    const input = el as HTMLInputElement;
    const form = formOf(el);
    if (form && !forms.has(form)) {
      const text = visibleText(form);
      forms.set(form, {
        formId: register(form),
        selector: selectorFor(form),
        asteriskLegend: ASTERISK_LEGEND.test(text),
        allRequired: ALL_REQUIRED.test(text),
        optionalConvention: false,
      });
    }
    const label = labelText(el);
    const descriptionIds = idsOf(el.getAttribute('aria-describedby'));
    const description = descriptionIds
      .map((id) => visibleText(document.getElementById(id)))
      .filter(Boolean)
      .join(' ');
    const errorMessage = el.getAttribute('aria-errormessage');
    const visible = isVisible(el) && hiddenReason(el) === null;
    if (form && OPTIONAL_MARK.test(label)) forms.get(form)!.optionalConvention = true;
    fields.push({
      fieldId: register(el),
      selector: selectorFor(el),
      html: snippet(el),
      box: visible ? pageBox(el) : null,
      formId: form ? register(form) : null,
      tag,
      type,
      autocomplete: el.getAttribute('autocomplete') ?? '',
      name: el.getAttribute('name') ?? '',
      id: el.id,
      label,
      placeholder: el.getAttribute('placeholder') ?? '',
      required: input.required || el.getAttribute('aria-required') === 'true',
      disabled: input.disabled,
      readOnly: input.readOnly ?? false,
      visible,
      empty: (input.value ?? '') === '',
      inCaptcha: Boolean(
        el.closest(
          '.g-recaptcha, .h-captcha, .cf-turnstile, [class*="captcha" i], [id*="captcha" i]',
        ),
      ),
      pattern: el.getAttribute('pattern') ?? '',
      min: el.getAttribute('min') ?? '',
      max: el.getAttribute('max') ?? '',
      description,
      describedByMissing: descriptionIds.filter((id) => !document.getElementById(id)),
      errorMessageMissing:
        errorMessage && !document.getElementById(errorMessage) ? errorMessage : null,
      markShown: REQUIRED_MARK.test(label) || REQUIRED_MARK.test(description),
      placeholderOnly: visible && !label && Boolean((el.getAttribute('placeholder') ?? '').trim()),
      inSearch: type === 'search' || Boolean(el.closest('[role=search], search')),
    });
  }
  return { fields, forms: [...forms.values()] };
}

// What a field showed before the probe touched it (see feedbackAfter).
const shownBefore = new Map<number, { texts: Set<string>; invalid: string | null; look: string }>();

function feedbackRoot(field: Element): Element {
  return formOf(field) ?? field.closest('fieldset, section') ?? document.body;
}
function textOwners(root: Element): Map<string, Element> {
  const out = new Map<string, Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && out.size < 400; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    const owner = node.parentElement;
    if (!text || !owner || owner.closest('script, style, template, option')) continue;
    if (!visibleText(owner)) continue;
    out.set(`${selectorFor(owner)}|${text}`, owner);
  }
  return out;
}
const lookOf = (el: Element) => {
  const s = getComputedStyle(el);
  return [
    s.borderTopColor,
    s.borderBottomColor,
    s.outlineColor,
    s.backgroundColor,
    s.boxShadow,
  ].join('|');
};

export function feedbackBefore(fieldId: number): boolean {
  const field = element(fieldId);
  if (!field) return false;
  shownBefore.set(fieldId, {
    texts: new Set(textOwners(feedbackRoot(field)).keys()),
    invalid: field.getAttribute('aria-invalid'),
    look: lookOf(field),
  });
  return true;
}

export function feedbackAfter(fieldId: number): Feedback | null {
  const field = element(fieldId) as HTMLInputElement | null;
  const before = shownBefore.get(fieldId);
  if (!field || !before) return null;
  const linkedIds = new Set([
    ...idsOf(field.getAttribute('aria-describedby')),
    ...idsOf(field.getAttribute('aria-errormessage')),
  ]);
  const newTexts: Feedback['newTexts'] = [];
  for (const [key, owner] of textOwners(feedbackRoot(field))) {
    if (before.texts.has(key) || newTexts.length >= 5) continue;
    let linked = false;
    for (
      let node: Element | null = owner;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (node.id && linkedIds.has(node.id)) linked = true;
    }
    newTexts.push({
      selector: selectorFor(owner),
      text: key.slice(key.indexOf('|') + 1).slice(0, 120),
      linked,
      announced: Boolean(owner.closest(LIVE)),
    });
  }
  return {
    newTexts,
    ariaInvalid: field.getAttribute('aria-invalid') === 'true' && before.invalid !== 'true',
    lookChanged: lookOf(field) !== before.look,
    valid: field.validity ? field.validity.valid : null,
    validationMessage: field.validationMessage ?? '',
  };
}

/** Focus a field (the probe's "click into it"); returns whether it took focus. */
export function focusField(fieldId: number): boolean {
  const field = element(fieldId) as HTMLElement | null;
  if (!field) return false;
  field.focus();
  return document.activeElement === field;
}

/** Move focus away from a field (the probe's "leave it"). */
export function blurField(fieldId: number): void {
  (element(fieldId) as HTMLElement | null)?.blur();
}
