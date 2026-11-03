import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type LaunchOptions,
} from 'playwright';
import { BLOCKED_RESPONSE_HEADER, type ViewportSpec } from './browser-types';
import type { ScannerConfig } from './config';

export const SCANNER_UA_SUFFIX =
  'WebsiteHealthChecker/0.1 (+automated accessibility and UI scanner)';

/** The browser engines the scanner can drive. Chromium is the scan's own browser. */
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

/**
 * Firefox's counterparts of the Chromium flags below (Phase 9, Milestone 3): close the
 * ways around the egress proxy and stop Firefox's own background connections.
 */
export const FIREFOX_HARDENING_PREFS: Record<string, string | number | boolean> = {
  // Send localhost / 127.0.0.1 to the proxy too (Firefox normally never proxies them).
  'network.proxy.allow_hijacking_localhost': true,
  'network.proxy.no_proxies_on': '',
  // No HTTP/3 (QUIC over UDP), no WebRTC (direct UDP), no DNS over HTTPS.
  'network.http.http3.enable': false,
  'media.peerconnection.enabled': false,
  'media.navigator.enabled': false,
  'network.trr.mode': 5,
  // No speculative or prefetch connections.
  'network.dns.disablePrefetch': true,
  'network.prefetch-next': false,
  'network.predictor.enabled': false,
  'network.http.speculative-parallel-limit': 0,
  // No background services that call home.
  'network.captive-portal-service.enabled': false,
  'network.connectivity-service.enabled': false,
  'browser.safebrowsing.malware.enabled': false,
  'browser.safebrowsing.phishing.enabled': false,
  'browser.safebrowsing.downloads.enabled': false,
  'browser.safebrowsing.downloads.remote.enabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'toolkit.telemetry.enabled': false,
  'app.update.enabled': false,
  'extensions.update.enabled': false,
};

/**
 * How each engine is launched. All traffic goes through the egress proxy (SSRF
 * protection), with every exception closed. Chromium:
 *   - "<-loopback>": also send localhost/127.0.0.1 to the proxy (Chrome normally skips the proxy for them)
 *   - --disable-quic: no HTTP/3 over UDP
 *   - WebRTC limited to proxied connections (no direct UDP)
 * Firefox: FIREFOX_HARDENING_PREFS. WebKit: the proxy without exceptions; its behaviour is
 * verified at launch (egressSelfCheck) and by the per-browser security tests, and the
 * scanner's container has no network route except the proxy.
 */
export function launchOptions(
  engine: BrowserEngine,
  config: Pick<ScannerConfig, 'headless' | 'browserChannel' | 'egressProxyUrl'>,
  extraArgs: string[] = [],
): LaunchOptions {
  if (engine === 'firefox') {
    return {
      headless: config.headless,
      timeout: 60_000,
      proxy: { server: config.egressProxyUrl, bypass: '' },
      firefoxUserPrefs: FIREFOX_HARDENING_PREFS,
    };
  }
  if (engine === 'webkit') {
    return {
      headless: config.headless,
      timeout: 60_000,
      proxy: { server: config.egressProxyUrl, bypass: '' },
    };
  }
  return {
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
      ...extraArgs,
    ],
  };
}

/**
 * Launches a fresh, isolated browser for ONE scan (Chromium unless another engine is
 * asked for). Closing it at the end (or on cancel) kills every tab and request it made,
 * so nothing leaks between scans.
 */
