import { isPublicIpAddress, parseIPv4 } from './ip';

export type UrlCheckResult =
  { ok: true; url: string; hostname: string } | { ok: false; reason: string };

// Host names that only exist inside private networks.
const INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.corp',
  '.intranet',
];

/**
 * Layer 1 of SSRF protection: checks that a user-entered website address is a
 * public http(s) URL, and returns it in a normalized form.
 *
 * Runs in the browser (instant form feedback) AND in the API (the real check).
 * The API additionally resolves DNS (layer 2); see apps/api/src/lib/hostname-guard.ts.
 *
 *   normalizeWebsiteUrl('Example.com/shop#top') → { ok: true, url: 'https://example.com/shop' }
 *   normalizeWebsiteUrl('http://127.0.0.1')     → { ok: false, reason: '...' }
 */
export function normalizeWebsiteUrl(input: string): UrlCheckResult {
  const fail = (reason: string): UrlCheckResult => ({ ok: false, reason });
  const raw = input.trim();
  if (!raw) return fail('Enter a website address.');
  if (raw.length > 2048) return fail('The address is too long (max 2048 characters).');

  // "example.com" without a scheme is treated as https://example.com
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    // The WHATWG URL parser also normalizes tricks like http://0x7f.1 → 127.0.0.1
    url = new URL(withScheme);
  } catch {
    return fail('This is not a valid web address.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('Only http:// and https:// addresses can be scanned.');
  }
  if (url.username || url.password) {
    return fail('Remove the username and password from the address.');
  }
  if (url.port !== '') {
    // url.port is empty for the default ports (80 for http, 443 for https).
    return fail('Only standard web ports (80 and 443) are allowed.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return fail('This is not a valid web address.');

  if (hostname === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return fail('Local and internal addresses cannot be scanned.');
  }

  const isIPv6Literal = hostname.startsWith('[');
  const ipCandidate = isIPv6Literal ? hostname.slice(1, -1) : hostname;
  if (isIPv6Literal || parseIPv4(ipCandidate)) {
    if (!isPublicIpAddress(ipCandidate)) {
      return fail('Private, local or reserved IP addresses cannot be scanned.');
    }
  } else if (!hostname.includes('.')) {
    return fail('Enter a full domain name, like example.com.');
  }

  const path = url.pathname || '/';
  return { ok: true, url: `${url.protocol}//${hostname}${path}${url.search}`, hostname };
}
