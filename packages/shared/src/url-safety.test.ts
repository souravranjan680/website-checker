import { describe, expect, it } from 'vitest';
import { isPublicIpAddress } from './ip';
import { normalizeWebsiteUrl } from './url-safety';

describe('normalizeWebsiteUrl: accepted', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['example.com', 'https://example.com/'],
    ['HTTP://Example.COM/Shop?x=1#top', 'http://example.com/Shop?x=1'],
    ['https://example.com.', 'https://example.com/'],
    ['https://example.com:443/', 'https://example.com/'],
    ['https://bücher.de', 'https://xn--bcher-kva.de/'],
    ['https://93.184.215.14', 'https://93.184.215.14/'],
  ])('%s → %s', (input, expected) => {
    const result = normalizeWebsiteUrl(input);
    expect(result).toMatchObject({ ok: true, url: expected });
  });
});

describe('normalizeWebsiteUrl: rejected (SSRF bypass attempts and bad input)', () => {
  it.each([
    ['', 'empty'],
    ['not a url at all', 'garbage'],
    ['ftp://example.com', 'non-http scheme'],
    ['file:///etc/passwd', 'file scheme'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['http://localhost', 'localhost'],
    ['http://localhost.', 'localhost with trailing dot'],
    ['http://LOCALHOST:80', 'uppercase localhost'],
    ['http://app.localhost', '*.localhost'],
    ['http://printer.local', 'mDNS .local'],
    ['http://db.internal', '.internal'],
    ['http://intranet', 'single-label host'],
    ['http://127.0.0.1', 'loopback'],
    ['http://127.1', 'short loopback form'],
    ['http://2130706433', 'decimal loopback'],
    ['http://0x7f.0.0.1', 'hex loopback'],
    ['http://0177.0.0.1', 'octal loopback'],
    ['http://0.0.0.0', 'unspecified'],
    ['http://10.1.2.3', 'private 10/8'],
    ['http://172.20.0.5', 'private 172.16/12'],
    ['http://192.168.1.1', 'private 192.168/16'],
    ['http://169.254.169.254/latest/meta-data', 'cloud metadata'],
    ['http://100.64.0.1', 'carrier-grade NAT'],
    ['http://[::1]', 'IPv6 loopback'],
    ['http://[::ffff:127.0.0.1]', 'IPv4-mapped loopback'],
    ['http://[fd00::1]', 'IPv6 unique-local'],
    ['http://[fe80::1]', 'IPv6 link-local'],
    ['https://user:pass@example.com', 'embedded credentials'],
    ['https://example.com@127.0.0.1', 'credential confusion'],
    ['https://example.com:8080', 'non-standard port'],
    ['http://example.com:22', 'ssh port'],
  ])('%s (%s)', (input) => {
    expect(normalizeWebsiteUrl(input).ok).toBe(false);
  });
});

describe('isPublicIpAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['93.184.215.14', true],
    ['2606:4700:4700::1111', true],
    ['127.0.0.1', false],
    ['10.0.0.1', false],
    ['172.31.255.255', false],
    ['172.32.0.1', true],
    ['192.168.0.1', false],
    ['169.254.169.254', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['::', false],
    ['::1', false],
    ['::ffff:10.0.0.1', false],
    ['::ffff:8.8.8.8', true],
    ['64:ff9b::7f00:1', false],
    ['2002:7f00:1::', false],
    ['2001:db8::1', false],
    ['fc00::1', false],
    ['fe80::1%eth0', false],
    ['ff02::1', false],
    ['not-an-ip', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected);
  });
});
