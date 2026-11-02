/**
 * The only things the extension stores (chrome.storage.local, this browser only):
 * the dashboard address and whether the authorization notice was acknowledged.
 * Never passwords, tokens, API keys or check results.
 */
export const DEFAULT_DASHBOARD_URL = 'http://localhost:8081';

export interface Settings {
  dashboardUrl: string;
  noticeAcknowledged: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  dashboardUrl: DEFAULT_DASHBOARD_URL,
  noticeAcknowledged: false,
};

/** "https://checker.example.com/" → "https://checker.example.com"; null if not a usable URL. */
export function normalizeDashboardUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A dashboard address never needs a user name, password, query or fragment.
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['dashboardUrl', 'noticeAcknowledged']);
  return {
    dashboardUrl:
      (typeof stored.dashboardUrl === 'string' && normalizeDashboardUrl(stored.dashboardUrl)) ||
      DEFAULT_DASHBOARD_URL,
    noticeAcknowledged: stored.noticeAcknowledged === true,
  };
}

export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  const allowed: Partial<Settings> = {};
  if (changes.dashboardUrl !== undefined) {
    const normalized = normalizeDashboardUrl(changes.dashboardUrl);
    if (!normalized) throw new Error('Enter a dashboard address starting with http:// or https://');
    allowed.dashboardUrl = normalized;
  }
  if (changes.noticeAcknowledged !== undefined)
    allowed.noticeAcknowledged = changes.noticeAcknowledged;
  await chrome.storage.local.set(allowed);
}
