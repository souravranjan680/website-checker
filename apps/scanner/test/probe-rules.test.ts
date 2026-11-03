/**
 * Phase 9, Milestone 2 (Checkpoint 2): the pure rules of the keyboard and form probes —
 * which fields may be touched (and how), synthetic values, required marks, and traps.
 */
import {
  ALL_REQUIRED,
  ASTERISK_LEGEND,
  detectTrap,
  fieldPolicy,
  OPTIONAL_MARK,
  REQUIRED_MARK,
  syntheticValue,
  type FieldFacts,
} from '@whc/dom-checks';
import { describe, expect, it } from 'vitest';

function field(overrides: Partial<FieldFacts>): FieldFacts {
  return {
    tag: 'input',
    type: 'text',
    autocomplete: '',
    name: 'title',
    id: 'title',
    label: 'Project title',
    placeholder: '',
    required: true,
    disabled: false,
    readOnly: false,
    visible: true,
    empty: true,
    inCaptcha: false,
    pattern: '',
    min: '',
    max: '',
    ...overrides,
  };
}

describe('which fields the form probe may touch', () => {
  it('BLUR (default) focuses and leaves empty required fields only', () => {
    expect(fieldPolicy(field({}), 'BLUR')).toEqual({ action: 'blur', skip: null });
    expect(fieldPolicy(field({ required: false }), 'BLUR')).toEqual({
      action: null,
      skip: 'not-required',
    });
    expect(fieldPolicy(field({ empty: false }), 'BLUR')).toEqual({
      action: null,
      skip: 'not-empty',
    });
  });

  it('STATIC reads fields but never focuses them', () => {
    expect(fieldPolicy(field({}), 'STATIC')).toEqual({ action: null, skip: 'mode-static' });
  });

  it('SYNTHETIC types only where a value is certainly invalid; never without the opt-in', () => {
    const email = field({
      type: 'email',
      name: 'contact-format',
      label: 'Format check',
      required: false,
    });
    expect(fieldPolicy(email, 'SYNTHETIC')).toEqual({ action: 'synthetic', skip: null });
    expect(fieldPolicy(email, 'BLUR')).toEqual({ action: null, skip: 'not-required' });
    expect(fieldPolicy(field({ required: false }), 'SYNTHETIC')).toEqual({
      action: null,
      skip: 'no-invalid-value',
    });
    // Required and empty: leaving it is enough, nothing is typed.
    expect(fieldPolicy(field({ type: 'url', label: 'Repository' }), 'SYNTHETIC')).toEqual({
      action: 'blur',
      skip: null,
    });
  });

  it('never touches secrets, payment data or one-time codes, in any mode', () => {
    for (const f of [
      field({ type: 'password', label: 'Password' }),
      field({ autocomplete: 'one-time-code', label: 'Code' }),
      field({ autocomplete: 'cc-number', label: 'Number' }),
      field({ label: 'Verification code' }),
      field({ label: 'Card number' }),
      field({ name: 'api-token', label: 'Key' }),
    ]) {
      for (const mode of ['STATIC', 'BLUR', 'SYNTHETIC'] as const) {
        expect(fieldPolicy(f, mode)).toEqual({ action: null, skip: 'sensitive-field' });
      }
    }
  });

  it('never touches personal data, by autocomplete or by its name or label', () => {
    for (const f of [
      field({ type: 'email', autocomplete: 'email', label: 'Contact' }),
      field({ autocomplete: 'given-name', label: 'First' }),
      field({ label: 'E-mail address' }),
      field({ label: 'Phone' }),
      field({ label: 'Full name' }),
      field({ name: 'street', label: 'Where' }),
      field({ label: 'Date of birth' }),
    ]) {
      expect(fieldPolicy(f, 'SYNTHETIC')).toEqual({ action: null, skip: 'personal-data-field' });
    }
  });

  it('leaves choices, files, CAPTCHAs, disabled, read-only and hidden fields alone', () => {
    expect(fieldPolicy(field({ type: 'checkbox', label: 'Agree' }), 'BLUR').skip).toBe(
      'unsupported-type',
    );
    expect(fieldPolicy(field({ type: 'file', label: 'Upload' }), 'BLUR').skip).toBe(
      'unsupported-type',
    );
    expect(fieldPolicy(field({ inCaptcha: true }), 'BLUR').skip).toBe('captcha');
    expect(fieldPolicy(field({ disabled: true }), 'BLUR').skip).toBe('disabled');
    expect(fieldPolicy(field({ readOnly: true }), 'BLUR').skip).toBe('read-only');
    expect(fieldPolicy(field({ visible: false }), 'BLUR').skip).toBe('not-visible');
  });
});

