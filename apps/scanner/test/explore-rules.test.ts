/**
 * The safe explorer's pure decisions (Phase 9, Milestone 1): which controls may be
 * used, and the geometry of opened layers. No browser needed.
 */
import {
  clippedPixels,
  eligibility,
  emptyBand,
  STATE_CHANGING_WORDS,
  type ControlFacts,
} from '@whc/dom-checks';
import { describe, expect, it } from 'vitest';

const button = (overrides: Partial<ControlFacts>): ControlFacts => ({
  tag: 'button',
  role: null,
  type: 'button',
  name: 'Menu',
  href: null,
  ariaExpanded: null,
  ariaHaspopup: null,
  ariaControls: null,
  ariaSelected: null,
  controlsHiddenRegion: false,
  inForm: false,
  disabled: false,
  visible: true,
  detailsOpen: null,
  ...overrides,
});

describe('eligibility: only safe disclosure controls are explored', () => {
  it.each<[string, Partial<ControlFacts>, string]>([
    [
      'a menu button (aria-haspopup)',
      { name: 'Account', ariaHaspopup: 'menu', ariaExpanded: 'false' },
      'menu',
    ],
    ['a listbox trigger', { name: 'Sort by', ariaHaspopup: 'listbox' }, 'menu'],
    ['an accordion (aria-expanded)', { name: 'Shipping', ariaExpanded: 'false' }, 'disclosure'],
    [
      'a button controlling a hidden region',
      { name: 'Notes', ariaControls: 'x', controlsHiddenRegion: true },
      'disclosure',
    ],
    ['a <details> summary', { tag: 'summary', name: 'Awards', detailsOpen: false }, 'details'],
    ['an unselected tab', { role: 'tab', name: 'Activity', ariaSelected: 'false' }, 'tab'],
    ['"Show more" wording', { name: 'Show more' }, 'disclosure'],
    [
      'a link-like toggle with href="#"',
      { tag: 'a', href: '#', name: 'Menu', ariaExpanded: 'false' },
      'disclosure',
    ],
  ])('explores %s', (_label, facts, kind) => {
    expect(eligibility(button(facts))).toMatchObject({ eligible: true, kind });
  });

  it.each<[string, Partial<ControlFacts>, string]>([
    ['Delete', { name: 'Delete project', ariaExpanded: 'false' }, 'destructive-or-state-changing'],
    ['Purchase', { name: 'Purchase plan' }, 'destructive-or-state-changing'],
    ['Send', { name: 'Send envelope', ariaHaspopup: 'menu' }, 'destructive-or-state-changing'],
    ['Sign', { name: 'Sign document' }, 'destructive-or-state-changing'],
    ['Create', { name: 'Create template', ariaExpanded: 'false' }, 'destructive-or-state-changing'],
    ['Save', { name: 'Save changes' }, 'destructive-or-state-changing'],
    ['Log out', { name: 'Log out' }, 'destructive-or-state-changing'],
    ['Apply (changes a filter)', { name: 'Apply' }, 'destructive-or-state-changing'],
    ['a submit button in a form', { name: 'Filters', inForm: true, type: null }, 'form-submit'],
    ['an <input type=submit>', { tag: 'input', type: 'submit', name: 'Go' }, 'form-submit'],
    ['a link that navigates', { tag: 'a', href: '/pricing', name: 'More' }, 'navigation-link'],
    ['a dialog trigger', { name: 'Details', ariaHaspopup: 'dialog' }, 'opens-dialog'],
    ['a native select', { tag: 'select', type: null, name: 'Country' }, 'native-form-control'],
    ['a disabled control', { ariaExpanded: 'false', disabled: true }, 'disabled'],
    ['a hidden control', { ariaExpanded: 'false', visible: false }, 'not-visible'],
    ['an already open menu', { ariaHaspopup: 'menu', ariaExpanded: 'true' }, 'already-open'],
    ['the selected tab', { role: 'tab', ariaSelected: 'true', name: 'Overview' }, 'already-open'],
    ['an open <details>', { tag: 'summary', name: 'FAQ', detailsOpen: true }, 'already-open'],
    ['a button with an unknown action', { name: 'Continue' }, 'unknown-action'],
  ])('skips %s', (_label, facts, reason) => {
    expect(eligibility(button(facts))).toEqual({ eligible: false, reason });
  });

  it('never explores a control whose name changes data, whatever its semantics', () => {
    for (const name of [
      'Delete',
      'Remove item',
      'Pay now',
      'Checkout',
      'Submit',
      'Publish',
      'Add to cart',
      'Download',
      'Export',
      'Share',
      'Invite',
      'Cancel order',
      'Reset',
      'Clear all',
    ]) {
      expect(STATE_CHANGING_WORDS.test(name), name).toBe(true);
      expect(eligibility(button({ name, ariaHaspopup: 'menu' })).eligible, name).toBe(false);
    }
  });

  it('does not mistake ordinary words for actions', () => {
    for (const name of [
      'Reports',
      'Account',
      'Settings',
      'Sort by',
      'Filters',
      'Profile',
      'Notifications',
      'Size',
      'Workspace',
    ]) {
      expect(STATE_CHANGING_WORDS.test(name), name).toBe(false);
    }
  });
});

describe('layer geometry', () => {
  const own = { left: 100, top: 100, right: 300, bottom: 200 }; // 200 × 100

  it('measures how much of a layer is cut off', () => {
    expect(clippedPixels(own, [{ left: 0, top: 0, right: 1000, bottom: 1000 }])).toBe(0);
    expect(clippedPixels(own, [{ left: 0, top: 0, right: 200, bottom: 1000 }])).toBe(10_000); // right half
    expect(
      clippedPixels(own, [
        { left: 0, top: 0, right: 1000, bottom: 150 },
        { left: 0, top: 0, right: 200, bottom: 1000 },
      ]),
    ).toBe(15_000);
    expect(clippedPixels(own, [{ left: 0, top: 0, right: 50, bottom: 50 }])).toBe(20_000); // fully hidden
  });

  it('finds the tallest empty band of a layer', () => {
    expect(emptyBand([true, false, false, false, true, false], 10)).toEqual({
      height: 30,
      share: 0.5,
    });
    expect(emptyBand([true, true, true], 20)).toEqual({ height: 0, share: 0 });
    expect(emptyBand([], 20)).toEqual({ height: 0, share: 0 });
  });
});
