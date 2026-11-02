/**
 * IP address classification used for SSRF protection (docs/05-security.md).
 * "Public" means a normal internet address. Everything else (loopback, private
 * networks, link-local/cloud-metadata, multicast, documentation ranges, ...) is blocked.
 * Pure functions with no Node APIs, so the browser, API and scanner can all use them.
 */

type IPv4 = [number, number, number, number];

/** Parses a dotted-decimal IPv4 address ("192.168.1.1"), or returns null. */
export function parseIPv4(address: string): IPv4 | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((n) => Number.isNaN(n) || n > 255)) return null;
  return numbers as IPv4;
}

function ipv4ToInt([a, b, c, d]: IPv4): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

// [network, prefix length]. Source: IANA special-purpose address registry.
const BLOCKED_IPV4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast 255.255.255.255
];

export function isPublicIPv4(address: string): boolean {
  const parsed = parseIPv4(address);
  if (!parsed) return false;
  const value = ipv4ToInt(parsed);
  return !BLOCKED_IPV4_RANGES.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (ipv4ToInt(parseIPv4(network)!) & mask) >>> 0;
  });
}

/** Parses an IPv6 address into 8 16-bit groups, or returns null. Handles "::" and "::ffff:1.2.3.4". */
export function parseIPv6(address: string): number[] | null {
  let value = address.toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zoneIndex = value.indexOf('%');
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex);

  // Replace a trailing dotted IPv4 part with two hex groups.
  const lastColon = value.lastIndexOf(':');
  const lastPart = value.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const v4 = parseIPv4(lastPart);
    if (!v4) return null;
    value = `${value.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const numbers = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  return numbers.some(Number.isNaN) ? null : numbers;
}

function embeddedIPv4(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPublicIPv6(address: string): boolean {
  const g = parseIPv6(address);
  if (!g) return false;
  const [g0 = 0, g1 = 0, g2 = 0, , , g5 = 0, g6 = 0, g7 = 0] = g;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  if (zero(0, 8)) return false; // ::
  if (zero(0, 7) && g7 === 1) return false; // ::1 loopback
  // IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible (::a.b.c.d): judge the IPv4 inside.
  if (zero(0, 5) && (g5 === 0xffff || g5 === 0)) return isPublicIPv4(embeddedIPv4(g6, g7));
  // NAT64 64:ff9b::/96 also wraps an IPv4 address.
  if (g0 === 0x64 && g1 === 0xff9b && zero(2, 6)) return isPublicIPv4(embeddedIPv4(g6, g7));
  // 6to4 2002::/16 wraps an IPv4 address in groups 1-2.
  if (g0 === 0x2002) return isPublicIPv4(embeddedIPv4(g1, g2));
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo tunnelling
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  // Only global unicast (2000::/3) is public; this excludes fc00::/7, fe80::/10, ff00::/8, ...
  return (g0 & 0xe000) === 0x2000;
}

/** True for a normal public internet address (IPv4 or IPv6). */
export function isPublicIpAddress(address: string): boolean {
  return address.includes(':') ? isPublicIPv6(address) : isPublicIPv4(address);
}
