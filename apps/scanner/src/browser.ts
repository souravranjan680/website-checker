import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { ViewportSpec } from './browser-types';
import type { ScannerConfig } from './config';

export const SCANNER_UA_SUFFIX =
  'WebsiteHealthChecker/0.1 (+automated accessibility and UI scanner)';

/**
 * Launches a fresh, isolated Chromium for ONE scan. Closing it at the end (or on
 * cancel) kills every tab and request it made, so nothing leaks between scans.
 *
 * All traffic goes through the egress proxy (SSRF protection). Escape routes that
 * could bypass a proxy are closed:
 *   - "<-loopback>": also send localhost/127.0.0.1 to the proxy (Chrome normally skips the proxy for them)
 *   - --disable-quic: no HTTP/3 over UDP
 *   - WebRTC limited to proxied connections (no direct UDP)
 */
export async function launchScanBrowser(
  config: ScannerConfig,
  options: { extraArgs?: string[] } = {},
): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    channel: config.browserChannel,
    timeout: 60_000,
    proxy: { server: config.egressProxyUrl, bypass: '<-loopback>' },
    args: [
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      ...(options.extraArgs ?? []),
    ],
  });
}

let cachedUserAgent: string | null = null;

/** Real Chrome user agent (without "HeadlessChrome") plus an honest scanner suffix. */
async function scannerUserAgent(browser: Browser): Promise<string> {
  if (cachedUserAgent) return cachedUserAgent;
  const context = await browser.newContext();
  const page = await context.newPage();
  const ua = await page.evaluate('navigator.userAgent');
  await context.close();
  cachedUserAgent = `${String(ua).replace('HeadlessChrome', 'Chrome')} ${SCANNER_UA_SUFFIX}`;
  return cachedUserAgent;
}

/** A browser context = an isolated profile (own cookies, storage, cache). */
export async function newScanContext(
  browser: Browser,
  viewport: ViewportSpec,
): Promise<BrowserContext> {
  const userAgent = await scannerUserAgent(browser);
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    deviceScaleFactor: 1,
    userAgent,
    acceptDownloads: false,
    serviceWorkers: 'block',
    ignoreHTTPSErrors: false,
    reducedMotion: 'reduce',
    locale: 'en-US',
  });
}
