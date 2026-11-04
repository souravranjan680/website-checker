/**
 * Phase 9, Milestone 3 (Checkpoint 2): the cross-browser comparison rules (pure), and the
 * in-page facts they rely on (element identities, CSS in use and the engine's own support
 * verdicts) in a real browser.
 */
import { normalizeResourceUrl, type ElementIdentity } from '@whc/dom-checks';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDomChecksBundle } from '../src/checks/dom';
import { compatibilityDraft } from '../src/compat-issues';
import { classifyDraft } from '../src/issues';
import {
  compareFacts,
  confirmDifferences,
  matchElement,
  type ComparableFacts,
  type LocatedFact,
} from '../src/pipeline/compat-diff';

const SITE = 'shop.example';
const facts = (overrides: Partial<ComparableFacts> = {}): ComparableFacts => ({
  exceptions: [],
  failedRequests: [],
  fonts: [],
  ui: [],
  layout: [],
  accessibility: [],
  ...overrides,
});
const id = (overrides: Partial<ElementIdentity> = {}): ElementIdentity => ({
  attribute: null,
  path: null,
  selector: null,
  ...overrides,
});
const located = (check: string, identity: ElementIdentity | null, selector = 'p'): LocatedFact => ({
  check,
  selector,
  html: '<p>',
  identity,
});
const request = (url: string, status: number | null, blockedByPolicy = false) => ({
  url,
  resourceType: 'script',
  status,
  error: status === null ? 'NS_ERROR_NET_RESET' : null,
  blockedByPolicy,
});

describe('URL normalization', () => {
  it('removes the fragment and known tracking parameters only, keeping the order', () => {
    expect(
      normalizeResourceUrl(
        'https://shop.example/a.js?v=3&utm_source=mail&lang=nl&gclid=abc&fbclid=x&_ga=1#top',
      ),
    ).toBe('https://shop.example/a.js?v=3&lang=nl');
  });

  it('keeps every meaningful parameter (they can change what the server sends)', () => {
    const url = 'https://shop.example/img?size=large&format=webp&id=7&page=2';
    expect(normalizeResourceUrl(url)).toBe(url);
    // The order is kept: not sorted, so nothing is rewritten that a server might read.
    expect(normalizeResourceUrl('https://shop.example/x?b=1&utm_medium=x&a=2')).toBe(
      'https://shop.example/x?b=1&a=2',
    );
  });

  it('leaves what is not a URL alone', () => {
    expect(normalizeResourceUrl('not a url')).toBe('not a url');
  });
});

describe('element matching: every level must be unique; otherwise INCONCLUSIVE', () => {
  it('matched by a stable attribute', () => {
    const base = [located('TEXT_CLIPPING', id({ attribute: 'p[id=promo]', path: 'main>p|x' }))];
    expect(matchElement(located('TEXT_CLIPPING', id({ attribute: 'p[id=promo]' })), base)).toEqual({
      status: 'matched',
      method: 'attribute',
    });
  });

  it('matched by the DOM path when the selector differs', () => {
    const base = [
      located('TEXT_CLIPPING', id({ path: 'main>p.note|hello', selector: 'p:nth-of-type(2)' })),
    ];
    const other = located(
      'TEXT_CLIPPING',
      id({ path: 'main>p.note|hello', selector: 'p:nth-of-type(3)' }),
    );
    expect(matchElement(other, base)).toEqual({ status: 'matched', method: 'path' });
  });

  it('two different counterparts at different levels: ambiguous, never picked arbitrarily', () => {
    const base = [
      located('TEXT_CLIPPING', id({ attribute: 'p[id=a]' })),
      located('TEXT_CLIPPING', id({ path: 'main>p|b' })),
    ];
    const other = located('TEXT_CLIPPING', id({ attribute: 'p[id=a]', path: 'main>p|b' }));
    expect(matchElement(other, base).status).toBe('ambiguous');
  });

  it('an element without a unique identity at any level: ambiguous', () => {
    expect(matchElement(located('TEXT_CLIPPING', id()), []).status).toBe('ambiguous');
    expect(matchElement(located('TEXT_CLIPPING', null), []).status).toBe('ambiguous');
  });

  it('a Chromium finding of the same check that cannot be identified: ambiguous, not absent', () => {
    const base = [located('TEXT_CLIPPING', id())];
    expect(matchElement(located('TEXT_CLIPPING', id({ attribute: 'p[id=x]' })), base).status).toBe(
      'ambiguous',
    );
  });

  it('identifiable and not in Chromium: absent', () => {
    const base = [located('BROKEN_IMAGE', id({ attribute: 'img[id=x]' }))];
    expect(matchElement(located('TEXT_CLIPPING', id({ attribute: 'p[id=x]' })), base)).toEqual({
      status: 'absent',
      method: 'attribute',
    });
  });
});

