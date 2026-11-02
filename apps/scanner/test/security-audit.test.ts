/**
 * Security configuration rules (pure functions) and the TLS inspector against real
 * local HTTPS servers, reached through the real egress proxy.
 */
import { readFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeSecurityScore,
  cookieSecurityDrafts,
  headerSecurityDrafts,
  mixedContentDrafts,
  parseCsp,
  parseSetCookie,
  transportSecurityDrafts,
  unsafeScriptSources,
  type SecurityPageInput,
  type SiteSecurityFacts,
} from '../src/audits/security';
import { describeCertificateError, inspectCertificate, type TlsFacts } from '../src/audits/tls';
import { FIXTURE_HOST } from './fixture-server';
import { startTestProxy } from './helpers';

const START = 'https://shop.example/';
const SECURE_HEADERS = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function page(overrides: Partial<SecurityPageInput> = {}): SecurityPageInput {
  return {
    scanPageId: 'p1',
    url: START,
    headers: SECURE_HEADERS,
    cookies: [],
    insecureReferences: [],
    ...overrides,
  };
}
const checks = (list: { draft: { security?: { checkType: string; findingLevel: string } } }[]) =>
  list.map((d) => `${d.draft.security!.checkType}:${d.draft.security!.findingLevel}`);

describe('headers', () => {
  it('reports nothing for a well-configured https site', () => {
    expect(headerSecurityDrafts('w1', START, [page()], true)).toEqual([]);
  });

  it('reports each missing header once for the whole site, listing affected pages', () => {
    const pages = [
      page({ scanPageId: 'a', url: `${START}a`, headers: {} }),
      page({ scanPageId: 'b', url: `${START}b`, headers: {} }),
      page({ scanPageId: 'c', url: `${START}c` }),
    ];
    const drafts = headerSecurityDrafts('w1', START, pages, true);
    expect(checks(drafts)).toEqual([
      'MISSING_CSP:WARNING',
      'MISSING_FRAME_PROTECTION:WARNING',
      'MISSING_X_CONTENT_TYPE_OPTIONS:WARNING',
      'MISSING_REFERRER_POLICY:OBSERVATION',
      'MISSING_HSTS:WARNING',
    ]);
    expect(drafts[0]!.draft.description).toContain('2 of 3 scanned pages');
    expect(drafts[0]!.draft.details).toMatchObject({ pages: [`${START}a`, `${START}b`] });
    expect(drafts[0]!.scanPageId).toBe('a');
  });

  it('does not ask for HSTS on plain-http sites', () => {
    const drafts = headerSecurityDrafts(
      'w1',
      'http://shop.example/',
      [page({ headers: {} })],
      false,
    );
    expect(checks(drafts)).not.toContain('MISSING_HSTS:WARNING');
  });

  it('accepts X-Frame-Options instead of frame-ancestors, and flags short HSTS', () => {
    const drafts = headerSecurityDrafts(
      'w1',
      START,
      [
        page({
          headers: {
            ...SECURE_HEADERS,
            'content-security-policy': "default-src 'self'",
            'x-frame-options': 'DENY',
            'strict-transport-security': 'max-age=3600',
          },
        }),
      ],
      true,
    );
    expect(checks(drafts)).toEqual(['MISSING_HSTS:OBSERVATION']);
  });

  it('flags unsafe CSP sources (but unsafe-inline next to a nonce is ignored by browsers)', () => {
    expect(
      unsafeScriptSources(parseCsp("script-src 'self' 'unsafe-inline' 'unsafe-eval'")),
    ).toEqual(["'unsafe-inline'", "'unsafe-eval'"]);
    expect(unsafeScriptSources(parseCsp("script-src 'self' 'nonce-abc' 'unsafe-inline'"))).toEqual(
      [],
    );
    expect(unsafeScriptSources(parseCsp('default-src *'))).toEqual(['*']);
    expect(unsafeScriptSources(parseCsp("img-src *; script-src 'self'"))).toEqual([]);
    const drafts = headerSecurityDrafts(
      'w1',
      START,
      [
        page({
          headers: {
            ...SECURE_HEADERS,
            'content-security-policy': "default-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
          },
        }),
      ],
      true,
    );
    expect(checks(drafts)).toEqual(['WEAK_CSP:OBSERVATION']);
  });

  it('reports software versions as an observation, not a vulnerability', () => {
    const drafts = headerSecurityDrafts(
      'w1',
      START,
      [
        page({
          headers: { ...SECURE_HEADERS, server: 'nginx/1.18.0', 'x-powered-by': 'PHP/8.1.2' },
        }),
      ],
      true,
    );
    expect(checks(drafts)).toEqual(['VERSION_DISCLOSURE:OBSERVATION']);
    expect(drafts[0]!.draft.security!.observedValue).toContain('nginx/1.18.0');
    // A product name without a version is not reported.
    expect(
      headerSecurityDrafts(
        'w1',
        START,
        [page({ headers: { ...SECURE_HEADERS, server: 'cloudflare' } })],
        true,
      ),
    ).toEqual([]);
  });
});

