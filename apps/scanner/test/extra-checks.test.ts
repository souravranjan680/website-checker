/**
 * Phase 9, Milestone 2 (Checkpoint 1) in a real browser, for cases a fixture site
 * cannot produce reliably: a web font that is still loading (font-display: optional),
 * the side-effect watch used by the probes of Checkpoint 2, and layout rules on
 * clipped text and on one subtree only. Pages are served by request routing.
 */
import type { ExtraResult, SideEffectReport } from '@whc/dom-checks';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDomChecksBundle } from '../src/checks/dom';

let browser: Browser;
const bundle = loadDomChecksBundle();
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** Opens `html` at http://site.test/ ; fonts under /fonts/ never answer (still loading). */
async function open(html: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://site.test/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/fonts/')) return; // never answered: the face stays "loading"
    await route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  await page.goto('http://site.test/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(bundle);
  return page;
}
const extra = (page: Page, options: object, root = 'document.body') =>
  page.evaluate(
    `window.__whcDomChecks.extra(${JSON.stringify(options)}, ${root})`,
  ) as Promise<ExtraResult>;

describe('fonts that have not loaded', () => {
  const page = (display: string) => `<!doctype html><style>
    @font-face { font-family: Slow; src: url(/fonts/slow.woff2) format('woff2'); font-display: ${display}; }
    p { font-family: Slow, Georgia, serif; }</style><p>Quiet design</p>`;

  it('font-display: optional — the fallback is accepted on purpose: not reported', async () => {
    const p = await open(page('optional'));
    const result = await extra(p, { fonts: true });
    expect(result.fonts.map((f) => [f.family, f.status])).toEqual([['Slow', 'loading']]);
    expect(result.fallbacks).toEqual([]);
    await p.close();
  }, 20_000);

  it('any other display — the text is shown in a fallback font: reported', async () => {
    const p = await open(page('swap'));
    const result = await extra(p, { fonts: true });
    expect(result.fallbacks.map((f) => [f.family, f.elements])).toEqual([['Slow', 1]]);
    await p.close();
  }, 20_000);

  it('a unicode-range subset that the text does not need is never a fallback problem', async () => {
    const p = await open(`<!doctype html><style>
      @font-face { font-family: Sub; src: url(/fonts/cyr.woff2); unicode-range: U+0400-04FF; }
      p { font-family: Sub, Georgia, serif; }</style><p>Latin text only</p>`);
    const result = await extra(p, { fonts: true });
    expect(result.fallbacks).toEqual([]);
    await p.close();
  }, 20_000);
});

describe('layout rules', () => {
  it('clamped text that is not painted never counts as overlapping', async () => {
    const p = await open(`<!doctype html><style>body{margin:20px;font:16px/20px sans-serif}
      .clamp{width:200px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      h3{margin:0;font:16px/20px sans-serif}</style>
      <p class="clamp">One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen</p>
      <h3>Next heading</h3>`);
    const result = await extra(p, { layout: true });
    expect(result.findings).toEqual([]);
    await p.close();
  });

  it('checks only the given subtree (opened menus and panels)', async () => {
    const p = await open(`<!doctype html><style>body{font:16px/20px sans-serif} p{margin:0}
      .box{width:200px;height:20px}.tight{position:relative;top:-18px}</style>
      <div id="outside"><p class="box">Overlapping words here</p><p class="tight">Another line of text</p></div>
      <div id="layer"><p>Fine</p></div>`);
    expect((await extra(p, { layout: true })).findings.map((f) => f.check)).toContain(
      'TEXT_OVERLAP',
    );
    expect((await extra(p, { layout: true }, `document.getElementById('layer')`)).findings).toEqual(
      [],
    );
    await p.close();
  });
});

describe('side-effect watch (for the keyboard and form probes)', () => {
  it('tells changes inside the probed component from announcements, ambient, background and unrelated changes', async () => {
    const p = await open(`<!doctype html>
      <div class="field"><label for="email">Email</label><input id="email" aria-describedby="email-hint" /><span class="msg"></span></div>
      <p id="email-hint">We never share it.</p>
      <div id="other"><label for="name">Name</label><input id="name" /></div>
      <div role="status" id="live"></div>
      <span id="clock">0</span>
      <div id="banner">Welcome</div>
      <script>
        let n = 0; setInterval(() => { document.getElementById('clock').textContent = String(++n); }, 30);
        const email = document.getElementById('email');
        email.addEventListener('focus', () => document.body.classList.add('using-keyboard'));
        email.addEventListener('blur', () => {
          document.querySelector('.field .msg').textContent = 'Please enter an email.';
          document.getElementById('email-hint').setAttribute('data-state', 'error');
          document.getElementById('live').textContent = '1 error';
          document.getElementById('banner').textContent = 'Saved draft';
        });
      </script>`);
    await p.evaluate(`window.__whcDomChecks.sideEffects.startBaseline()`);
    await p.waitForTimeout(200);
    const background = await p.evaluate(`window.__whcDomChecks.sideEffects.stopBaseline()`);
    expect(background).toBeGreaterThan(0); // the clock
    await p.evaluate(`window.__whcDomChecks.sideEffects.start(document.getElementById('email'))`);
    await p.focus('#email');
    await p.evaluate(`document.getElementById('email').blur()`);
    await p.waitForTimeout(100);
    const report = (await p.evaluate(
      `window.__whcDomChecks.sideEffects.stop()`,
    )) as SideEffectReport;
    expect(report.counts.expected).toBeGreaterThanOrEqual(2); // message + hint
    expect(report.counts.announcement).toBeGreaterThanOrEqual(1);
    expect(report.counts.ambient).toBeGreaterThanOrEqual(1);
    expect(report.counts.background).toBeGreaterThanOrEqual(1);
    expect(report.unrelated.map((u) => u.selector)).toEqual(['#banner']);
    await p.close();
  });

  it('a component wrapper stops at the first ancestor that holds another control', async () => {
    const p = await open(
      `<!doctype html><form id="f"><div id="w1"><input id="a" /></div><div id="w2"><input id="b" /></div></form>`,
    );
    const area = (await p.evaluate(
      `window.__whcDomChecks.sideEffects.componentArea(document.getElementById('a')).map((e) => e.id)`,
    )) as string[];
    expect(area).toEqual(['a', 'w1']);
    await p.close();
  });
});

describe('side-effect watch: several elements and whole areas (Checkpoint 2 probes)', () => {
  it('counts changes in any watched element, in a given area, and in elements added at the end', async () => {
    const p = await open(`<!doctype html>
      <form id="f"><p id="summary"></p><input id="a" /><input id="b" /></form>
      <div id="elsewhere"></div><div id="later"><button id="c">C</button></div>`);
    await p.evaluate(
      `window.__whcDomChecks.sideEffects.start([document.getElementById('a')], [document.getElementById('f')])`,
    );
    await p.evaluate(`document.getElementById('summary').textContent = '1 error'`); // in the form
    await p.evaluate(`document.getElementById('c').setAttribute('data-state', 'focused')`); // added at stop
    await p.evaluate(`document.getElementById('elsewhere').textContent = 'saved'`); // unrelated
    const report = (await p.evaluate(
      `window.__whcDomChecks.sideEffects.stop([document.getElementById('c')])`,
    )) as SideEffectReport;
    expect(report.counts.expected).toBe(2);
    expect(report.unrelated.map((u) => u.selector)).toEqual(['#elsewhere']);
    await p.close();
  });
});
