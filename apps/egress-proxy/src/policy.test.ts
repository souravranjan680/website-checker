import { describe, expect, it, vi } from 'vitest';
import { canonicalHost, decideEgress, type EgressPolicy, type ResolveFn } from './policy';

const policy: EgressPolicy = { allowedPorts: [80, 443], testHostMap: {} };
const dns: Record<string, string[]> = {
  'example.com': ['93.184.215.14'],
  'dual.example': ['2606:2800:21f:cb07:6820:80da:af6b:8b2c', '93.184.215.14'],
  'private.example': ['10.1.2.3'],
  'mixed.example': ['93.184.215.14', '127.0.0.1'],
  'mapped6.example': ['::ffff:169.254.169.254'],
};
/** Like Node's DNS errors: a code tells "no such name" from a temporary failure. */
const dnsError = (code: string) => Object.assign(new Error(code), { code });
const resolve: ResolveFn = vi.fn(async (host: string) => {
  if (host === 'flaky.example') throw dnsError('EAI_AGAIN');
  const result = dns[host];
  if (!result) throw dnsError('ENOTFOUND');
  return result;
});

describe('canonicalHost', () => {
  it.each([
    ['EXAMPLE.com.', 'example.com'],
    ['0x7f.1', '127.0.0.1'],
    ['2130706433', '127.0.0.1'],
    ['[::1]', '::1'],
  ])('%s → %s', (input, expected) => expect(canonicalHost(input)).toBe(expected));
});

describe('decideEgress', () => {
  it('allows a public host and returns the exact IP to connect to (prefers IPv4)', async () => {
    expect(await decideEgress('example.com', 443, policy, resolve)).toMatchObject({
      allowed: true,
      address: '93.184.215.14',
    });
    expect(await decideEgress('dual.example', 443, policy, resolve)).toMatchObject({
      address: '93.184.215.14',
    });
  });

  it.each([
    ['127.0.0.1', 80],
    ['0x7f.0.0.1', 80],
    ['2130706433', 80],
    ['localhost', 80],
    ['LOCALHOST.', 443],
    ['db.internal', 443],
    ['printer.local', 80],
    ['::1', 443],
    ['[::1]', 443],
    ['::ffff:127.0.0.1', 443],
    ['fd00::1', 443],
    ['fe80::1', 80],
    ['10.0.0.1', 80],
    ['172.16.5.4', 443],
    ['192.168.1.1', 80],
    ['100.64.1.1', 80],
    ['169.254.169.254', 80],
    ['0.0.0.0', 80],
    ['private.example', 443],
    ['mixed.example', 443],
    ['mapped6.example', 80],
  ])('blocks %s:%i', async (host, port) => {
    const decision = await decideEgress(host, port, policy, resolve);
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ status: 403 });
  });

  it('blocks non-standard ports before any DNS lookup', async () => {
    vi.mocked(resolve).mockClear();
    const decision = await decideEgress('example.com', 22, policy, resolve);
    expect(decision).toMatchObject({ allowed: false, reason: 'port 22 is not allowed' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('fails closed when DNS fails, telling "no such domain" from a temporary error', async () => {
    expect(await decideEgress('nope.example', 443, policy, resolve)).toMatchObject({
      allowed: false,
      status: 502,
      code: 'dns-not-found',
    });
    expect(await decideEgress('flaky.example', 443, policy, resolve)).toMatchObject({
      allowed: false,
      status: 503,
      code: 'dns-error',
    });
  });

  it('labels security refusals as policy (403)', async () => {
    expect(await decideEgress('127.0.0.1', 80, policy, resolve)).toMatchObject({
      allowed: false,
      status: 403,
      code: 'policy',
    });
  });

  it('test host map only affects the listed name', async () => {
    const testPolicy = { ...policy, testHostMap: { 'fixtures.whc.test': '127.0.0.1' } };
    expect(await decideEgress('fixtures.whc.test', 51234, testPolicy, resolve)).toMatchObject({
      allowed: true,
      address: '127.0.0.1',
    });
    expect((await decideEgress('127.0.0.1', 51234, testPolicy, resolve)).allowed).toBe(false);
  });
});
