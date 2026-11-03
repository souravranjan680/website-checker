/**
 * Phase 9, Milestone 3 (Checkpoint 1): network isolation, tested separately for each
 * browser engine with the real launcher (launchScanBrowser) and the egress proxy:
 *   - the launch self-check passes (every private address answered by the proxy);
 *   - direct navigation to private addresses is refused by the proxy;
 *   - a page that tries every way to reach a private address (image, iframe, stylesheet,
 *     prefetch, fetch, XHR, beacon, WebSocket, WebRTC, redirect) reaches nothing: the
 *     fixture server's /secret counter and WebSocket counter stay at 0.
 * An engine that is not installed here is skipped (Firefox and WebKit are installed in
 * the scanner's Docker image; see docker/scanner-test.Dockerfile).
 */
import { existsSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  egressSelfCheck,
  launchScanBrowser,
  newScanContext,
  type BrowserEngine,
} from '../src/browser';
import { BLOCKED_RESPONSE_HEADER, SCAN_VIEWPORTS } from '../src/browser-types';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import { startTestProxy, testScannerConfig } from './helpers';

let fixtures: FixtureServer;
let proxy: Awaited<ReturnType<typeof startTestProxy>>;
beforeAll(async () => {
  fixtures = await startFixtureServer();
  proxy = await startTestProxy();
});
afterAll(async () => {
  await fixtures.close();
  await proxy.close();
});

const TYPES = { chromium, firefox, webkit };
function installed(engine: BrowserEngine): boolean {
  try {
    return existsSync(TYPES[engine].executablePath());
  } catch {
    return false;
  }
}

describe.each(['chromium', 'firefox', 'webkit'] as const)('%s', (engine) => {
  const available = installed(engine);
  const launch = () => launchScanBrowser(testScannerConfig(proxy.url), { engine });

  it.runIf(!available)(`is not installed here (its checks run in the Docker test image)`, () => {
    expect(available).toBe(false);
  });

  it.runIf(available)(
    'passes the egress self-check at launch',
    async () => {
      const browser = await launch();
      try {
        expect(await egressSelfCheck(browser)).toEqual({ ok: true, failures: [] });
      } finally {
        await browser.close();
      }
    },
    // Five addresses, up to 15 s each in the worst case, plus a cold browser start.
    120_000,
  );

  it.runIf(available)(
    'direct navigation to private addresses is refused by the proxy',
    async () => {
      const browser = await launch();
      const before = fixtures.secretHits();
      try {
        const context = await newScanContext(browser, SCAN_VIEWPORTS[0]!);
        const page = await context.newPage();
        for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
          const response = await page.goto(`http://${host}:${fixtures.port}/secret`, {
            waitUntil: 'commit',
          });
          expect(response?.headers()[BLOCKED_RESPONSE_HEADER], host).toBe('1');
        }
        await context.close();
      } finally {
        await browser.close();
      }
      expect(fixtures.secretHits() - before).toBe(0);
    },
    60_000,
  );

  it.runIf(available)(
    'a page trying every way to reach a private address reaches nothing',
    async () => {
      const browser = await launch();
      fixtures.resetSafetyHits();
      const before = fixtures.secretHits();
      let webrtc: string;
      try {
        const context = await newScanContext(browser, SCAN_VIEWPORTS[0]!);
        const page = await context.newPage();
        await page.goto(fixtures.url('/ssrf/'), { waitUntil: 'load' });
        webrtc = await page.locator('#webrtc').innerText();
        // Wait for the delayed redirect and anything still in flight.
        await page.waitForTimeout(2_500);
        await context.close();
      } finally {
        await browser.close();
      }
      expect(fixtures.secretHits() - before).toBe(0);
      expect(fixtures.safetyHits().websockets).toEqual([]);
      if (engine === 'firefox') expect(webrtc).toBe('unavailable'); // switched off by our prefs
    },
    60_000,
  );
});
