import type { Page } from 'playwright';

export interface FailedRequest {
  url: string;
  resourceType: string;
  status?: number;
  error?: string;
  /** Refused by our egress proxy (private/internal address), not a fault of the site. */
  blockedByPolicy: boolean;
}

export interface PageNetworkLog {
  consoleErrors: { text: string; source?: string }[];
  pageErrors: { message: string }[];
  failedRequests: FailedRequest[];
}

const MAX_ENTRIES = 50;

/**
 * Listens to what the browser reports while a page loads:
 *   console.error(...) calls, uncaught JavaScript exceptions, failed requests and
 *   HTTP error responses (images, CSS, scripts, API calls...).
 */
export function attachCollectors(page: Page): { log: PageNetworkLog; detach: () => void } {
  const log: PageNetworkLog = { consoleErrors: [], pageErrors: [], failedRequests: [] };

  const onConsole = (message: import('playwright').ConsoleMessage) => {
    if (message.type() !== 'error' || log.consoleErrors.length >= MAX_ENTRIES) return;
    const text = message.text();
    // Chrome also logs every failed resource as a console error; those are already
    // reported as failed requests, so skip them to avoid duplicate issues.
    if (text.startsWith('Failed to load resource')) return;
    log.consoleErrors.push({
      text: text.slice(0, 500),
      source: message.location().url || undefined,
    });
  };
  const onPageError = (error: Error) => {
    if (log.pageErrors.length < MAX_ENTRIES)
      log.pageErrors.push({ message: error.message.slice(0, 500) });
  };
  const onRequestFailed = (request: import('playwright').Request) => {
    const error = request.failure()?.errorText ?? 'failed';
    // Aborted requests are normal (navigation, cancelled prefetch); not a defect.
    if (error.includes('ERR_ABORTED') || log.failedRequests.length >= MAX_ENTRIES) return;
    log.failedRequests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      error,
      blockedByPolicy: error.includes('ERR_TUNNEL_CONNECTION_FAILED'),
    });
  };
  const onResponse = (response: import('playwright').Response) => {
    if (response.status() < 400 || log.failedRequests.length >= MAX_ENTRIES) return;
    log.failedRequests.push({
      url: response.url(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      blockedByPolicy: response.headers()['x-whc-egress-blocked'] === '1',
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return {
    log,
    detach: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}
