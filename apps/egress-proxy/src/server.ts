import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net, { type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import { EGRESS_BLOCKED_HEADER, EGRESS_REASON_HEADER, EGRESS_REASONS } from '@whc/shared';
import { decideEgress, systemResolve, type EgressPolicy, type ResolveFn } from './policy';

/** Opens a TCP connection to an (already approved) IP address. Replaceable in tests. */
export type DialFn = (port: number, address: string) => Socket;
const systemDial: DialFn = (port, address) => net.connect({ port, host: address });

export interface EgressProxyOptions {
  policy: EgressPolicy;
  logger: Logger;
  resolve?: ResolveFn;
  dial?: DialFn;
  /** Max time to open the upstream connection. */
  connectTimeoutMs?: number;
  /** Connections with no traffic for this long are closed. */
  idleTimeoutMs?: number;
}

/** Response header that marks "refused by our policy" (vs. the target site failing). */
export const BLOCKED_HEADER = EGRESS_BLOCKED_HEADER;
const STATUS_TEXT: Record<number, string> = {
  403: 'Forbidden',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

// Headers that only concern the hop between client and proxy; never forwarded.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * A small HTTP forward proxy (the "egress guard"). The scanner's Chromium and its
 * link checker send ALL traffic here:
 *   - plain http:  "GET http://site/page HTTP/1.1"  → handled in onRequest
 *   - https:       "CONNECT site:443"               → handled in onConnect (a tunnel;
 *                  TLS stays end-to-end between the browser and the site)
 * Every request is checked by decideEgress() before any connection is opened.
 */
export function createEgressProxy(options: EgressProxyOptions): http.Server {
  const { policy, logger } = options;
  const resolve = options.resolve ?? systemResolve;
  const dial = options.dial ?? systemDial;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;

  const server = http.createServer((req, res) => {
    void onRequest(req, res).catch((error: unknown) => {
      logger.error({ err: error }, 'proxy request handler failed');
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
  });

  server.on('connect', (req: IncomingMessage, client: Duplex, head: Buffer) => {
    void onConnect(req, client as Socket, head).catch((error: unknown) => {
      logger.error({ err: error }, 'proxy CONNECT handler failed');
      client.destroy();
    });
  });

  // Plain HTTP (absolute-form request: "GET http://example.com/ HTTP/1.1").
  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Only proxy requests are accepted');
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Unsupported protocol');
      return;
    }

    const port = Number(target.port || 80);
    const decision = await decideEgress(target.hostname, port, policy, resolve);
    if (!decision.allowed) {
      logger.warn(
        { host: decision.host, port, reason: decision.reason, method: req.method },
        'egress blocked',
      );
      res
        .writeHead(decision.status, {
          'content-type': 'text/plain',
          [BLOCKED_HEADER]: '1',
          [EGRESS_REASON_HEADER]: decision.code,
        })
        .end(`Blocked by egress policy: ${decision.reason}`);
      return;
    }
    logger.debug({ host: decision.host, port, address: decision.address }, 'egress allowed (http)');

    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
    }

    const upstream = http.request({
      // Connect to the exact address that was checked. No second DNS lookup.
      host: decision.address,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers, // keeps the original Host header, so virtual hosting still works
      setHost: false,
      timeout: connectTimeoutMs,
    });
    upstream.on('response', (upstreamRes) => {
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) responseHeaders[name] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      // The site may cut the body off mid-way; pass that on as a broken response.
      upstreamRes.on('error', () => res.destroy());
      upstreamRes.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', (error) => {
      logger.info({ host: decision.host, err: error.message }, 'upstream http error');
      // The site could not be reached (refused, reset, timeout): not a policy decision.
      if (!res.headersSent)
        res
          .writeHead(EGRESS_REASONS.unreachable, {
            'content-type': 'text/plain',
            [EGRESS_REASON_HEADER]: 'unreachable',
          })
          .end('Upstream unreachable');
      else res.destroy();
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  // HTTPS / WebSocket tunnels ("CONNECT example.com:443").
  async function onConnect(req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    client.on('error', () => client.destroy());
    const authority = req.url ?? '';
    const separator = authority.lastIndexOf(':');
    const host = separator > 0 ? authority.slice(0, separator) : authority;
    const port = Number(separator > 0 ? authority.slice(separator + 1) : NaN);

    const decision = await decideEgress(host, port, policy, resolve);
    if (!decision.allowed) {
      logger.warn(
        { host: decision.host, port, reason: decision.reason, method: 'CONNECT' },
        'egress blocked',
      );
      client.end(
        `HTTP/1.1 ${decision.status} ${STATUS_TEXT[decision.status] ?? 'Bad Gateway'}\r\n` +
          `${BLOCKED_HEADER}: 1\r\n${EGRESS_REASON_HEADER}: ${decision.code}\r\n` +
          'content-length: 0\r\nconnection: close\r\n\r\n',
      );
      return;
    }
    logger.debug(
      { host: decision.host, port, address: decision.address },
      'egress allowed (tunnel)',
    );

    const upstream = dial(port, decision.address);
    const connectTimer = setTimeout(
      () => upstream.destroy(new Error('connect timeout')),
      connectTimeoutMs,
    );

    upstream.once('connect', () => {
      clearTimeout(connectTimer);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
      upstream.setTimeout(idleTimeoutMs, () => upstream.destroy());
      client.setTimeout(idleTimeoutMs, () => client.destroy());
    });
    upstream.on('error', (error) => {
      clearTimeout(connectTimer);
      logger.info({ host: decision.host, err: error.message }, 'upstream tunnel error');
      // The site could not be reached (refused, reset, timeout): not a policy decision.
      if (client.writable)
        client.end(
          `HTTP/1.1 ${EGRESS_REASONS.unreachable} Gateway Timeout\r\n` +
            `${EGRESS_REASON_HEADER}: unreachable\r\nconnection: close\r\n\r\n`,
        );
      client.destroy();
    });
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
  }

  return server;
}
