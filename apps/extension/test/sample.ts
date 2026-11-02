import type { AxeFinding, UiFinding } from '@whc/dom-checks';
import type { PageCheckResult } from '../src/types';

/** A check result as the in-page runner returns it (shared by the unit tests). */
export const sampleResult: PageCheckResult = {
  url: 'https://shop.example.com/cart?session=abc#top',
  title: 'Cart',
  checkedAt: '2026-11-03T10:00:00.000Z',
  axeVersion: '4.14.0',
  viewport: { width: 1280, height: 800 },
  accessibility: [
    {
      ruleId: 'image-alt',
      severity: 'CRITICAL',
      title: 'Images must have alternative text',
      description: 'Ensure <img> elements have alternate text',
      selector: 'img.logo',
      html: '<img class="logo" src="```x.png">',
      suggestedFix:
        'Add an alt attribute.\n\nGuidance: https://dequeuniversity.com/rules/axe/4.14/image-alt',
      totalElements: null,
      impact: 'critical',
      wcagCriteria: ['1.1.1'],
      wcagLevel: 'A',
      tags: ['wcag2a', 'wcag111'],
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
      detection: 'AUTOMATED',
      failureSummary: 'Add an alt attribute.',
    } satisfies AxeFinding,
  ],
  ui: [
    {
      ruleId: 'ui/empty-button',
      check: 'EMPTY_BUTTON',
      severity: 'HIGH',
      title: 'Button without text or label',
      description: 'This button has no text.',
      selector: 'button.icon',
      html: '<button class="icon"></button>',
      box: null,
      suggestedFix: 'Add visible text.',
    } satisfies UiFinding,
  ],
  imagesFixedOnRetry: [],
  frames: { total: 1, crossOrigin: 1 },
};