describe('cookies', () => {
  it('parses Set-Cookie into name and flags, never keeping the value', () => {
    const parsed = parseSetCookie('session=s3cr3t-token; Path=/; HttpOnly; SameSite=Lax');
    expect(parsed).toEqual({ name: 'session', secure: false, httpOnly: true, sameSite: 'lax' });
    expect(JSON.stringify(parsed)).not.toContain('s3cr3t');
    expect(parseSetCookie('=nameless')).toBeNull();
  });

  it('warns about missing Secure on https, observes missing HttpOnly/SameSite', () => {
    const cookies = [
      parseSetCookie('session=x; Path=/; HttpOnly; SameSite=Lax')!,
      parseSetCookie('prefs=y; Secure')!,
      parseSetCookie('ok=z; Secure; HttpOnly; SameSite=Strict')!,
    ];
    const drafts = cookieSecurityDrafts('w1', START, [page({ cookies })], true);
    expect(checks(drafts)).toEqual(['INSECURE_COOKIE:WARNING', 'INSECURE_COOKIE:OBSERVATION']);
    expect(drafts[0]!.draft.description).toContain('"session"');
    expect(drafts[0]!.draft.security!.observedValue).toBe('session=…; HttpOnly; SameSite=lax');
    expect(JSON.stringify(drafts)).not.toMatch(/=x;|=y;/);
  });
});

describe('mixed content', () => {
  it('separates confirmed active mixed content and insecure forms from passive media', () => {
    const drafts = mixedContentDrafts('w1', [
      page({
        insecureReferences: [
          { kind: 'active', tag: 'script', url: 'http://cdn.example/app.js', selector: 'script' },
          { kind: 'passive', tag: 'img', url: 'http://cdn.example/a.png', selector: 'img' },
          { kind: 'form', tag: 'form', url: 'http://shop.example/login', selector: 'form' },
        ],
      }),
    ]);
    expect(checks(drafts)).toEqual([
      'MIXED_CONTENT:CONFIRMED',
      'MIXED_CONTENT:WARNING',
      'INSECURE_FORM:CONFIRMED',
    ]);
    expect(drafts.map((d) => d.draft.severity)).toEqual(['HIGH', 'LOW', 'HIGH']);
    expect(new Set(drafts.map((d) => d.draft.fingerprint)).size).toBe(3);
  });
});

const tlsFacts = (overrides: Partial<TlsFacts>): TlsFacts => ({
  host: 'shop.example',
  port: 443,
  checked: true,
  valid: true,
  error: null,
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  daysRemaining: 200,
  issuer: 'Test CA',
  subject: 'shop.example',
  protocol: 'TLSv1.3',
  ...overrides,
});