export async function launchScanBrowser(
  config: ScannerConfig,
  options: { extraArgs?: string[]; engine?: BrowserEngine; executablePath?: string } = {},
): Promise<Browser> {
  const engine = options.engine ?? 'chromium';
  const type = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
  return type.launch({
    ...launchOptions(engine, config, options.extraArgs),
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
}

/** Which engine a launched browser is. */
export function engineOf(browser: Browser): BrowserEngine {
  return browser.browserType().name() as BrowserEngine;
}

const cachedUserAgents = new Map<BrowserEngine, string>();

/** The engine's real user agent (without "HeadlessChrome") plus an honest scanner suffix. */
async function scannerUserAgent(browser: Browser): Promise<string> {
  const engine = engineOf(browser);
  const cached = cachedUserAgents.get(engine);
  if (cached) return cached;
  const context = await browser.newContext();
  const page = await context.newPage();
  const ua = await page.evaluate('navigator.userAgent');
  await context.close();
  const userAgent = `${String(ua).replace('HeadlessChrome', 'Chrome')} ${SCANNER_UA_SUFFIX}`;
  cachedUserAgents.set(engine, userAgent);
  return userAgent;
}

/**
 * The options of a scan context. Firefox cannot emulate mobile devices (isMobile,
 * hasTouch), so the caller must not ask it for mobile sizes (see compat-stage.ts).
 */
export function contextOptions(
  engine: BrowserEngine,
  viewport: ViewportSpec,
  userAgent: string,
): BrowserContextOptions {
  return {
    viewport: { width: viewport.width, height: viewport.height },
    ...(engine === 'firefox' ? {} : { isMobile: viewport.mobile, hasTouch: viewport.mobile }),
    deviceScaleFactor: 1,
    userAgent,
    acceptDownloads: false,
    serviceWorkers: 'block',
    ignoreHTTPSErrors: false,
    reducedMotion: 'reduce',
    locale: 'en-US',
  };
}

/** A browser context = an isolated profile (own cookies, storage, cache). */
export async function newScanContext(
  browser: Browser,
  viewport: ViewportSpec,
): Promise<BrowserContext> {
  const userAgent = await scannerUserAgent(browser);
  return browser.newContext(contextOptions(engineOf(browser), viewport, userAgent));
}

/** Private and reserved addresses the egress proxy must refuse, whatever the browser. */
export const SELF_CHECK_URLS = [
  'http://127.0.0.1/',
  'http://localhost/',
  'http://[::1]/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.255.255.1/',
];

/**
 * Proves that a launched browser really sends its requests through the egress proxy:
 * each private address must be answered by the proxy itself (its "blocked" header). A
 * browser that connects anywhere directly, or gets any other answer, fails, and must not
 * be used for the scan. Necessary, not sufficient: the per-browser security tests and the
 * container's network isolation are the other layers.
 */
export async function egressSelfCheck(
  browser: Browser,
  limitMs = 60_000,
): Promise<{ ok: boolean; failures: { url: string; reason: string }[] }> {
  const failures: { url: string; reason: string }[] = [];
  const check = async () => {
    const context = await browser.newContext(
      contextOptions(
        engineOf(browser),
        { label: 'check', name: 'check', width: 800, height: 600, mobile: false },
        SCANNER_UA_SUFFIX,
      ),
    );
    try {
      // One page for every address (each navigation replaces the last; closing pages one
      // by one could hang in some engines).
      const page = await context.newPage();
      for (const url of SELF_CHECK_URLS) {
        try {
          const response = await page.goto(url, { waitUntil: 'commit', timeout: 15_000 });
          if (!response) failures.push({ url, reason: 'no response' });
          else if (response.headers()[BLOCKED_RESPONSE_HEADER] !== '1') {
            failures.push({
              url,
              reason: `answered without the proxy (HTTP ${response.status()})`,
            });
          }
        } catch (error) {
          // The proxy always answers (it refuses with HTTP 403); a connection error means
          // the browser tried to connect by itself.
          failures.push({
            url,
            reason: `not answered by the proxy: ${(error as Error).message.split('\n')[0]}`,
          });
        }
      }
    } finally {
      await Promise.race([
        context.close().catch(() => {}),
        new Promise((done) => setTimeout(done, 5_000)),
      ]);
    }
  };
  // A check that does not finish counts as failed: the browser is then not used.
  let timer: NodeJS.Timeout | undefined;
  const finished = await Promise.race([
    check().then(() => true),
    new Promise<false>((done) => {
      timer = setTimeout(() => done(false), limitMs);
    }),
  ]);
  clearTimeout(timer);
  if (!finished)
    failures.push({ url: '(all)', reason: `the check did not finish within ${limitMs / 1000} s` });
  return { ok: failures.length === 0, failures };
}
