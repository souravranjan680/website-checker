import type { Page } from 'playwright';
import type { Verdict } from '../audits/resource-check';
import type { ConsoleKind, RelatedRequest } from './console-classify';

export interface FailedRequest {
  url: string;
  resourceType: string;
  status?: number;
  error?: string;
  /** Refused by our egress proxy (private/internal address), not a fault of the site. */
  blockedByPolicy: boolean;
  /** Set after the re-check (see audits/resource-check.ts). */
  verdict?: Verdict;
  verdictReason?: string;
}

/** Where a console message or exception came from (the script, not the page). */
export interface SourceLocation {
  source?: string;
  line?: number;
  column?: number;
}

/** Added after the page loaded (see console-classify.ts); stored with the page. */
export interface ConsoleClassificationFields {
  kind?: ConsoleKind;
  related?: RelatedRequest[];
}

export interface ConsoleEntry extends SourceLocation, ConsoleClassificationFields {
  level: 'error' | 'warning';
  text: string;
}

export interface PageErrorEntry extends SourceLocation, ConsoleClassificationFields {
  message: string;
  /** First lines of the stack trace (no page data). */
  stack?: string;
}

export interface PageNetworkLog {
  consoleErrors: ConsoleEntry[];
  pageErrors: PageErrorEntry[];
  failedRequests: FailedRequest[];
  /** Images that DID download (status < 400): an image that still shows as broken is a bad file. Not stored. */
  imageResponses: Map<string, { status: number; contentType: string | null }>;
}

const MAX_ENTRIES = 50;
const MAX_WARNINGS = 20;

/** "at fn (https://x/app.js:12:5)" → { source, line, column } of the first frame with a URL. */
export function firstStackFrame(stack: string | undefined): SourceLocation {
  const match = /(https?:\/\/[^\s)]+?):(\d+):(\d+)/.exec(stack ?? '');
  return match ? { source: match[1], line: Number(match[2]), column: Number(match[3]) } : {};
}

/**
 * Listens to what the browser reports while a page loads: console errors and
 * warnings (with file, line and column), uncaught exceptions, failed requests and
 * HTTP error responses, plus which images downloaded successfully.
 */
export function attachCollectors(page: Page): { log: PageNetworkLog; detach: () => void } {
  const log: PageNetworkLog = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    imageResponses: new Map(),
  };

  const onConsole = (message: import('playwright').ConsoleMessage) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    // Chrome also logs every failed resource as a console error; those are already
    // recorded (and verified) as failed requests, so skip them to avoid duplicates.
    if (text.startsWith('Failed to load resource')) return;
    const errors = log.consoleErrors.filter((e) => e.level === 'error').length;
    const warnings = log.consoleErrors.length - errors;
    if (type === 'error' ? errors >= MAX_ENTRIES : warnings >= MAX_WARNINGS) return;
    const location = message.location();
    log.consoleErrors.push({
      level: type === 'error' ? 'error' : 'warning',
      text: text.slice(0, 1000),
      source: location.url || undefined,
      line: location.url ? location.lineNumber + 1 : undefined, // Playwright counts from 0
      column: location.url ? location.columnNumber + 1 : undefined,
    });
  };
  const onPageError = (error: Error) => {
    if (log.pageErrors.length >= MAX_ENTRIES) return;
    log.pageErrors.push({
      message: error.message.slice(0, 1000),
      stack: error.stack?.split('\n').slice(0, 6).join('\n').slice(0, 1500),
      ...firstStackFrame(error.stack),
    });
  };
  const onRequestFailed = (request: import('playwright').Request) => {
    const error = request.failure()?.errorText ?? 'failed';
    // "response" fires when the headers arrive; a body that then breaks off is not a download.
    log.imageResponses.delete(request.url());
    // Aborted requests are normal (navigation, cancelled prefetch); not a defect.
    if (error.includes('ERR_ABORTED') || log.failedRequests.length >= MAX_ENTRIES) return;
    log.failedRequests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      error,
      // The browser cannot tell why a tunnel failed; the re-check decides (policy or not).
      blockedByPolicy: false,
    });
  };
  const onResponse = (response: import('playwright').Response) => {
    const status = response.status();
    const resourceType = response.request().resourceType();
    if (status < 400) {
      if (resourceType === 'image' && log.imageResponses.size < 300) {
        log.imageResponses.set(response.url(), {
          status,
          contentType: response.headers()['content-type'] ?? null,
        });
      }
      return;
    }
    if (log.failedRequests.length >= MAX_ENTRIES) return;
    const headers = response.headers();
    log.failedRequests.push({
      url: response.url(),
      resourceType,
      status,
      blockedByPolicy: headers['x-whc-egress-reason'] === 'policy',
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
