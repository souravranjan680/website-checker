/**
 * End-to-end: a real Chromium with the unpacked extension loaded, on the fixture
 * websites. Also the parity test: the extension and the server scanner must find the
 * same rule IDs on the same page, because they run the same shared checks.
 *
 * Playwright cannot click the toolbar icon (what grants activeTab), so these tests
 * load the TEST build (dist-test), which may access http://127.0.0.1 only, and open
 * the popup as a page with ?tabId=<tab to check>. One test loads the PRODUCTION build
 * (dist-keyed: production manifest + key) to prove it cannot read any page without that click.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTRA_CHECKS, uiRuleId } from '@whc/dom-checks';
import { loadDomChecksBundle } from '@whc/scanner/dom';
import { scanPage } from '@whc/scanner/scan-page';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../../scanner/test/fixture-server';

const root = path.resolve(import.meta.dirname, '..');
const testBuild = path.join(root, 'dist-test');
const extensionId = readFileSync(path.join(testBuild, 'extension-id.txt'), 'utf8').trim();
const DESKTOP = { width: 1920, height: 1080 };

let fixtures: FixtureServer;
let local: (pathname: string) => string;
const profiles: string[] = [];

async function launchWithExtension(dir: string): Promise<BrowserContext> {
  const profile = mkdtempSync(path.join(tmpdir(), 'whc-ext-'));
  profiles.push(profile);
  return chromium.launchPersistentContext(profile, {
    // The full Chromium build (new headless mode) supports extensions.
    channel: 'chromium',
    headless: true,
    viewport: DESKTOP,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
}

/** Opens the popup as a page, aimed at the tab showing `url`. */
async function openPopup(context: BrowserContext, url: string, id = extensionId): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  // The newest tab showing that address (earlier tests may have left others open).
  const tabId = await popup.evaluate(async (target) => {
    const tabs = (await chrome.tabs.query({})).filter((t) => t.url === target);
    return Math.max(...tabs.map((t) => t.id!));
  }, url);
  await popup.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
  return popup;
}

async function checkWithExtension(context: BrowserContext, url: string) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const popup = await openPopup(context, url);
  const acknowledge = popup.getByRole('button', { name: 'I understand' });
  if (await acknowledge.isVisible().catch(() => false)) await acknowledge.click();
  const started = Date.now();
  await popup.getByRole('button', { name: /Check this page|Check again/ }).click();
  await popup.getByTestId('local-note').waitFor({ timeout: 60_000 });
  const seconds = (Date.now() - started) / 1000;
  const ruleIds = await popup
    .locator('[data-rule-id]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-rule-id')!));
  return { page, popup, ruleIds: new Set(ruleIds), seconds };
}

/** The server scanner's own page scan (same code path as a real scan, no database). */
async function checkWithScanner(url: string): Promise<Set<string>> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: DESKTOP,
      reducedMotion: 'reduce',
      locale: 'en-US',
    });
    const page = await context.newPage();
    const result = await scanPage({
      page,
      url,
      viewport: { label: '1920x1080', name: 'Desktop', ...DESKTOP, mobile: false },
      websiteId: 'parity',
      siteHostname: '127.0.0.1',
      navTimeoutMs: 30_000,
      domBundle: loadDomChecksBundle(),
      cropBudget: { remaining: 0 },
      extraCropBudget: { remaining: 0 },
      consistency: false,
      alreadyScanned: () => false,
      probe: null,
      logger: pino({ level: 'silent' }),
    });
    expect(result.outcome).toBe('DONE');
    // Page-content checks only: network, console and link checks need the server
    // (the extension cannot see them without extra permissions).
    const serverOnly = /^ui\/(failed-|console-error|js-error|broken-link)/;
    // The Milestone 2 checks (Phase 9) run in the scanner only, by design.
    const scannerOnly = new Set<string>(EXTRA_CHECKS.map(uiRuleId));
    return new Set(
      result.drafts
        .map((d) => d.ruleId)
        .filter((id) => !serverOnly.test(id) && !scannerOnly.has(id)),
    );
  } finally {
    await browser.close();
  }
}

beforeAll(async () => {
  fixtures = await startFixtureServer();
  local = (pathname) => `http://127.0.0.1:${fixtures.port}${pathname}`;
});
afterAll(async () => {
  await fixtures.close();
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
});

describe('scanner ↔ extension parity (same rule IDs on identical fixture pages)', () => {
  let context: BrowserContext;
  beforeAll(async () => {
    context = await launchWithExtension(testBuild);
  });
  afterAll(async () => context.close());

  it.each(['/a11y/', '/a11y/page2.html', '/ui/', '/clean/', '/extension/'])(
    '%s',
    async (pathname) => {
      const url = local(pathname);
      const [extension, scanner] = await Promise.all([
        checkWithExtension(context, url),
        checkWithScanner(url),
      ]);
      expect([...extension.ruleIds].sort()).toEqual([...scanner].sort());
      if (pathname !== '/clean/') expect(extension.ruleIds.size).toBeGreaterThan(0);
    },
  );
});

