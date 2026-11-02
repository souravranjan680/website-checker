/**
 * Integration tests: a real proxy server, a real "secret" server on 127.0.0.1,
 * and real HTTP / CONNECT requests through the proxy.
 */
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolveFn } from './policy';
import { BLOCKED_HEADER, createEgressProxy, type DialFn } from './server';

const logs: { msg: string; reason?: string; host?: string }[] = [];
const logger = pino(
  { level: 'debug' },
  { write: (line: string) => void logs.push(JSON.parse(line)) },
);

// A local server that must NEVER be reachable through the proxy (stands in for
// a database admin page, cloud metadata, an intranet app...).
let secret: http.Server;
let secretPort = 0;
let proxy: http.Server;
let proxyPort = 0;

const fakeDns: Record<string, string[]> = {
  'private.example': ['10.0.0.5'],
  'mixed.example': ['93.184.215.14', '127.0.0.1'],
};
const resolve: ResolveFn = async (host) => {
  if (fakeDns[host]) return fakeDns[host]!;
  throw new Error('ENOTFOUND');
};

beforeAll(async () => {
  secret = http.createServer((req, res) => {
    if (req.url === '/redirect-to-secret') {
      res.writeHead(302, { location: `http://127.0.0.1:${secretPort}/secret` }).end();
      return;
    }
    if (req.url === '/redirect-to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`TOP-SECRET host=${req.headers.host}`);
  });
  await new Promise<void>((done) => secret.listen(0, '127.0.0.1', done));
  secretPort = (secret.address() as AddressInfo).port;

  proxy = createEgressProxy({
    policy: { allowedPorts: [80, 443], testHostMap: { 'fixtures.whc.test': '127.0.0.1' } },
    logger,
    resolve,
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((done) => proxy.close(done));
  await new Promise((done) => secret.close(done));
});

/** Sends "GET <absolute url>" to the proxy, like a browser configured with a proxy. */
function getViaProxy(
  url: string,
): Promise<{ status: number; blocked: boolean; body: string; location?: string }> {
  return new Promise((resolveResult, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: url,
        headers: { host: new URL(url).host },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () =>
          resolveResult({
            status: res.statusCode ?? 0,
            blocked: res.headers[BLOCKED_HEADER] === '1',
            body,
            location: res.headers.location,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/** Sends "CONNECT host:port" and returns the proxy's status code. */
function connectViaProxy(authority: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.once('data', (chunk) => {
      resolveStatus(Number(chunk.toString().split(' ')[1]));
      socket.destroy();
    });
    socket.on('error', reject);
  });
}

describe('plain HTTP through the proxy', () => {
  it('forwards allowed requests (test-mapped fixture host)', async () => {
    const res = await getViaProxy(`http://fixtures.whc.test:${secretPort}/page`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(`host=fixtures.whc.test:${secretPort}`); // original Host header kept
  });

  it.each([
    ['loopback IP', () => `http://127.0.0.1:${secretPort}/secret`],
    ['localhost', () => `http://localhost:${secretPort}/secret`],
    ['IPv6 loopback', () => `http://[::1]:${secretPort}/secret`],
    ['IPv4-mapped IPv6', () => `http://[::ffff:127.0.0.1]:${secretPort}/secret`],
    ['hex-encoded loopback', () => `http://0x7f.0.0.1:${secretPort}/secret`],
    ['cloud metadata', () => 'http://169.254.169.254/latest/meta-data/'],
    ['private 10.x', () => 'http://10.0.0.1/'],
    ['private 192.168.x', () => 'http://192.168.0.1/'],
    ['name resolving to private IP', () => 'http://private.example/'],
    ['name resolving to public + loopback', () => 'http://mixed.example/'],
    ['non-standard port', () => 'http://example.com:22/'],
  ])('blocks %s', async (_label, url) => {
    const res = await getViaProxy(url());
    expect(res.status).toBe(403);
    expect(res.blocked).toBe(true);
    expect(res.body).not.toContain('TOP-SECRET');
  });

  it('fails closed with 502 when DNS lookup fails', async () => {
    const res = await getViaProxy('http://does-not-exist.example/');
    expect(res.status).toBe(502);
    expect(res.blocked).toBe(true);
  });

  it('re-checks every redirect hop (redirect-based SSRF)', async () => {
    const first = await getViaProxy(`http://fixtures.whc.test:${secretPort}/redirect-to-secret`);
    expect(first.status).toBe(302);
    // A client following the redirect sends a NEW request through the proxy...
    const second = await getViaProxy(first.location!);
    // ...which is checked like any other and refused.
    expect(second.status).toBe(403);
    expect(second.body).not.toContain('TOP-SECRET');

    const metadataHop = await getViaProxy(
      (await getViaProxy(`http://fixtures.whc.test:${secretPort}/redirect-to-metadata`)).location!,
    );
    expect(metadataHop.status).toBe(403);
  });

  it('logs every blocked request with the reason', async () => {
    logs.length = 0;
    await getViaProxy('http://169.254.169.254/latest/meta-data/');
    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: 'egress blocked',
        host: '169.254.169.254',
        reason: expect.any(String),
      }),
    );
  });

  it('answers its own health check', async () => {
    const res = await new Promise<number>((done) =>
      http.get({ host: '127.0.0.1', port: proxyPort, path: '/healthz' }, (r) =>
        done(r.statusCode ?? 0),
      ),
    );
    expect(res).toBe(200);
  });
});

describe('HTTPS tunnels (CONNECT)', () => {
  it('opens tunnels to allowed hosts', async () => {
    expect(await connectViaProxy(`fixtures.whc.test:${secretPort}`)).toBe(200);
  });

  it.each([
    [() => '127.0.0.1:443'],
    [() => `127.0.0.1:${secretPort}`],
    [() => 'localhost:443'],
    [() => '[::1]:443'],
    [() => '169.254.169.254:443'],
    [() => '10.0.0.1:443'],
    [() => 'private.example:443'],
    [() => 'example.com:22'],
  ])('refuses %s', async (authority) => {
    expect(await connectViaProxy(authority())).toBe(403);
  });
});

describe('DNS rebinding', () => {
  it('resolves once and connects to exactly the address it checked', async () => {
    // Attacker's DNS: first answer public, every later answer 127.0.0.1.
    let lookups = 0;
    const rebindingResolve: ResolveFn = async () =>
      ++lookups === 1 ? ['93.184.215.14'] : ['127.0.0.1'];
    const dial = vi.fn<DialFn>(() => net.connect(secretPort, '127.0.0.1')); // stand-in socket
    const guarded = createEgressProxy({
      policy: { allowedPorts: [443], testHostMap: {} },
      logger,
      resolve: rebindingResolve,
      dial,
    });
    await new Promise<void>((done) => guarded.listen(0, '127.0.0.1', done));
    const port = (guarded.address() as AddressInfo).port;

    const status = await new Promise<number>((done, reject) => {
      const socket = net.connect(port, '127.0.0.1', () =>
        socket.write('CONNECT rebind.example:443 HTTP/1.1\r\nHost: rebind.example:443\r\n\r\n'),
      );
      socket.once('data', (chunk) => {
        done(Number(chunk.toString().split(' ')[1]));
        socket.destroy();
      });
      socket.on('error', reject);
    });
    await new Promise((done) => guarded.close(done));

    expect(status).toBe(200);
    expect(lookups).toBe(1); // no second lookup that could return 127.0.0.1
    expect(dial).toHaveBeenCalledWith(443, '93.184.215.14'); // the checked IP, not the name
  });
});
