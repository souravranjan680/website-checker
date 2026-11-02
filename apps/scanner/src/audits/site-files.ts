import type { APIRequestContext } from 'playwright';
import { BLOCKED_RESPONSE_HEADER } from '../browser-types';
import type { Logger } from '../logger';
import type { HttpRedirectFacts, SiteSecurityFacts } from './security';
import { inspectCertificate } from './tls';
import {
  analyzeRobotsTxt,
  looksLikeSitemap,
  type RobotsFacts,
  type SiteSeoFacts,
  type SitemapFacts,
} from './seo';

const MAX_BYTES = 500_000;

export interface FetchedFile {
  url: string;
  status: number | null;
  text: string;
  error?: string;
}

/**
 * GET a small site file (robots.txt, sitemap.xml) through the scanner's HTTP client,
 * which always goes via the egress proxy. A request the proxy blocked, or one that
 * failed, gets status null: that is "could not check", not "missing".
 */
export async function fetchSiteFile(
  api: APIRequestContext,
  url: string,
  log: Logger,
): Promise<FetchedFile> {
  try {
    const response = await api.get(url, { maxRedirects: 3, timeout: 10_000 });
    const blocked = response.headers()[BLOCKED_RESPONSE_HEADER] === '1';
    const status = blocked ? null : response.status();
    const text = response.ok() && !blocked ? (await response.text()).slice(0, MAX_BYTES) : '';
    await response.dispose();
    return { url, status, text, ...(blocked ? { error: 'Blocked by the security proxy' } : {}) };
  } catch (error) {
    log.info({ url, err: (error as Error).message }, 'site file request failed');
    return { url, status: null, text: '', error: 'Request failed' };
  }
}

/** robots.txt plus the sitemap it points to (or /sitemap.xml). Only the start page's host is checked. */
export async function collectSiteSeoFacts(
  api: APIRequestContext,
  startUrl: string,
  robotsFile: FetchedFile,
  log: Logger,
): Promise<SiteSeoFacts> {
  const robotsFound =
    robotsFile.status !== null && robotsFile.status >= 200 && robotsFile.status < 300;
  const analysis = robotsFound
    ? analyzeRobotsTxt(robotsFile.text)
    : { blocksAll: false, sitemaps: [] };
  const robotsTxt: RobotsFacts = {
    url: robotsFile.url,
    status: robotsFile.status,
    found: robotsFound,
    error: robotsFile.error,
    ...analysis,
  };

  // Only same-host sitemap addresses are fetched (a robots.txt could point anywhere).
  const host = new URL(startUrl).host;
  const listed = analysis.sitemaps.find((s) => {
    try {
      return new URL(s).host === host;
    } catch {
      return false;
    }
  });
  const sitemapUrl = listed ?? new URL('/sitemap.xml', startUrl).toString();
  const file = await fetchSiteFile(api, sitemapUrl, log);
  const found = file.status !== null && file.status >= 200 && file.status < 300;
  const sitemap: SitemapFacts = {
    url: sitemapUrl,
    status: file.status,
    found,
    error: file.error,
    source: listed ? 'robots.txt' : 'default',
    validXml: found && looksLikeSitemap(file.text),
  };
  return { robotsTxt, sitemap };
}

/**
 * Transport facts: the certificate (TLS handshake through the proxy) and whether
 * http:// redirects to https:// (one request, no redirects followed).
 */
export async function collectSiteSecurityFacts(args: {
  api: APIRequestContext;
  proxyUrl: string;
  /** Final URL of the first scanned page: its protocol tells how the site is served. */
  firstPageUrl: string;
  log: Logger;
}): Promise<SiteSecurityFacts> {
  const page = new URL(args.firstPageUrl);
  const servedOverHttps = page.protocol === 'https:';
  const tls = await inspectCertificate(
    args.proxyUrl,
    page.hostname,
    servedOverHttps && page.port ? Number(page.port) : 443,
  );

  let httpRedirect: HttpRedirectFacts | null = null;
  if (servedOverHttps) {
    const httpUrl = new URL(page.origin.replace(/^https:/, 'http:'));
    httpUrl.port = '';
    const url = `${httpUrl.origin}/`;
    try {
      const response = await args.api.get(url, { maxRedirects: 0, timeout: 10_000 });
      const blocked = response.headers()[BLOCKED_RESPONSE_HEADER] === '1';
      const location = response.headers()['location'] ?? null;
      const status = blocked ? null : response.status();
      await response.dispose();
      httpRedirect = {
        url,
        status,
        location,
        redirectsToHttps:
          status === null
            ? null
            : status >= 300 &&
              status < 400 &&
              Boolean(location && /^https:/i.test(new URL(location, url).protocol)),
        ...(blocked ? { error: 'Blocked by the security proxy' } : {}),
      };
    } catch (error) {
      // Nothing listening on port 80 is fine: nothing is served insecurely.
      args.log.info({ url, err: (error as Error).message }, 'http:// check failed');
      httpRedirect = {
        url,
        status: null,
        location: null,
        redirectsToHttps: null,
        error: 'No response',
      };
    }
  }
  return { servedOverHttps, tls, httpRedirect };
}
