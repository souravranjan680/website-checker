import type { LinkInfo } from '@whc/dom-checks';
import type { Page } from 'playwright';
import { BLOCKED_RESPONSE_HEADER, type ViewportSpec } from '../browser-types';
import { axeSelector, boxesFor, runAxe } from '../checks/axe';
import { attachCollectors, type PageNetworkLog } from '../checks/collectors';
import { runDomChecksInPage } from '../checks/dom';
import { isSameSite, normalizeUrl } from '../crawler/urls';
import {
  axeToDrafts,
  domToDrafts,
  networkToDrafts,
  SEVERITY_RANK,
  type IssueDraft,
} from '../issues';
import type { Logger } from '../logger';
import { captureFullPage, captureHighlightedIssue, type CapturedImage } from '../screenshots';

export interface PageScanResult {
  outcome: 'DONE' | 'FAILED' | 'SKIPPED';
  finalUrl: string;
  httpStatus: number | null;
  contentType: string | null;
  loadTimeMs: number | null;
  errorMessage: string | null;
  meta: {
    title: string;
    metaDescription: string | null;
    canonical: string | null;
    lang: string | null;
    h1Count: number;
  } | null;
  responseHeaders: Record<string, string> | null;
  network: PageNetworkLog;
  links: LinkInfo[];
  drafts: IssueDraft[];
  fullPage: CapturedImage | null;
  crops: Map<string, CapturedImage>;
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
 * Loads one page in the browser and runs every desktop check on it:
 *   1. navigate (wait for "load", then briefly for network quiet: JS-heavy pages)
 *   2. axe-core accessibility rules
 *   3. DOM/UI checks (layout, broken images, empty controls)
 *   4. network/console findings collected while loading
 *   5. full-page screenshot + highlighted screenshots of the worst problems
 */
export async function scanPage(params: {
  page: Page;
  url: string;
  viewport: ViewportSpec;
  websiteId: string;
  siteHostname: string;
  navTimeoutMs: number;
  domBundle: string;
  cropBudget: { remaining: number };
  alreadyScanned: (normalizedUrl: string) => boolean;
  logger: Logger;
}): Promise<PageScanResult> {
  const { page, url, viewport, logger } = params;
  const { log, detach } = attachCollectors(page);
  const result: PageScanResult = {
    outcome: 'FAILED',
    finalUrl: url,
    httpStatus: null,
    contentType: null,
    loadTimeMs: null,
    errorMessage: null,
    meta: null,
    responseHeaders: null,
    network: log,
    links: [],
    drafts: [],
    fullPage: null,
    crops: new Map(),
  };

  try {
    const started = Date.now();
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: params.navTimeoutMs });
    } catch (error) {
      logger.info({ url, err: (error as Error).message }, 'navigation failed');
      result.errorMessage = describeNavigationError(error, params.navTimeoutMs);
      return result;
    }
    if (!response) {
      result.errorMessage = 'The page returned no response.';
      return result;
    }

    const headers = response.headers();
    result.finalUrl = page.url();
    result.httpStatus = response.status();
    result.contentType = headers['content-type'] ?? null;
    result.responseHeaders = headers;

    if (headers[BLOCKED_RESPONSE_HEADER] === '1') {
      result.errorMessage =
        response.status() === 403
          ? 'Blocked by the security proxy: this address (or a redirect it followed) points to a private or internal network.'
          : 'The site could not be reached (the domain may not exist).';
      return result;
    }
    const skip = (message: string) => {
      result.outcome = 'SKIPPED';
      result.errorMessage = message;
      return result;
    };
    if (!isSameSite(result.finalUrl, params.siteHostname)) {
      return skip(
        `Redirects to another website (${new URL(result.finalUrl).hostname}); not scanned.`,
      );
    }
    const finalNormalized = normalizeUrl(result.finalUrl);
    if (
      finalNormalized &&
      finalNormalized !== normalizeUrl(url) &&
      params.alreadyScanned(finalNormalized)
    ) {
      return skip(`Redirects to ${result.finalUrl}, which was already scanned.`);
    }
    if (response.status() >= 400) return skip(`The server answered HTTP ${response.status()}.`);
    if (!(result.contentType ?? '').includes('html')) return skip('Not an HTML page.');

    // JavaScript-heavy pages keep loading after "load"; give them a few seconds.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    result.loadTimeMs =
      ((await page
        .evaluate(
          `(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? Math.round(n.loadEventEnd || n.duration) : null; })()`,
        )
        .catch(() => null)) as number | null) ?? Date.now() - started;

    const ctx = { websiteId: params.websiteId, pageUrl: result.finalUrl, viewport: viewport.label };

    // 1) accessibility
    const axe = await runAxe(page);
    // Elements axe already reported as unnamed controls are not reported again by the UI checks.
    const skipSelectors = axe.violations
      .filter((rule) => ['button-name', 'link-name', 'input-button-name'].includes(rule.id))
      .flatMap((rule) => rule.nodes.map((node) => axeSelector(node.target)))
      .filter((s): s is string => Boolean(s));
    const axeSelectors = [
      ...new Set(
        [...axe.violations, ...axe.incomplete]
          .flatMap((rule) => rule.nodes.map((node) => axeSelector(node.target)))
          .filter((s): s is string => Boolean(s)),
      ),
    ];
    const boxList = await boxesFor(page, axeSelectors.slice(0, 300));
    const boxes = new Map(axeSelectors.slice(0, 300).map((s, i) => [s, boxList[i] ?? null]));

    // 2) UI checks inside the page
    const dom = await runDomChecksInPage(page, params.domBundle, { mode: 'all', skipSelectors });
    result.links = dom.snapshot.links;
    result.meta = {
      title: dom.snapshot.title,
      metaDescription: dom.snapshot.metaDescription,
      canonical: dom.snapshot.canonical,
      lang: dom.snapshot.lang,
      h1Count: dom.snapshot.h1Count,
    };
    const brokenImageSrcs = new Set(
      dom.findings
        .filter((f) => f.check === 'BROKEN_IMAGE')
        .map((f) => String(f.measurements?.src ?? '')),
    );

    result.drafts = [
      ...axeToDrafts(axe, ctx, boxes),
      ...domToDrafts(dom.findings, ctx, 'UI_HEALTH'),
      ...networkToDrafts(log, ctx, params.siteHostname, brokenImageSrcs),
    ];

    // 3) screenshots (failures are logged, never fatal)
    try {
      result.fullPage = await captureFullPage(page);
    } catch (error) {
      logger.warn({ url, err: (error as Error).message }, 'full-page screenshot failed');
    }
    const candidates = result.drafts
      .filter(
        (d) =>
          d.boundingBox &&
          d.boundingBox.width > 0 &&
          d.boundingBox.height > 0 &&
          d.severity !== 'INFO',
      )
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
      .slice(0, Math.min(5, params.cropBudget.remaining));
    for (const draft of candidates) {
      try {
        result.crops.set(
          draft.id,
          await captureHighlightedIssue(
            page,
            draft.boundingBox!,
            `${draft.severity} · ${draft.title}`,
          ),
        );
        params.cropBudget.remaining -= 1;
      } catch (error) {
        logger.debug({ url, err: (error as Error).message }, 'issue screenshot failed');
      }
    }

    result.outcome = 'DONE';
    return result;
  } finally {
    detach();
  }
}