describe('synthetic values', () => {
  it('breaks the field’s own rule, with non-personal values', () => {
    expect(syntheticValue(field({ type: 'email' }))).toBe('not-an-email');
    expect(syntheticValue(field({ type: 'url' }))).toBe('not a web address');
    expect(syntheticValue(field({ type: 'number', min: '1' }))).toBe('0');
    expect(syntheticValue(field({ type: 'number', max: '10' }))).toBe('11');
    expect(syntheticValue(field({ pattern: 'v[0-9]+\\.[0-9]+' }))).toBe('x');
    expect(syntheticValue(field({ pattern: '[A-Z]{3}-[0-9]{3}' }))).toBe('x');
  });

  it('gives up when no value is certainly invalid', () => {
    expect(syntheticValue(field({}))).toBeNull(); // plain text accepts anything
    expect(syntheticValue(field({ type: 'number' }))).toBeNull(); // no min or max
    expect(syntheticValue(field({ pattern: '.*' }))).toBeNull();
    expect(syntheticValue(field({ tag: 'textarea', type: 'textarea' }))).toBeNull();
    expect(syntheticValue(field({ pattern: '[' }))).toBeNull(); // broken pattern
  });
});

describe('required marks and form notes', () => {
  it('recognises marks in labels', () => {
    expect(REQUIRED_MARK.test('Name *')).toBe(true);
    expect(REQUIRED_MARK.test('Name (required)')).toBe(true);
    expect(REQUIRED_MARK.test('Name')).toBe(false);
    expect(OPTIONAL_MARK.test('Details (optional)')).toBe(true);
  });

  it('recognises what a form says about its asterisks and required fields', () => {
    expect(ASTERISK_LEGEND.test('Fields marked * are required.')).toBe(true);
    expect(ASTERISK_LEGEND.test('* indicates a required field')).toBe(true);
    expect(ASTERISK_LEGEND.test('Required fields are marked with an asterisk')).toBe(true);
    expect(ASTERISK_LEGEND.test('Tell us about your project.')).toBe(false);
    expect(ALL_REQUIRED.test('All fields are required.')).toBe(true);
    expect(ALL_REQUIRED.test('Some fields are required.')).toBe(false);
  });
});

describe('keyboard traps', () => {
  const step = (id: number, inModal = false, moreAfter = true) => ({ id, inModal, moreAfter });

  it('a short cycle repeated three times, with controls after it, outside a modal', () => {
    const steps = [1, 2, 3, 4, 5, 3, 4, 5, 3, 4, 5].map((id) => step(id));
    expect(detectTrap(steps)).toEqual({ cycle: [3, 4, 5], inModal: false });
  });

  it('the same cycle inside an open modal dialog is reported as such (correct behaviour)', () => {
    const steps = [7, 8, 7, 8, 7, 8].map((id) => step(id, true));
    expect(detectTrap(steps)).toEqual({ cycle: [7, 8], inModal: true });
  });

  it('not a trap: the cycle passes through the page itself, nothing follows it, or too few repeats', () => {
    expect(detectTrap([1, 2, 0, 1, 2, 0, 1, 2, 0].map((id) => step(id)))).toBeNull();
    expect(detectTrap([3, 4, 3, 4, 3, 4].map((id) => step(id, false, false)))).toBeNull();
    expect(detectTrap([3, 4, 5, 3, 4, 5].map((id) => step(id)))).toBeNull();
    expect(detectTrap([1, 2, 3, 4, 5, 6].map((id) => step(id)))).toBeNull();
  });
});
