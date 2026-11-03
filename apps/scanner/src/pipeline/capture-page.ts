import {
  unnamedControlSelectors,
  type AxeOutput,
  type Box,
  type DomCheckResult,
} from '@whc/dom-checks';
import { EGRESS_REASON_HEADER } from '@whc/shared';
import type { Page } from 'playwright';
import type { Classification } from '../audits/resource-check';
import { parseSetCookie, type CookieFacts } from '../audits/security';
import { BLOCKED_RESPONSE_HEADER } from '../browser-types';
import { axeSelector, boxesFor, runAxe } from '../checks/axe';
import type { PageNetworkLog } from '../checks/collectors';
import { classifyPageConsole } from '../checks/console-classify';
import { runDomChecksInPage } from '../checks/dom';
import { verifyPageResources, type ProbeFn } from '../checks/verify-resources';
import { isSameSite, normalizeUrl } from '../crawler/urls';
import {
  axeToDrafts,
  consoleToDrafts,
  domToDrafts,
  networkToDrafts,
  type IssueContext,
  type IssueDraft,
} from '../issues';
import type { Logger } from '../logger';

/**
 * Everything the scanner learned about one page at one screen size, before any
 * issue is created. The health scan turns it into issues (analyzePage); the
 * website comparison (Phase 9) compares two of them.
 */
export interface PageCapture {
  outcome: 'DONE' | 'FAILED' | 'SKIPPED';
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  loadTimeMs: number | null;
  errorMessage: string | null;
  responseHeaders: Record<string, string> | null;
  /** Set-Cookie attributes of the main document (names and flags only, never values). */
  cookies: CookieFacts[];
  /** Console, exceptions and failed requests (failed requests carry re-check verdicts). */
  network: PageNetworkLog;
  /** Only when outcome is DONE. */
  axe: AxeOutput | null;
  /** Page-coordinate boxes of the elements axe reported. */
  axeBoxes: Map<string, Box | null>;
  dom: DomCheckResult | null;
  /** Re-check verdict per image the DOM check found broken. */
  imageVerdicts: Map<string, Classification>;
}

/** Turns Playwright/Chromium navigation errors into messages a user can act on. */
export function describeNavigationError(error: unknown, timeoutMs: number): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timeout/i.test(message))
    return `The page did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`;
  if (message.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
    return 'Could not connect. The address does not exist, is unreachable, or points to a private/internal network (blocked for security).';
  }
  if (message.includes('ERR_NAME_NOT_RESOLVED')) return 'The domain name could not be found.';
  if (message.includes('ERR_CONNECTION_REFUSED')) return 'The server refused the connection.';
  if (message.includes('ERR_CERT') || message.includes('SSL'))
    return "The site's HTTPS certificate is not valid.";
  if (message.includes('ERR_TOO_MANY_REDIRECTS')) return 'The page redirects in a loop.';
  return 'The page could not be loaded.';
}

/**
 * Loads one page and collects the facts:
 *   1. navigate (wait for "load", then briefly for network quiet: JS-heavy pages)
 *   2. axe-core accessibility rules
 *   3. DOM/UI checks (layout, broken images, empty controls) + page snapshot
 *   4. failed resources re-checked through the egress proxy
 * The caller attaches the collectors (attachCollectors) before calling, and
 * detaches them when it is done with the page.
 */