describe('transport (HTTPS, certificate, redirect)', () => {
  const facts = (overrides: Partial<SiteSecurityFacts>): SiteSecurityFacts => ({
    servedOverHttps: true,
    tls: tlsFacts({}),
    httpRedirect: {
      url: 'http://shop.example/',
      status: 301,
      location: START,
      redirectsToHttps: true,
    },
    ...overrides,
  });

  it('is quiet for a valid certificate and a working redirect', () => {
    expect(transportSecurityDrafts('w1', START, facts({}))).toEqual([]);
  });

  it('confirms an invalid certificate and warns about one expiring soon', () => {
    expect(
      checks(
        transportSecurityDrafts(
          'w1',
          START,
          facts({ tls: tlsFacts({ valid: false, error: 'CERT_HAS_EXPIRED' }) }),
        ),
      ),
    ).toEqual(['INVALID_CERTIFICATE:CONFIRMED']);
    expect(
      checks(transportSecurityDrafts('w1', START, facts({ tls: tlsFacts({ daysRemaining: 5 }) }))),
    ).toEqual(['CERTIFICATE_EXPIRING:WARNING']);
  });

  it('warns when http:// answers without redirecting; no response at all is fine', () => {
    expect(
      checks(
        transportSecurityDrafts(
          'w1',
          START,
          facts({
            httpRedirect: {
              url: 'http://shop.example/',
              status: 200,
              location: null,
              redirectsToHttps: false,
            },
          }),
        ),
      ),
    ).toEqual(['HTTP_NOT_REDIRECTED:WARNING']);
    expect(
      transportSecurityDrafts(
        'w1',
        START,
        facts({
          httpRedirect: {
            url: 'http://shop.example/',
            status: null,
            location: null,
            redirectsToHttps: null,
          },
        }),
      ),
    ).toEqual([]);
  });

  it('confirms NO_HTTPS only when https really cannot be reached', () => {
    const http = 'http://shop.example/';
    expect(
      checks(
        transportSecurityDrafts(
          'w1',
          http,
          facts({
            servedOverHttps: false,
            tls: tlsFacts({ checked: false, valid: false, error: 'PROXY_502' }),
            httpRedirect: null,
          }),
        ),
      ),
    ).toEqual(['NO_HTTPS:CONFIRMED']);
    expect(
      checks(
        transportSecurityDrafts('w1', http, facts({ servedOverHttps: false, httpRedirect: null })),
      ),
    ).toEqual(['HTTP_NOT_REDIRECTED:WARNING']);
  });
});

describe('score', () => {
  it('subtracts each failed check once', () => {
    expect(computeSecurityScore([])).toBe(100);
    expect(
      computeSecurityScore([
        { checkType: 'MISSING_CSP' },
        { checkType: 'MISSING_CSP' },
        { checkType: 'MISSING_HSTS' },
      ]),
    ).toBe(75);
    expect(
      computeSecurityScore([
        { checkType: 'NO_HTTPS' },
        { checkType: 'INVALID_CERTIFICATE' },
        { checkType: 'INSECURE_FORM' },
        { checkType: 'MISSING_CSP' },
      ]),
    ).toBe(0);
  });
});

describe('inspectCertificate (real TLS through the egress proxy)', () => {
  const tlsDir = path.resolve(import.meta.dirname, '../../../tests/fixtures/tls');
  const servers: https.Server[] = [];
  let proxy: Awaited<ReturnType<typeof startTestProxy>>;

  async function httpsServer(name: string): Promise<number> {
    const server = https.createServer(
      {
        key: readFileSync(path.join(tlsDir, `${name}.key`)),
        cert: readFileSync(path.join(tlsDir, `${name}.crt`)),
      },
      (_req, res) => res.end('ok'),
    );
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return (server.address() as AddressInfo).port;
  }

  beforeAll(async () => {
    proxy = await startTestProxy();
  });
  afterAll(async () => {
    await proxy.close();
    await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
  });

  it('reads a self-signed certificate and reports it as untrusted', async () => {
    const port = await httpsServer('self-signed');
    const facts = await inspectCertificate(proxy.url, FIXTURE_HOST, port);
    expect(facts).toMatchObject({
      checked: true,
      valid: false,
      error: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      subject: FIXTURE_HOST,
    });
    expect(facts.daysRemaining).toBeGreaterThan(36_000);
    expect(describeCertificateError(facts.error)).toContain('self-signed');
  });

  it('reports an expired certificate', async () => {
    const port = await httpsServer('expired');
    const facts = await inspectCertificate(proxy.url, FIXTURE_HOST, port);
    expect(facts).toMatchObject({ checked: true, valid: false, error: 'CERT_HAS_EXPIRED' });
    expect(facts.daysRemaining).toBeLessThan(0);
  });

  it('cannot be used to reach internal addresses: the proxy refuses the tunnel', async () => {
    const port = await httpsServer('self-signed');
    const facts = await inspectCertificate(proxy.url, '127.0.0.1', port);
    expect(facts).toMatchObject({ checked: false, valid: false, error: 'PROXY_403' });
  });

  it('times out instead of hanging', async () => {
    const facts = await inspectCertificate('http://10.255.255.1:3128', FIXTURE_HOST, 443, {
      timeoutMs: 300,
    });
    expect(facts.checked).toBe(false);
    expect(['TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNREFUSED']).toContain(facts.error);
  });
});
