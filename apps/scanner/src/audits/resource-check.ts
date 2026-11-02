import { EGRESS_BLOCKED_HEADER, EGRESS_REASON_HEADER } from '@whc/shared';
import type { APIRequestContext } from 'playwright';

/**
 * Is a resource (image, script, stylesheet, link target) REALLY broken?
 *
 * A browser error such as net::ERR_FAILED only says "this did not load"; it is also
 * what Chrome reports for dropped connections, blocked responses and timeouts.
 * So a failure is re-checked once through the same egress proxy (SSRF protection
 * unchanged) and classified:
 *
 *   CONFIRMED          the site answered with an error, the domain does not exist,
 *                      the certificate is invalid, or the browser refuses the response
 *   INCONCLUSIVE       network trouble: timeout, connection refused/reset, temporary
 *                      DNS failure, or it loaded fine on the re-check
 *   BLOCKED_BY_POLICY  our own proxy refused it (private/internal address): not the site's fault
 *
 * Only CONFIRMED failures become issues. The others are listed in the UI health
 * report ("could not be verified") so nothing is hidden.
 */

export type Verdict = 'CONFIRMED' | 'INCONCLUSIVE' | 'BLOCKED_BY_POLICY';

export type ProbeOutcome =
  | { kind: 'ok'; status: number; contentType: string | null }
  | { kind: 'http-error'; status: number }
  | { kind: 'blocked-by-policy' }
  | { kind: 'dns-not-found' }
  | { kind: 'dns-error' }
  | { kind: 'unreachable' }
  | { kind: 'tls-error'; detail: string }
  | { kind: 'timeout' }
  | { kind: 'error'; detail: string };

/** One request through the egress proxy, with the proxy's own answers decoded. */
export async function probeUrl(
  api: APIRequestContext,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs = 10_000,
): Promise<ProbeOutcome> {
  try {
    const response = await api.fetch(url, {
      method,
      maxRedirects: 5,
      timeout: timeoutMs,
      failOnStatusCode: false,
    });
    const headers = response.headers();
    const status = response.status();
    await response.dispose();
    const reason = headers[EGRESS_REASON_HEADER];
    if (reason === 'policy' || (headers[EGRESS_BLOCKED_HEADER] === '1' && status === 403)) {
      return { kind: 'blocked-by-policy' };
    }
    if (reason === 'dns-not-found') return { kind: 'dns-not-found' };
    if (reason === 'dns-error') return { kind: 'dns-error' };
    if (reason === 'unreachable') return { kind: 'unreachable' };
    if (status >= 400) return { kind: 'http-error', status };
    return { kind: 'ok', status, contentType: headers['content-type'] ?? null };
  } catch (error) {
    const message = (error as Error).message.split('\n')[0] ?? '';
    if (/timeout/i.test(message)) return { kind: 'timeout' };
    if (/certificate|SSL|TLS|self[- ]signed|CERT_/i.test(message)) {
      return {
        kind: 'tls-error',
        detail: message.replace(/^apiRequestContext\.\w+:\s*/, '').slice(0, 200),
      };
    }
    if (/ECONNRESET|ECONNREFUSED|socket hang up|EPIPE/i.test(message))
      return { kind: 'unreachable' };
    return { kind: 'error', detail: message.slice(0, 200) };
  }
}

/** What the browser saw the first time. */
export interface BrowserFailure {
  /** HTTP status when the site answered with an error. */
  status?: number;
  /** Chrome's net error, e.g. net::ERR_FAILED, net::ERR_BLOCKED_BY_ORB. */
  error?: string;
}

export interface Classification {
  verdict: Verdict;
  /** One sentence for people: what we know and how we know it. */
  reason: string;
  /** Status to show on the issue (the site's own answer), if any. */
  status: number | null;
}

/** Chrome refused to use the response (wrong content type, cross-origin rules): visitors are affected too. */
const BROWSER_REFUSED = /ERR_BLOCKED_BY_(ORB|RESPONSE)/;

/**
 * Classifies a page resource (image, script, stylesheet, fetch/XHR...).
 * `recheck` is null when no re-check was possible (budget exhausted).
 */