export async function capturePage(params: {
  page: Page;
  url: string;
  log: PageNetworkLog;
  siteHostname: string;
  navTimeoutMs: number;
  domBundle: string;
  alreadyScanned: (normalizedUrl: string) => boolean;
  /** Re-checks a failed resource through the egress proxy; null = no re-checks. */
  probe: ProbeFn | null;
  logger: Logger;
}): Promise<PageCapture> {
  const { page, url, logger } = params;
  const capture: PageCapture = {
    outcome: 'FAILED',
    finalUrl: url,
    httpStatus: null,
    contentType: null,
    loadTimeMs: null,
    errorMessage: null,
    responseHeaders: null,
    cookies: [],
    network: params.log,
    axe: null,
    axeBoxes: new Map(),
    dom: null,
    imageVerdicts: new Map(),
  };

  const started = Date.now();
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: params.navTimeoutMs });
  } catch (error) {
    logger.info({ url, err: (error as Error).message }, 'navigation failed');
    capture.errorMessage = describeNavigationError(error, params.navTimeoutMs);
    return capture;
  }
  if (!response) {
    capture.errorMessage = 'The page returned no response.';
    return capture;
  }

  const headers = response.headers();
  capture.finalUrl = page.url();
  capture.httpStatus = response.status();
  capture.contentType = headers['content-type'] ?? null;
  // Never store cookie values (they can be session tokens); the flags are kept below.
  capture.responseHeaders = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'set-cookie'),
  );
  // headersArray keeps each Set-Cookie separate; only the name and flags are kept.
  capture.cookies = (await response.headersArray())
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => parseSetCookie(h.value))
    .filter((c): c is CookieFacts => c !== null)
    .slice(0, 50);

  if (headers[BLOCKED_RESPONSE_HEADER] === '1') {
    const reason = headers[EGRESS_REASON_HEADER];
    capture.errorMessage =
      reason === 'policy' || (!reason && response.status() === 403)
        ? 'Blocked by the security proxy: this address (or a redirect it followed) points to a private or internal network.'
        : reason === 'dns-not-found'
          ? 'The domain name does not exist.'
          : reason === 'dns-error'
            ? 'The domain name could not be looked up (temporary DNS failure).'
            : 'The site could not be reached.';
    return capture;
  }
  const skip = (message: string) => {
    capture.outcome = 'SKIPPED';
    capture.errorMessage = message;
    return capture;
  };
  if (!isSameSite(capture.finalUrl, params.siteHostname)) {
    return skip(
      `Redirects to another website (${new URL(capture.finalUrl).hostname}); not scanned.`,
    );
  }
  const finalNormalized = normalizeUrl(capture.finalUrl);
  if (
    finalNormalized &&
    finalNormalized !== normalizeUrl(url) &&
    params.alreadyScanned(finalNormalized)
  ) {
    return skip(`Redirects to ${capture.finalUrl}, which was already scanned.`);
  }
  if (response.status() >= 400) return skip(`The server answered HTTP ${response.status()}.`);
  if (!(capture.contentType ?? '').includes('html')) return skip('Not an HTML page.');

  // JavaScript-heavy pages keep loading after "load"; give them a few seconds.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  capture.loadTimeMs =
    ((await page
      .evaluate(
        `(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? Math.round(n.loadEventEnd || n.duration) : null; })()`,
      )
      .catch(() => null)) as number | null) ?? Date.now() - started;

  // 1) accessibility
  capture.axe = await runAxe(page);
  const axeSelectors = [
    ...new Set(
      [...capture.axe.violations, ...capture.axe.incomplete]
        .flatMap((rule) => rule.nodes.map((node) => axeSelector(node.target)))
        .filter((s): s is string => Boolean(s)),
    ),
  ];
  const boxList = await boxesFor(page, axeSelectors.slice(0, 300));
  capture.axeBoxes = new Map(axeSelectors.slice(0, 300).map((s, i) => [s, boxList[i] ?? null]));

  // 2) UI checks inside the page. Elements axe already reported as unnamed
  //    controls are not reported again by the UI checks.
  capture.dom = await runDomChecksInPage(page, params.domBundle, {
    mode: 'all',
    skipSelectors: unnamedControlSelectors(capture.axe),
  });

  // 3) re-check failed resources (verdicts are stored on the failed requests)
  capture.imageVerdicts = await verifyPageResources(params.log, capture.dom.findings, params.probe);

  capture.outcome = 'DONE';
  return capture;
}

/**
 * Turns a captured page into issue drafts (no browser needed). Only confirmed
 * failed resources become issues; console messages are classified after the
 * failed requests have their verdicts.
 */
export function analyzePage(
  capture: PageCapture,
  ctx: IssueContext,
  siteHostname: string,
): IssueDraft[] {
  if (capture.outcome !== 'DONE' || !capture.axe || !capture.dom) return [];
  const domFindings = capture.dom.findings.flatMap((finding) => {
    if (finding.check !== 'BROKEN_IMAGE') return [finding];
    const verdict = capture.imageVerdicts.get(String(finding.measurements?.src ?? ''));
    if (verdict?.verdict !== 'CONFIRMED') return []; // listed in the report as unverified
    return [
      {
        ...finding,
        measurements: {
          ...finding.measurements,
          verdict: verdict.verdict,
          verdictReason: verdict.reason,
        },
        message: `${finding.message} ${verdict.reason}`,
      },
    ];
  });
  const brokenImageSrcs = new Set(
    domFindings
      .filter((f) => f.check === 'BROKEN_IMAGE')
      .map((f) => String(f.measurements?.src ?? '')),
  );
  const consoleGroups = classifyPageConsole(capture.network, siteHostname);
  return [
    ...axeToDrafts(capture.axe, ctx, capture.axeBoxes),
    ...domToDrafts(domFindings, ctx, 'UI_HEALTH'),
    ...networkToDrafts(capture.network, ctx, siteHostname, brokenImageSrcs),
    ...consoleToDrafts(consoleGroups, ctx),
  ];
}