describe('extension in Chromium (test build)', () => {
  let context: BrowserContext;
  const requests: string[] = [];
  beforeAll(async () => {
    context = await launchWithExtension(testBuild);
    context.on('request', (request) => requests.push(request.url()));
    // The hand-off must open the dashboard; answer it locally instead of a real server.
    await context.route('http://localhost:8081/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<title>Dashboard stub</title>',
      }),
    );
  });
  afterAll(async () => context.close());

  it('shows the authorization notice on first use and checks nothing before it is acknowledged', async () => {
    const page = await context.newPage();
    await page.goto(local('/extension/'));
    const popup = await openPopup(context, local('/extension/'));
    await expect(
      popup.getByText('Only check websites you own or are authorized to test'),
    ).toBeTruthy();
    expect(await popup.getByRole('button', { name: 'Check this page' }).isDisabled()).toBe(true);
    expect(await page.locator('#__whc-extension-highlight').count()).toBe(0);
    await popup.getByRole('button', { name: 'I understand' }).click();
    // Still visible during this first use.
    expect(
      await popup.getByText('Only check websites you own or are authorized to test').isVisible(),
    ).toBe(true);
    await popup.close();
    await page.close();
  });

  it('checks a page with a cross-origin frame, skips the frame and says so', async () => {
    const { popup, ruleIds, seconds } = await checkWithExtension(context, local('/extension/'));
    expect(ruleIds).toContain('image-alt');
    expect(ruleIds).toContain('ui/broken-image');
    expect(await popup.getByTestId('frames-note').innerText()).toContain(
      '1 embedded frame was not checked (1 from other websites)',
    );
    expect(await popup.getByTestId('local-note').innerText()).toMatch(
      /Local check, not saved\..*not an official scan/s,
    );
    expect(seconds).toBeLessThan(20); // a frame from another site must not stall axe
  });

  it('highlights an element on the page, and clears it', async () => {
    const { page, popup } = await checkWithExtension(context, local('/extension/'));
    await popup.locator('[data-rule-id="link-name"] > button').first().click();
    await popup.getByRole('button', { name: 'Highlight on page' }).click();
    const highlight = page.locator('#__whc-extension-highlight');
    await highlight.waitFor({ state: 'attached' });
    // The link sits below 1600px of text: the page scrolled to it.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await popup.getByRole('button', { name: 'Clear highlight' }).click();
    await expect.poll(() => highlight.count()).toBe(0);
  });

  it('copies issue details as Markdown', async () => {
    const { popup } = await checkWithExtension(context, local('/extension/'));
    // Playwright cannot grant clipboard-read to an extension page, so record what the
    // popup hands to the Clipboard API (the real call still happens).
    await popup.evaluate(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text: string) => {
        w.__copied.push(text);
        return original(text);
      };
    });
    await popup.locator('[data-rule-id="image-alt"] > button').first().click();
    await popup.getByRole('button', { name: 'Copy details' }).click();
    await expect
      .poll(() => popup.getByRole('status').innerText())
      .toBe('Issue details copied as Markdown.');
    const copied = await popup.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied[0] ?? '',
    );
    expect(copied).toContain('### Images must have alternative text');
    expect(copied).toContain(`- **Page:** ${local('/extension/')}`);
    expect(copied).toContain('**WCAG:** 1.1.1 (level A)');
    expect(copied).toMatch(/not a saved scan/);
  });

  it('sends nothing anywhere: only the checked site is contacted until "Open in dashboard"', async () => {
    const fixtureOrigins = [
      `http://127.0.0.1:${fixtures.port}`,
      `http://localhost:${fixtures.port}`,
    ];
    const elsewhere = requests.filter(
      (url) =>
        !url.startsWith('chrome-extension://') &&
        !fixtureOrigins.some((o) => url.startsWith(`${o}/`)),
    );
    expect(elsewhere).toEqual([]);
  });

  it('opens the dashboard with the page address (query and fragment removed)', async () => {
    const { popup } = await checkWithExtension(context, local('/extension/?session=secret#part'));
    const [dashboard] = await Promise.all([
      context.waitForEvent('page'),
      popup.getByRole('button', { name: 'Open in dashboard' }).click(),
    ]);
    await dashboard.waitForLoadState();
    const opened = new URL(dashboard.url());
    expect(opened.origin + opened.pathname).toBe('http://localhost:8081/websites/new');
    expect(opened.searchParams.get('baseUrl')).toBe(local('/extension/'));
    expect(dashboard.url()).not.toContain('secret');
  });

  it('explains browser pages it cannot check', async () => {
    const page = await context.newPage();
    await page.goto('chrome://version');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabId = await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find(
        (t) => !t.url?.startsWith('chrome-extension://') && !t.url?.startsWith('http'),
      )?.id;
    });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    expect(await popup.getByRole('alert').innerText()).toMatch(
      /cannot be checked|can never be checked/,
    );
    expect(await popup.getByRole('button', { name: 'Check this page' }).count()).toBe(0);
  });
});

describe('production build (dist): no access without clicking the toolbar icon', () => {
  it('cannot read or check a page it was not given', async () => {
    // dist-keyed = the production manifest plus a key (asserted in manifest.test.ts).
    const productionDir = path.join(root, 'dist-keyed');
    const context = await launchWithExtension(productionDir);
    try {
      const page = await context.newPage();
      await page.goto(local('/a11y/'));
      const id = readFileSync(path.join(root, 'dist-keyed', 'extension-id.txt'), 'utf8').trim();
      // Chrome hides the address of tabs the extension may not access, so pick the
      // page tab by ID (the newest tab without a visible address).
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      const tabId = await popup.evaluate(async () => {
        const hidden = (await chrome.tabs.query({})).filter((t) => !t.url);
        return Math.max(...hidden.map((t) => t.id!));
      });
      await popup.goto(`chrome-extension://${id}/popup.html?tabId=${tabId}`);
      await popup.getByRole('button', { name: 'I understand' }).click();
      // Without activeTab Chrome hides the tab's address and refuses scripting.
      expect(await popup.getByRole('alert').innerText()).toMatch(
        /has not given the extension access/,
      );
      const injected = await popup.evaluate(async (target) => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: target },
            func: () => document.title,
          });
          return 'injected';
        } catch (error) {
          return (error as Error).message;
        }
      }, tabId);
      expect(injected).not.toBe('injected');
    } finally {
      await context.close();
    }
  });
});
