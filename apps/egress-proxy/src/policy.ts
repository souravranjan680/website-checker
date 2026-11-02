import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicIpAddress } from '@whc/shared';

/** Resolves a host name to every IP address it points to. Replaceable in tests. */
export type ResolveFn = (hostname: string) => Promise<string[]>;

export const systemResolve: ResolveFn = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address);

export interface EgressPolicy {
  /** Ports that may be contacted, normally only 80 (http) and 443 (https). */
  allowedPorts: number[];
  /**
   * TEST ONLY: host name → IP address. Lets automated tests reach a local fixture
   * server under a fake public name (e.g. "fixtures.whc.test" → 127.0.0.1) on any
   * port. Everything else stays fully checked, so tests still prove that
   * 127.0.0.1, 10.x, etc. are blocked. Refused when NODE_ENV=production.
   */
  testHostMap: Record<string, string>;
}

export type EgressDecision =
  | { allowed: true; host: string; port: number; address: string }
  | { allowed: false; host: string; port: number; status: 403 | 502; reason: string };

const INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.corp',
  '.intranet',
];

/** Canonical form of a host as the URL parser sees it ("0x7f.1" → "127.0.0.1"). */
export function canonicalHost(host: string): string | null {
  const trimmed = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  if (!trimmed) return null;
  if (isIP(trimmed) === 6) return trimmed;
  try {
    return new URL(`http://${trimmed}`).hostname.replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * The single decision point of SSRF protection (docs/05-security.md, layer 3).
 * Called for EVERY connection the browser or scanner makes, including each
 * redirect hop (a redirect is just a new request through the proxy).
 *
 * Rules, in order:
 *   1. the host must be a valid name or IP
 *   2. the port must be allowed (80/443)
 *   3. IP literals must be public
 *   4. names like "localhost" or "*.internal" are refused without a DNS lookup
 *   5. the name is resolved ONCE; if ANY address is private/reserved → refused
 *   6. the caller must connect to exactly the returned address (no second lookup,
 *      so DNS rebinding between "check" and "connect" is impossible)
 * Anything unexpected → refused ("fail closed").
 */
export async function decideEgress(
  rawHost: string,
  port: number,
  policy: EgressPolicy,
  resolve: ResolveFn,
): Promise<EgressDecision> {
  const host = canonicalHost(rawHost);
  const deny = (reason: string, status: 403 | 502 = 403): EgressDecision => ({
    allowed: false,
    host: host ?? rawHost,
    port,
    status,
    reason,
  });

  if (!host) return deny('invalid host');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return deny('invalid port');

  const mapped = policy.testHostMap[host];
  if (mapped) return { allowed: true, host, port, address: mapped };

  if (!policy.allowedPorts.includes(port)) return deny(`port ${port} is not allowed`);

  if (isIP(host)) {
    return isPublicIpAddress(host)
      ? { allowed: true, host, port, address: host }
      : deny('private, loopback or reserved IP address');
  }

  if (host === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return deny('internal host name');
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return deny('DNS lookup failed', 502);
  }
  if (addresses.length === 0) return deny('DNS lookup returned no addresses', 502);

  const blocked = addresses.find((address) => !isPublicIpAddress(address));
  if (blocked) return deny(`resolves to a private or reserved address (${blocked})`);

  // Prefer IPv4 (works in every Docker network); fall back to IPv6.
  const address = addresses.find((a) => isIP(a) === 4) ?? addresses[0]!;
  return { allowed: true, host, port, address };
}
