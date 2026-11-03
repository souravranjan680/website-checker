/**
 * Pure decisions of the keyboard and form probes (Phase 9, Milestone 2, Checkpoint 2):
 * which fields may be touched and how, how required fields are recognised, which value
 * a synthetic probe may type, and when a Tab sequence is a keyboard trap. No DOM access,
 * so the scanner and unit tests can import it; the in-page part is probes.ts.
 */
import type { Box } from './types';

export type FormProbeMode = 'OFF' | 'STATIC' | 'BLUR' | 'SYNTHETIC';

/** Why a probe left something alone. Shown in the report (never silent). */
export type ProbeSkipReason =
  | 'sensitive-field'
  | 'personal-data-field'
  | 'unsupported-type'
  | 'captcha'
  | 'disabled'
  | 'read-only'
  | 'not-visible'
  | 'not-required'
  | 'not-empty'
  | 'no-invalid-value'
  | 'mode-static'
  | 'limit'
  | 'activation-not-established'
  | 'side-effect-observed'
  | 'opens-dialog'
  | 'not-explored';

export interface FieldFacts {
  tag: string;
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  /** Visible label text (labels, aria-labelledby). */
  label: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  visible: boolean;
  empty: boolean;
  inCaptcha: boolean;
  pattern: string;
  min: string;
  max: string;
}

export interface FormField extends FieldFacts {
  fieldId: number;
  selector: string;
  html: string;
  box: Box | null;
  formId: number | null;
  /** Visible text of the elements the field's aria-describedby points to. */
  description: string;
  describedByMissing: string[];
  errorMessageMissing: string | null;
  markShown: boolean;
  /** No visible label at all; only a placeholder says what the field is. */
  placeholderOnly: boolean;
  inSearch: boolean;
}
export interface FormFacts {
  formId: number;
  selector: string;
  asteriskLegend: boolean;
  allRequired: boolean;
  optionalConvention: boolean;
}

export interface Feedback {
  /** Text that appeared after the probe, and whether the field points to it. */
  newTexts: { selector: string; text: string; linked: boolean; announced: boolean }[];
  ariaInvalid: boolean;
  /** The field's own look changed (e.g. a red border), without text. */
  lookChanged: boolean;
  /** The browser's own verdict on the value (read without firing events). */
  valid: boolean | null;
  validationMessage: string;
}

/** Types that are never typed into or focused: they hold choices or secrets, not text. */
const NEVER_TYPES = new Set([
  'hidden',
  'password',
  'file',
  'submit',
  'reset',
  'button',
  'image',
  'checkbox',
  'radio',
  'range',
  'color',
]);

/** Secrets and payment data, by autocomplete token or by the field's name/label. */
const SECRET_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/i;
const SECRET_WORDS =
  /pass(word|code|phrase)?\b|\bpin\b|\botp\b|one[- ]time|verification code|security code|\bcvc\b|\bcvv\b|card|iban|account number|routing|\bssn\b|social security|tax id|passport|captcha|secret|token|api key/i;
/** Personal data, by autocomplete token or by the field's name/label. */
const PERSONAL_AUTOCOMPLETE =
  /\b(name|given-name|family-name|additional-name|nickname|honorific-[a-z]+|email|username|tel[a-z-]*|street-address|address-line\d|address-level\d|postal-code|country(-name)?|bday[a-z-]*|sex|organization|organization-title|photo|url|impp)\b/i;
const PERSONAL_WORDS =
  /e-?mail|phone|mobile|\btel\b|address|street|\bcity\b|\bzip\b|postal|post ?code|birth|\bdob\b|first ?name|last ?name|full ?name|surname|\bname\b|\bage\b|gender|national/i;

/**
 * Whether the form probe may touch a field, in the given mode. STATIC reads every field
 * (no events); BLUR focuses and leaves empty required fields; SYNTHETIC may also type
 * one clearly invalid value into email, url, number and pattern fields.
 */
export function fieldPolicy(
  f: FieldFacts,
  mode: FormProbeMode,
): { action: 'blur' | 'synthetic' | null; skip: ProbeSkipReason | null } {
  const text = `${f.name} ${f.id} ${f.label} ${f.placeholder}`;
  if (f.inCaptcha) return { action: null, skip: 'captcha' };
  if (
    f.type === 'password' ||
    SECRET_AUTOCOMPLETE.test(f.autocomplete) ||
    SECRET_WORDS.test(text)
  ) {
    return { action: null, skip: 'sensitive-field' };
  }
  if (PERSONAL_AUTOCOMPLETE.test(f.autocomplete) || PERSONAL_WORDS.test(text)) {
    return { action: null, skip: 'personal-data-field' };
  }
  if (f.tag === 'input' && NEVER_TYPES.has(f.type))
    return { action: null, skip: 'unsupported-type' };
  if (f.disabled) return { action: null, skip: 'disabled' };
  if (f.readOnly) return { action: null, skip: 'read-only' };
  if (!f.visible) return { action: null, skip: 'not-visible' };
  if (mode === 'STATIC') return { action: null, skip: 'mode-static' };
  if (f.required && f.empty) return { action: 'blur', skip: null };
  if (mode === 'SYNTHETIC' && f.empty) {
    return syntheticValue(f) !== null
      ? { action: 'synthetic', skip: null }
      : { action: null, skip: 'no-invalid-value' };
  }
  return { action: null, skip: f.empty ? 'not-required' : 'not-empty' };
}

