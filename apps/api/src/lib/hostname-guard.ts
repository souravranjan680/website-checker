import { lookup } from 'node:dns/promises';
import { isPublicIpAddress } from '@whc/shared';
import { AppError } from './errors';

/** Returns every IP address a hostname resolves to. Replaceable in tests. */
export type ResolveHostname = (hostname: string) => Promise<string[]>;

export const systemResolveHostname: ResolveHostname = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Layer 2 of SSRF protection: a public-looking name like "my-site.example" could
 * still point at 127.0.0.1 or 10.x. We resolve it and reject the website if ANY of
 * its addresses is private or reserved.
 * (The scanner re-checks every request through the egress proxy in Phase 4, which
 * also covers DNS changes after this check.)
 */
export async function assertPublicHostname(
  hostname: string,
  resolve: ResolveHostname,
): Promise<void> {
  // IP literals were already checked by normalizeWebsiteUrl().
  if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) return;

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    throw new AppError(
      400,
      'UNRESOLVABLE_HOST',
      `Could not find a website at "${hostname}". Check the address.`,
      [{ path: 'baseUrl', message: `Could not find a website at "${hostname}".` }],
    );
  }
  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new AppError(
      400,
      'UNSAFE_URL',
      `"${hostname}" points to a private or internal network address.`,
      [{ path: 'baseUrl', message: 'This address points to a private or internal network.' }],
    );
  }
}