export function classifyResourceFailure(
  first: BrowserFailure,
  recheck: ProbeOutcome | null,
): Classification {
  if (recheck?.kind === 'blocked-by-policy') {
    return {
      verdict: 'BLOCKED_BY_POLICY',
      reason:
        'Not loaded: the address is private or internal, so the scanner’s security policy refused it.',
      status: null,
    };
  }
  // The site itself answered with an error.
  const siteError = recheck?.kind === 'http-error' ? recheck.status : null;
  if (siteError !== null) {
    if (siteError === 429) {
      return {
        verdict: 'INCONCLUSIVE',
        reason: 'The server asked us to slow down (HTTP 429); it may load for normal visitors.',
        status: siteError,
      };
    }
    if (siteError >= 500 && !(first.status && first.status >= 500)) {
      return {
        verdict: 'INCONCLUSIVE',
        reason: `A server error (HTTP ${siteError}) on the re-check only; it may be temporary.`,
        status: siteError,
      };
    }
    return {
      verdict: 'CONFIRMED',
      reason: first.status
        ? `The server answered HTTP ${first.status}, and HTTP ${siteError} again on a re-check.`
        : `The browser could not load it (${first.error ?? 'failed'}); a re-check got HTTP ${siteError}.`,
      status: siteError,
    };
  }
  if (recheck?.kind === 'dns-not-found') {
    return {
      verdict: 'CONFIRMED',
      reason: 'The domain does not exist (DNS has no such name).',
      status: null,
    };
  }
  if (recheck?.kind === 'tls-error') {
    return {
      verdict: 'CONFIRMED',
      reason: `The HTTPS certificate is not valid: ${recheck.detail}`,
      status: null,
    };
  }
  if (recheck?.kind === 'ok') {
    if (first.error && BROWSER_REFUSED.test(first.error)) {
      return {
        verdict: 'CONFIRMED',
        reason: `The server responds (HTTP ${recheck.status}), but the browser refuses to use the response (${first.error}), usually because of its content type.`,
        status: null,
      };
    }
    return {
      verdict: 'INCONCLUSIVE',
      reason: `It failed in the browser (${first.status ? `HTTP ${first.status}` : (first.error ?? 'failed')}) but loaded on a re-check (HTTP ${recheck.status}): probably temporary.`,
      status: null,
    };
  }
  if (first.status && first.status !== 429 && first.status < 500 && !recheck) {
    // The site answered with a client error and no re-check was possible: still the site's own answer.
    return {
      verdict: 'CONFIRMED',
      reason: `The server answered HTTP ${first.status}.`,
      status: first.status,
    };
  }
  const why =
    recheck?.kind === 'timeout'
      ? 'it timed out'
      : recheck?.kind === 'unreachable'
        ? 'the server could not be reached'
        : recheck?.kind === 'dns-error'
          ? 'DNS failed temporarily'
          : recheck
            ? 'the re-check failed too'
            : 'there was no time left to re-check it';
  return {
    verdict: 'INCONCLUSIVE',
    reason: `Could not be verified: it failed in the browser (${first.status ? `HTTP ${first.status}` : (first.error ?? 'failed')}) and ${why}.`,
    status: null,
  };
}

/**
 * Link targets: HEAD first (cheap); anything that looks broken is confirmed with GET,
 * because some servers answer HEAD wrongly. 401/403/405 are not reported (logins and
 * servers that reject automated requests are normal).
 */
export async function checkLink(
  api: APIRequestContext,
  url: string,
): Promise<{ verdict: Verdict | 'OK'; reason: string; status: number | null }> {
  const head = await probeUrl(api, url, 'HEAD');
  if (head.kind === 'ok')
    return { verdict: 'OK', reason: `HTTP ${head.status}`, status: head.status };
  if (head.kind === 'blocked-by-policy') {
    return {
      verdict: 'BLOCKED_BY_POLICY',
      reason: 'Private or internal address: not checked (scanner security policy).',
      status: null,
    };
  }
  const get = await probeUrl(api, url, 'GET');
  if (get.kind === 'ok')
    return { verdict: 'OK', reason: `HTTP ${get.status} (GET)`, status: get.status };
  if (get.kind === 'http-error') {
    if ([401, 403, 405, 407, 429].includes(get.status))
      return {
        verdict: 'OK',
        reason: `HTTP ${get.status} (needs login or refuses automated requests)`,
        status: get.status,
      };
    if (get.status === 404 || get.status === 410) {
      return {
        verdict: 'CONFIRMED',
        reason: `The page does not exist (HTTP ${get.status}).`,
        status: get.status,
      };
    }
    if (get.status >= 500 && head.kind === 'http-error' && head.status >= 500) {
      return {
        verdict: 'CONFIRMED',
        reason: `The server answered with an error twice (HTTP ${head.status}, then ${get.status}).`,
        status: get.status,
      };
    }
    return {
      verdict: 'INCONCLUSIVE',
      reason: `HTTP ${get.status} once; may be temporary.`,
      status: get.status,
    };
  }
  if (get.kind === 'dns-not-found')
    return { verdict: 'CONFIRMED', reason: 'The domain does not exist.', status: null };
  if (get.kind === 'tls-error')
    return {
      verdict: 'CONFIRMED',
      reason: `The HTTPS certificate is not valid: ${get.detail}`,
      status: null,
    };
  if (get.kind === 'blocked-by-policy') {
    return {
      verdict: 'BLOCKED_BY_POLICY',
      reason: 'Private or internal address: not checked (scanner security policy).',
      status: null,
    };
  }
  return {
    verdict: 'INCONCLUSIVE',
    reason:
      get.kind === 'timeout'
        ? 'Timed out twice.'
        : get.kind === 'error'
          ? `Request failed: ${get.detail}`
          : 'Could not connect (twice); may be temporary.',
    status: null,
  };
}