describe('classification', () => {
  it('errors: matched by script and line (not wording); third-party → OBSERVATION; no location → INCONCLUSIVE', () => {
    const base = facts({
      exceptions: [
        { message: 'x is undefined', source: 'https://shop.example/app.js?v=1', line: 10 },
      ],
    });
    const other = facts({
      exceptions: [
        {
          message: 'Cannot read x (different wording)',
          source: 'https://shop.example/app.js?v=2',
          line: 10,
        },
        { message: 'boom', source: 'https://shop.example/app.js', line: 42 },
        { message: 'widget', source: 'https://cdn.other.example/w.js', line: 1 },
        { message: 'Script error.', source: null, line: null },
      ],
    });
    expect(compareFacts(base, other, SITE).map((d) => [d.key, d.classification])).toEqual([
      ['error|https://shop.example/app.js:42', 'DETECTED'],
      ['error|https://cdn.other.example/w.js:1', 'OBSERVATION'],
      ['error|Script error.', 'INCONCLUSIVE'],
    ]);
  });

  it('resources: proxy refusals, network failures and failures in both are left out; 5xx/408/429 INCONCLUSIVE', () => {
    const base = facts({
      failedRequests: [request('https://shop.example/both.js?utm_source=a', 404)],
    });
    const other = facts({
      failedRequests: [
        request('http://10.0.0.1/internal.png', 403, true),
        request('https://shop.example/reset.js', null),
        request('https://shop.example/both.js?utm_source=b', 404),
        request('https://shop.example/busy.js', 503),
        request('https://shop.example/slow.js', 408),
        request('https://shop.example/limit.js', 429),
        request('https://shop.example/polyfill.js', 404),
        request('https://cdn.other.example/lib.js', 404),
      ],
    });
    expect(compareFacts(base, other, SITE).map((d) => [d.evidence.url, d.classification])).toEqual([
      ['https://shop.example/busy.js', 'INCONCLUSIVE'],
      ['https://shop.example/slow.js', 'INCONCLUSIVE'],
      ['https://shop.example/limit.js', 'INCONCLUSIVE'],
      ['https://shop.example/polyfill.js', 'DETECTED'],
      ['https://cdn.other.example/lib.js', 'OBSERVATION'],
    ]);
  });

  it('a query parameter that matters keeps two requests apart', () => {
    const base = facts({ failedRequests: [request('https://shop.example/img?format=avif', 404)] });
    const other = facts({ failedRequests: [request('https://shop.example/img?format=jxl', 404)] });
    expect(compareFacts(base, other, SITE)).toHaveLength(1);
  });

  it('fonts: failing only here → DETECTED, its file not reported again as a resource', () => {
    const font = {
      family: 'Brand',
      weight: '400',
      style: 'normal',
      sources: ['https://shop.example/brand.woff2'],
    };
    const base = facts({ fonts: [{ ...font, status: 'unloaded' }] });
    const other = facts({
      fonts: [{ ...font, status: 'error' }],
      failedRequests: [request('https://shop.example/brand.woff2', 404)],
    });
    expect(compareFacts(base, other, SITE).map((d) => [d.check, d.classification])).toEqual([
      ['BROWSER_ONLY_FONT_FAILURE', 'DETECTED'],
    ]);
    expect(compareFacts(facts({ fonts: [{ ...font, status: 'error' }] }), other, SITE)).toEqual([]);
  });

  it('located findings: objective → DETECTED, judgement → POTENTIAL_DEFECT, accessibility → OBSERVATION', () => {
    const other = facts({
      ui: [
        located('HORIZONTAL_SCROLL', id({ attribute: 'document' }), 'html'),
        located('TEXT_CLIPPING', id({ attribute: 'p[id=promo]' })),
        located('EMPTY_BUTTON', id({ attribute: 'button[aria-label=x]' }), 'button'),
      ],
      layout: [
        located('ICON_BROKEN', id({ attribute: 'i[id=cart]' })),
        located('ICON_MISSING', id({ attribute: 'i[id=menu]' })),
        located('TEXT_OVERLAP', id({ attribute: 'h2[id=t]' })),
      ],
      accessibility: [located('color-contrast', id({ attribute: 'a[id=more]' }))],
    });
    expect(
      compareFacts(facts(), other, SITE).map((d) => [d.check, d.underlying, d.classification]),
    ).toEqual([
      ['BROWSER_ONLY_LAYOUT', 'HORIZONTAL_SCROLL', 'DETECTED'],
      ['BROWSER_ONLY_LAYOUT', 'TEXT_CLIPPING', 'POTENTIAL_DEFECT'],
      ['BROWSER_ONLY_ACCESSIBILITY', 'EMPTY_BUTTON', 'DETECTED'],
      ['BROWSER_ONLY_LAYOUT', 'ICON_BROKEN', 'DETECTED'],
      ['BROWSER_ONLY_LAYOUT', 'ICON_MISSING', 'OBSERVATION'],
      ['BROWSER_ONLY_LAYOUT', 'TEXT_OVERLAP', 'POTENTIAL_DEFECT'],
      ['BROWSER_ONLY_ACCESSIBILITY', 'color-contrast', 'OBSERVATION'],
    ]);
  });

  it('a finding on the same element in both browsers is not a difference; an ambiguous one is INCONCLUSIVE', () => {
    const same = located('TEXT_CLIPPING', id({ attribute: 'p[id=promo]' }));
    expect(compareFacts(facts({ ui: [same] }), facts({ ui: [same] }), SITE)).toEqual([]);
    const ambiguous = compareFacts(facts(), facts({ ui: [located('TEXT_CLIPPING', id())] }), SITE);
    expect(ambiguous.map((d) => [d.classification, d.matchMethod])).toEqual([
      ['INCONCLUSIVE', null],
    ]);
  });

  it('CSS: only what the engine itself reports unsupported, as one OBSERVATION', () => {
    const other = facts({
      cssSupport: [
        { property: 'corner-shape', value: 'squircle', selector: '.card', supported: false },
        { property: 'color', value: 'red', selector: 'p', supported: true },
      ],
    });
    expect(
      compareFacts(facts(), other, SITE).map((d) => [d.check, d.classification, d.key]),
    ).toEqual([['UNSUPPORTED_CSS', 'OBSERVATION', 'css|corner-shape']]);
    // No verdicts (e.g. no stylesheet readable): nothing is claimed.
    expect(compareFacts(facts(), facts(), SITE)).toEqual([]);
  });
});

