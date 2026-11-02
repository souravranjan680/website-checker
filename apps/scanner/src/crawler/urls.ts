/**
 * URL rules for the crawler: what counts as "the same page" (no duplicates),
 * what counts as "the same website", and which links are worth visiting.
 */

const NON_HTML_EXTENSIONS =
  /\.(pdf|zip|gz|rar|7z|tar|jpe?g|png|gif|svg|webp|avif|ico|bmp|mp4|webm|mov|mp3|wav|ogg|docx?|xlsx?|pptx?|csv|exe|dmg|msi|apk|css|js|mjs|json|xml|rss|txt|woff2?|ttf|eot)$/i;

/**
 * Normalized form used for de-duplication:
 *   https://Example.com:443/About?b=2&a=1#team → https://example.com/About?a=1&b=2
 * (fragment removed, host lower-cased, default port removed, query sorted).
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  url.searchParams.sort();
  if (!url.pathname) url.pathname = '/';
  return url.toString();
}

/** Same website = same host name (http/https and default ports don't matter). */
export function isSameSite(candidate: string, siteHostname: string): boolean {
  try {
    return new URL(candidate).hostname.toLowerCase() === siteHostname.toLowerCase();
  } catch {
    return false;
  }
}

export function looksLikeHtml(url: string): boolean {
  try {
    return !NON_HTML_EXTENSIONS.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** "/blog/*" style patterns → regular expressions on the path. */
export function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map(
    (pattern) =>
      new RegExp(
        `^${pattern
          .split('*')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      ),
  );
}

export function pathAllowed(url: string, include: RegExp[], exclude: RegExp[]): boolean {
  const { pathname } = new URL(url);
  if (exclude.some((re) => re.test(pathname))) return false;
  return include.length === 0 || include.some((re) => re.test(pathname));
}

export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
