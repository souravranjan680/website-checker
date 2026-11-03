import type { InsecureReference, LinkInfo, SeoSnapshot } from '@whc/dom-checks';
import type { Page } from 'playwright';
import type { CookieFacts } from '../audits/security';
import type { ViewportSpec } from '../browser-types';
import { attachCollectors, type PageNetworkLog } from '../checks/collectors';
import type { ProbeFn } from '../checks/verify-resources';
import { SEVERITY_RANK, type IssueDraft } from '../issues';
import type { Logger } from '../logger';
import { captureFullPage, captureHighlightedIssue, type CapturedImage } from '../screenshots';
import { analyzePage, capturePage } from './capture-page';

export { describeNavigationError } from './capture-page';

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
    seo: SeoSnapshot;
  } | null;
  responseHeaders: Record<string, string> | null;
  /** Set-Cookie attributes of the main document (names and flags only, never values). */
  cookies: CookieFacts[];
  /** http:// references on an https page (mixed content), from the DOM. */
  insecureReferences: InsecureReference[];
  network: PageNetworkLog;
  links: LinkInfo[];
  drafts: IssueDraft[];
  fullPage: CapturedImage | null;
  crops: Map<string, CapturedImage>;
}

/**
 * Health scan of one page at desktop size:
 *   1. capturePage: navigate, axe-core, DOM/UI checks, re-check failed resources
 *   2. analyzePage: the facts → issue drafts (confirmed failures only; console
 *      messages classified and grouped)
 *   3. full-page screenshot + highlighted screenshots of the worst problems
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
  /** Re-checks a failed resource through the egress proxy; null = no re-checks. */
  probe: ProbeFn | null;
  logger: Logger;
}): Promise<PageScanResult> {
  const { page, url, viewport, logger } = params;
  // Listening until the screenshots are done: lazy content they trigger is recorded too.
  const { log, detach } = attachCollectors(page);
  try {
    const capture = await capturePage({ ...params, log });
    const snapshot = capture.dom?.snapshot;
    const result: PageScanResult = {
      outcome: capture.outcome === 'DONE' ? 'FAILED' : capture.outcome, // DONE once screenshots ran
      finalUrl: capture.finalUrl,
      httpStatus: capture.httpStatus,
      contentType: capture.contentType,
      loadTimeMs: capture.loadTimeMs,
      errorMessage: capture.errorMessage,
      meta: snapshot
        ? {
            title: snapshot.title,
            metaDescription: snapshot.metaDescription,
            canonical: snapshot.canonical,
            lang: snapshot.lang,
            h1Count: snapshot.h1Count,
            seo: snapshot.seo,
          }
        : null,
      responseHeaders: capture.responseHeaders,
      cookies: capture.cookies,
      insecureReferences: snapshot?.insecureReferences ?? [],
      network: log,
      links: snapshot?.links ?? [],
      drafts: [],
      fullPage: null,
      crops: new Map(),
    };
    if (capture.outcome !== 'DONE') return result;

    result.drafts = analyzePage(
      capture,
      { websiteId: params.websiteId, pageUrl: capture.finalUrl, viewport: viewport.label },
      params.siteHostname,
    );

    // Screenshots (failures are logged, never fatal)
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
