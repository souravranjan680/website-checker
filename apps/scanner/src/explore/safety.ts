import type { BrowserContext, Page, Route } from 'playwright';
import { isSameSite } from '../crawler/urls';

/** Request types that only render the page; everything else is blocked while exploring. */
const RENDERING_RESOURCES = new Set([
  'stylesheet',
  'script',
  'image',
  'font',
  'media',
  'texttrack',
  'manifest',
]);

/** Something the explorer prevented while it was interacting with a page. */
export interface BlockedAction {
  kind: 'request' | 'navigation' | 'websocket' | 'download' | 'popup' | 'dialog' | 'form-submit';
  method?: string;
  url?: string;
  detail?: string;
}

/**
 * The safety layer of the explorer (Phase 9). Installed on the explorer's own browser
 * context (never the scan's), so pop-ups opened from the page are covered too. Once
 * armed, after the page has loaded normally:
 *   - every request that is not GET/HEAD/OPTIONS is aborted (forms, fetch POSTs, beacons),
 *   - only page resources may load (stylesheets, scripts, images, fonts, media): data
 *     requests (fetch/XHR, same site too), beacons, event streams, downloads are aborted,
 *   - every page navigation is aborted (except the explorer's own reload of the page),
 *   - WebSockets never reach a server (always, also during the page load),
 *   - pop-ups are closed, downloads cancelled, dialogs dismissed ("Cancel"),
 *   - form submission is prevented inside the page.
 * GET requests are NOT assumed to be safe: the explorer only clicks controls that
 * reveal content, and navigation is blocked. Everything blocked is recorded.
 */
export async function installSafety(
  context: BrowserContext,
  options: { siteHostname: string },
): Promise<{
  blocked: BlockedAction[];
  /** Start blocking (after the page has loaded normally). */
  arm: () => void;
  /** Stop blocking, before the next page is loaded normally. */
  disarm: () => void;
  /** Lets exactly one navigation to `url` through (the explorer's own reload). */
  allowNavigation: (url: string) => void;
  /** Reads (and clears) the actions the in-page guards stopped (see PAGE_GUARDS). */
  collectPageBlocks: (page: Page) => Promise<void>;
}> {
  const blocked: BlockedAction[] = [];
  let armed = false;
  let allowedNavigation: string | null = null;

  const handle = async (route: Route) => {
    const request = route.request();
    if (!armed) return route.fallback();
    const url = request.url();
    if (request.isNavigationRequest()) {
      if (allowedNavigation !== null && url === allowedNavigation) {
        allowedNavigation = null;
        return route.fallback();
      }
      blocked.push({ kind: 'navigation', method: request.method(), url });
      return route.abort('blockedbyclient');
    }
    const method = request.method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      blocked.push({ kind: 'request', method, url, detail: request.resourceType() });
      return route.abort('blockedbyclient');
    }
    // Allow-list: only what a page needs to render (no documents, downloads, data
    // requests or beacons). GET is not assumed to be safe: an app can change data on a GET.
    const type = request.resourceType();
    if (!RENDERING_RESOURCES.has(type)) {
      const where = isSameSite(url, options.siteHostname) ? '' : ' to another site';
      blocked.push({ kind: 'request', method, url, detail: `${type}${where}` });
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  };
  await context.route('**/*', handle);
  await context.routeWebSocket(/.*/, (ws) => {
    blocked.push({ kind: 'websocket', url: ws.url() });
    void ws.close();
  });
  context.on('page', (page) => {
    page.on('dialog', (dialog) => {
      blocked.push({
        kind: 'dialog',
        detail: `${dialog.type()}: ${dialog.message().slice(0, 120)}`,
      });
      void dialog.dismiss().catch(() => {});
    });
    page.on('download', (download) => {
      blocked.push({ kind: 'download', url: download.url() });
      void download.cancel().catch(() => {});
    });
    page.on('popup', (popup) => {
      blocked.push({ kind: 'popup', url: popup.url() });
      void popup.close().catch(() => {});
    });
  });

  return {
    blocked,
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
      allowedNavigation = null;
    },
    allowNavigation: (url) => {
      allowedNavigation = url;
    },
    collectPageBlocks: async (page) => {
      const inPage = (await page
        .evaluate(
          `(() => { const s = window.__whcBlocked || []; window.__whcBlocked = []; return s; })()`,
        )
        .catch(() => [])) as { kind: BlockedAction['kind']; detail: string }[];
      for (const entry of inPage) blocked.push({ kind: entry.kind, detail: entry.detail });
    },
  };
}

/**
 * Guards installed inside the page after it has loaded, before exploring. Some actions
 * never reach the browser's request routing in a form the safety layer can block
 * (Chromium's download manager fetches files on its own), so they are stopped in the
 * page before any request starts, and recorded:
 *   - form submission (submit events and form.submit()),
 *   - script-triggered link clicks (a.click(): how pages start downloads and pop-ups),
 *   - clicks on download links (<a download>).
 * The explorer itself clicks with real mouse input, which these do not affect.
 */
export const PAGE_GUARDS = `(() => {
  if (window.__whcGuards) return;
  window.__whcGuards = true;
  window.__whcBlocked = [];
  const record = (kind, detail) => window.__whcBlocked.push({ kind, detail: String(detail || '') });
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    record('form-submit', event.target && event.target.action);
  }, true);
  HTMLFormElement.prototype.submit = function () { record('form-submit', this.action); };
  HTMLFormElement.prototype.requestSubmit = function () { record('form-submit', this.action); };
  HTMLAnchorElement.prototype.click = function () {
    record(this.hasAttribute('download') ? 'download' : 'navigation', this.href);
  };
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (!link) return;
    event.preventDefault();
    record('download', link.href);
  }, true);
})()`;
