import type { DomFinding } from '@whc/dom-checks';
import {
  classifyResourceFailure,
  type Classification,
  type ProbeOutcome,
} from '../audits/resource-check';
import type { FailedRequest, PageNetworkLog } from './collectors';

/** Re-checks one URL through the egress proxy (GET). Injected so tests can fake it. */
export type ProbeFn = (url: string) => Promise<ProbeOutcome>;

const MAX_PROBES_PER_PAGE = 15;
const CONCURRENCY = 4;

/**
 * Gives every failed resource of a page a verdict (CONFIRMED / INCONCLUSIVE /
 * BLOCKED_BY_POLICY), and decides which images the DOM check found "broken" are
 * really broken. Mutates `log.failedRequests` (verdicts are stored with the page)
 * and returns the verdict per broken <img> src.
 *
 * `probe` is null when no re-check is possible; then only the site's own HTTP
 * client errors (4xx) count as confirmed.
 */
export async function verifyPageResources(
  log: PageNetworkLog,
  domFindings: DomFinding[],
  probe: ProbeFn | null,
): Promise<Map<string, Classification>> {
  const imageVerdicts = new Map<string, Classification>();
  const pending = new Map<string, FailedRequest[]>();
  for (const request of log.failedRequests) {
    if (request.resourceType === 'document') continue; // pages are reported on the Pages list
    if (request.blockedByPolicy) {
      request.verdict = 'BLOCKED_BY_POLICY';
      request.verdictReason =
        'Not loaded: the address is private or internal, so the scanner’s security policy refused it.';
      continue;
    }
    pending.set(request.url, [...(pending.get(request.url) ?? []), request]);
  }

  // DOM "broken" images with no failed request: either the server sent something that is
  // not an image (confirmed), or we have no evidence yet and re-check it like the others.
  // An image/* response that does not display may be a corrupt file OR an interrupted
  // download, so it is re-checked too.
  const brokenSrcs = new Set(
    domFindings
      .filter((f) => f.check === 'BROKEN_IMAGE' && typeof f.measurements?.src === 'string')
      .map((f) => String(f.measurements!.src)),
  );
  for (const src of brokenSrcs) {
    if (pending.has(src)) continue;
    const downloaded = log.imageResponses.get(src);
    if (downloaded?.contentType && !/^image\//i.test(downloaded.contentType)) {
      imageVerdicts.set(src, {
        verdict: 'CONFIRMED',
        reason: `The server answers HTTP ${downloaded.status} with ${downloaded.contentType}, not an image, so the browser cannot display it.`,
        status: null,
      });
      continue;
    }
    if (!/^https?:/i.test(src)) {
      // data:/blob: images were never fetched; the browser could not decode them.
      imageVerdicts.set(src, {
        verdict: 'CONFIRMED',
        reason: 'The embedded image data cannot be displayed.',
        status: null,
      });
      continue;
    }
    const synthetic: FailedRequest = {
      url: src,
      resourceType: 'image',
      error: 'not displayed',
      blockedByPolicy: false,
    };
    log.failedRequests.push(synthetic);
    pending.set(src, [synthetic]);
  }

  const urls = [...pending.keys()];
  const outcomes = new Map<string, ProbeOutcome | null>();
  const toProbe = probe ? urls.slice(0, MAX_PROBES_PER_PAGE) : [];
  for (let i = 0; i < toProbe.length; i += CONCURRENCY) {
    const batch = toProbe.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((url) => probe!(url).catch(() => null)));
    batch.forEach((url, index) => outcomes.set(url, results[index] ?? null));
  }

  for (const [url, requests] of pending) {
    const recheck = outcomes.get(url) ?? null;
    for (const request of requests) {
      let classification = classifyResourceFailure(
        { status: request.status, error: request.error },
        recheck,
      );
      // A DOM-broken image that re-checks as a normal download but is not an image file.
      if (
        request.error === 'not displayed' &&
        recheck?.kind === 'ok' &&
        recheck.contentType &&
        !/^image\//i.test(recheck.contentType)
      ) {
        classification = {
          verdict: 'CONFIRMED',
          reason: `The address returns ${recheck.contentType}, not an image.`,
          status: null,
        };
      }
      request.verdict = classification.verdict;
      request.verdictReason = classification.reason;
      if (classification.status && !request.status) request.status = classification.status;
      if (request.resourceType === 'image' || brokenSrcs.has(url))
        imageVerdicts.set(url, classification);
    }
  }
  return imageVerdicts;
}