describe('confirmation by a second load', () => {
  const first = compareFacts(
    facts(),
    facts({ exceptions: [{ message: 'boom', source: 'https://shop.example/a.js', line: 3 }] }),
    SITE,
  );

  it('seen again: kept (the weaker of the two), with both loads as evidence', () => {
    const again = confirmDifferences(first, first);
    expect(again[0]).toMatchObject({ classification: 'DETECTED', evidence: { confirmed: true } });
    const weaker = confirmDifferences(first, [{ ...first[0]!, classification: 'OBSERVATION' }]);
    expect(weaker[0]!.classification).toBe('OBSERVATION');
  });

  it('not seen again, or no second load: INCONCLUSIVE with the reason', () => {
    expect(confirmDifferences(first, [])[0]).toMatchObject({
      classification: 'INCONCLUSIVE',
      evidence: {
        confirmed: false,
        why: 'not seen again when both browsers loaded the page a second time',
      },
    });
    expect(confirmDifferences(first, null)[0]!.evidence.why).toBe(
      'the second load could not be completed',
    );
  });
});

describe('issue drafts', () => {
  const [difference] = confirmDifferences(
    compareFacts(
      facts(),
      facts({ failedRequests: [request('https://shop.example/polyfill.js?utm_source=x', 404)] }),
      SITE,
    ),
    null,
  );
  const ctx = { websiteId: 'w1', pageUrl: 'https://shop.example/', viewport: '1920x1080' };
  const draft = (engine: 'FIREFOX' | 'WEBKIT') =>
    compatibilityDraft(difference!, ctx, {
      engine,
      version: engine === 'FIREFOX' ? 'Firefox 150.0' : 'WebKit 26.0',
      baselineVersion: 'Chromium 156.0',
    });

  it('an ordinary issue in the COMPATIBILITY category, classified by the comparison', () => {
    const d = draft('WEBKIT');
    expect(d).toMatchObject({
      category: 'COMPATIBILITY',
      ruleId: 'compat/browser-only-resource-failure',
      severity: 'INFO',
      title: 'Resource fails in one browser only: WebKit',
      details: {
        browser: 'WEBKIT',
        browserVersion: 'WebKit 26.0',
        baselineVersion: 'Chromium 156.0',
      },
    });
    expect(d.description).toContain('Chromium 156.0');
    expect(classifyDraft(d)).toBe('INCONCLUSIVE');
  });

  it('the fingerprint is per browser and stable across loads (tracking parameters ignored)', () => {
    expect(draft('FIREFOX').fingerprint).not.toBe(draft('WEBKIT').fingerprint);
    expect(draft('WEBKIT').fingerprint).toBe(draft('WEBKIT').fingerprint);
  });
});