/**
 * One clearly invalid, non-personal value for a field, or null when none is certain to
 * be invalid. Never used for required-but-valid-looking input: the value must break the
 * field's own rule (type, pattern, min/max).
 */
export function syntheticValue(
  f: Pick<FieldFacts, 'tag' | 'type' | 'pattern' | 'min' | 'max'>,
): string | null {
  if (f.tag !== 'input') return null;
  if (f.type === 'email') return 'not-an-email';
  if (f.type === 'url') return 'not a web address';
  if (f.type === 'number') {
    if (f.min !== '' && Number.isFinite(Number(f.min))) return String(Number(f.min) - 1);
    if (f.max !== '' && Number.isFinite(Number(f.max))) return String(Number(f.max) + 1);
    return null;
  }
  if (
    f.pattern &&
    (f.type === 'text' || f.type === 'search' || f.type === 'tel' || f.type === '')
  ) {
    try {
      const rule = new RegExp(`^(?:${f.pattern})$`, 'v');
      for (const candidate of ['x', '0', '-']) if (!rule.test(candidate)) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

/** A visible "required" mark in a label: an asterisk or the word. */
export const REQUIRED_MARK = /\*|\(required\)|\brequired\b/i;
/** A form-level note that says what the asterisk means. */
export const ASTERISK_LEGEND =
  /(\*\s*(=|means|indicates|denotes|marks|is)?\s*(a\s+)?(required|mandatory))|((required|mandatory)\s+fields?\s+(are\s+)?(marked|indicated|shown)(\s+with)?\s*(an?\s+)?(\*|asterisk))|(fields?\s+(marked|with)\s+(an?\s+)?(\*|asterisk)\s+(are\s+)?(required|mandatory))/i;
/** A form-level note that every field is required (then no per-field mark is needed). */
export const ALL_REQUIRED = /\ball\s+fields\s+(are\s+)?(required|mandatory)\b/i;
/** Optional fields are labelled instead (then unlabelled fields are required by convention). */
export const OPTIONAL_MARK = /\(optional\)|\boptional\b/i;

// --------------------------------------------------------------- keyboard

export interface FocusStep {
  /** Registry id of the focused element; 0 = the page itself (no element focused). */
  id: number;
  selector: string;
  name: string;
  html: string;
  role: string;
  box: Box | null;
  /** Why the focused element cannot be seen; null when it can. */
  hidden: 'not-rendered' | 'off-screen' | 'clipped' | 'transparent' | null;
  /** Did the element (or its parent) look different when focused? null = unknown. */
  styleChanged: boolean | null;
  /** Inside an open modal dialog (aria-modal, or <dialog> shown as a modal). */
  inModal: boolean;
  /** Index among focusable candidates in document order (to find what follows). */
  order: number;
  /** A visible, tabbable element follows this one in document order. */
  moreAfter: boolean;
}

/**
 * A focus cycle: the last focus steps repeat a short cycle (2 to 10 elements) at least
 * three times while visible controls follow it in the page. It is a keyboard trap unless
 * all its elements are in an open modal dialog (keeping focus inside is correct there).
 * Returns the cycle (and whether it is inside a modal), or null.
 */
export function detectTrap(
  steps: Pick<FocusStep, 'id' | 'inModal' | 'moreAfter'>[],
): { cycle: number[]; inModal: boolean } | null {
  const ids = steps.map((s) => s.id);
  for (let length = 2; length <= 10; length += 1) {
    if (ids.length < length * 3) break;
    const tail = ids.slice(-length * 3);
    const cycle = tail.slice(0, length);
    if (new Set(cycle).size !== length || cycle.includes(0)) continue;
    let repeats = true;
    for (let i = length; i < tail.length; i += 1) {
      if (tail[i] !== cycle[i % length]) {
        repeats = false;
        break;
      }
    }
    if (!repeats) continue;
    const members = steps.slice(-length);
    if (!members.some((s) => s.moreAfter)) return null; // nothing follows: just the page's end
    return { cycle, inModal: members.every((s) => s.inModal) };
  }
  return null;
}
