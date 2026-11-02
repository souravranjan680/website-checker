import type { PageCheckResult } from '../types';

export type PageSupport =
  { supported: true } | { supported: false; reason: 'browser-page' | 'no-access' | 'not-web' };

const WEB_STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i;

/**
 * Can the extension check this tab? Chrome never lets extensions run on its own pages
 * (chrome://, the Web Store, other extensions). Without the "tabs" permission the URL
 * is only known once you clicked the toolbar icon on that page (activeTab).
 */
export function pageSupport(url: string | undefined): PageSupport {
  if (!url) return { supported: false, reason: 'no-access' };
  if (WEB_STORE.test(url)) return { supported: false, reason: 'browser-page' };
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search):/i.test(url)) {
    return { supported: false, reason: 'browser-page' };
  }
  if (!/^https?:\/\//i.test(url)) return { supported: false, reason: 'not-web' };
  return { supported: true };
}

export const SUPPORT_MESSAGES: Record<Exclude<PageSupport, { supported: true }>['reason'], string> =
  {
    'browser-page':
      'This is a browser page (for example chrome:// pages or the Chrome Web Store). Chrome does not allow extensions to check it.',
    'no-access':
      'Chrome has not given the extension access to this page. Open the page you want to check and click the extension icon in the toolbar. (Browser pages such as chrome:// and the Chrome Web Store can never be checked.)',
    'not-web':
      'Only web pages (http:// or https://) can be checked. Local files and other kinds of pages are not supported.',
  };

/** Chrome's errors from executeScript, in plain words. */
export function describeInjectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /Cannot access a chrome|extensions gallery|chrome-extension:\/\/|cannot be scripted/i.test(
      message,
    )
  ) {
    return SUPPORT_MESSAGES['browser-page'];
  }
  if (/Cannot access contents|host permission|Missing host|permission/i.test(message)) {
    return SUPPORT_MESSAGES['no-access'];
  }
  if (/No tab with id|Frame with ID 0 was removed|tab was closed/i.test(message)) {
    return 'The tab was closed or reloaded while it was being checked. Try again.';
  }
  return `The page could not be checked: ${message}`;
}

/** The tab to check: the active tab, or ?tabId=… when the popup is opened as a page. */
export async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const requested = Number(new URLSearchParams(location.search).get('tabId'));
  if (Number.isInteger(requested) && requested > 0) {
    return chrome.tabs.get(requested).catch(() => undefined);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

type PageApi = {
  run: () => Promise<PageCheckResult>;
  highlight: (selector: string, label: string) => boolean;
  clearHighlight: () => void;
};

/** Injects the checks into the tab's top frame (frames from other sites are not touched). */
async function inject(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['page-runner.js'],
  });
}

async function call<T>(
  tabId: number,
  func: (...args: string[]) => T,
  args: string[] = [],
): Promise<Awaited<T>> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func,
    args,
  });
  return result?.result as Awaited<T>;
}

export async function checkTab(tabId: number): Promise<PageCheckResult> {
  await inject(tabId);
  return call(tabId, () =>
    (globalThis as unknown as { __whcExtension: PageApi }).__whcExtension.run(),
  );
}

export async function highlightInTab(
  tabId: number,
  selector: string,
  label: string,
): Promise<boolean> {
  await inject(tabId);
  return call(
    tabId,
    (s: string, l: string) =>
      (globalThis as unknown as { __whcExtension: PageApi }).__whcExtension.highlight(s, l),
    [selector, label],
  );
}

export async function clearHighlightInTab(tabId: number): Promise<void> {
  await call(tabId, () => {
    (globalThis as unknown as { __whcExtension?: PageApi }).__whcExtension?.clearHighlight();
  });
}