describe('in-page facts (real browser)', () => {
  let browser: Browser;
  const bundle = loadDomChecksBundle();
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  async function open(html: string): Promise<Page> {
    const page = await browser.newPage();
    await page.route('http://site.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    );
    await page.goto('http://site.test/');
    await page.evaluate(bundle);
    return page;
  }

  it('identities: each level only when it identifies exactly one element', async () => {
    const page = await open(`<!doctype html><main>
      <p id="promo" class="note">Spring sale</p>
      <p class="note">Repeated</p><p class="note">Repeated</p>
      <a href="/cart?utm_source=x#top">Cart</a>
      <button name="go">Go</button><input name="q"><input name="q"></main>`);
    const ids = (await page.evaluate(
      `window.__whcDomChecks.compat.identities(${JSON.stringify([
        '#promo',
        'p:nth-of-type(2)',
        'a',
        'button',
        'input:nth-of-type(1)',
        'p',
        'body',
      ])})`,
    )) as ElementIdentity[];
    expect(ids[0]).toEqual({
      attribute: 'p[id=promo]',
      path: 'main>p.note|spring sale',
      selector: '#promo',
    });
    // Same path and text as its twin: no path identity, only the selector.
    expect(ids[1]).toEqual({ attribute: null, path: null, selector: 'p:nth-of-type(2)' });
    expect(ids[2]!.attribute).toBe('a[href=http://site.test/cart]');
    expect(ids[3]!.attribute).toBe('button[name=go]');
    expect(ids[4]!.attribute).toBeNull(); // two inputs share name="q"
    expect(ids[5]).toEqual({ attribute: null, path: null, selector: null }); // "p" matches 3
    expect(ids[6]).toEqual({ attribute: 'document', path: 'document', selector: 'document' });
    await page.close();
  });

  it('CSS in use: applied rules only, as written (shorthands kept), without custom, prefixed or @supports-guarded ones', async () => {
    const page = await open(`<!doctype html><style>
      .card { color: rgb(1, 2, 3) !important; --brand: red; -webkit-line-clamp: 2; }
      .card { font: 12px serif; background-image: url("a;b.png"); }
      .unused { margin-left: 7px; }
      @supports (display: grid) { .card { display: grid; } }
      @media (min-width: 1px) { .card { padding-top: 3px; } }
      </style><div class="card">Card</div>`);
    const used = (await page.evaluate('window.__whcDomChecks.compat.cssInUse()')) as {
      property: string;
      value: string;
    }[];
    // "font" stays one declaration: never its longhands (font-language-override, ...),
    // which the page did not write and another engine may not know.
    expect(used.map((d) => `${d.property}: ${d.value}`).sort()).toEqual([
      'background-image: url("a;b.png")',
      'color: rgb(1, 2, 3)',
      'font: 12px serif',
      'padding-top: 3px',
    ]);
    const verdicts = (await page.evaluate(
      `window.__whcDomChecks.compat.cssSupport(${JSON.stringify([
        { property: 'color', value: 'red', selector: 'p' },
        { property: 'made-up-property', value: '1', selector: 'p' },
      ])})`,
    )) as { supported: boolean }[];
    expect(verdicts.map((v) => v.supported)).toEqual([true, false]);
    await page.close();
  });
});
