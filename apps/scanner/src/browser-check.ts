/**
 * Operator check (Phase 9, Milestone 3): can this server run the other browsers safely?
 *   node dist/browser-check.js
 * For each engine: is it installed and does it start (version), and does it pass the
 * egress self-check (every private address answered by the proxy)? And, for the whole
 * host: can anything reach the internet WITHOUT the proxy? (It must not: the scanner's
 * network only leads to the egress proxy.) Prints JSON; exit code 1 if anything is unsafe.
 * Loads no website; changes nothing.
 */
import net from 'node:net';
import { egressSelfCheck, launchScanBrowser, type BrowserEngine } from './browser';
import { loadScannerConfig } from './config';

async function directConnection(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 5_000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve('CONNECTED (not isolated)');
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve('blocked (timeout)');
    });
    socket.once('error', (error) =>
      resolve(`blocked (${(error as NodeJS.ErrnoException).code ?? error.message})`),
    );
  });
}

const config = loadScannerConfig();
const engines: BrowserEngine[] = ['chromium', 'firefox', 'webkit'];
const result: Record<string, unknown> = { egressProxy: config.egressProxyUrl, browsers: {} };
let unsafe = false;

for (const engine of engines) {
  const entry: Record<string, unknown> = {
    allowedForCrossBrowser:
      engine === 'chromium' ? 'scan browser' : config.compatBrowsers.includes(engine),
  };
  try {
    const browser = await launchScanBrowser(config, { engine });
    entry.version = browser.version();
    const check = await egressSelfCheck(browser);
    entry.selfCheck = check.ok ? 'passed' : check.failures;
    if (!check.ok) unsafe = true;
    await browser.close();
  } catch (error) {
    entry.available = false;
    entry.error = (error as Error).message.split('\n')[0];
  }
  (result.browsers as Record<string, unknown>)[engine] = entry;
}

result.directInternetWithoutProxy = {
  'example.com:80': await directConnection('example.com', 80),
  '1.1.1.1:443': await directConnection('1.1.1.1', 443),
};
if (
  Object.values(result.directInternetWithoutProxy as object).some((v) =>
    String(v).startsWith('CONNECTED'),
  )
) {
  unsafe = true;
}
result.safe = !unsafe;
console.log(JSON.stringify(result, null, 2));
process.exit(unsafe ? 1 : 0);
