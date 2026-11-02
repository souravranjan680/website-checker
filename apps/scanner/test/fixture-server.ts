import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const SITES = path.resolve(import.meta.dirname, '../../../tests/fixtures/sites');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.js': 'text/javascript',
};

export interface FixtureServer {
  port: number;
  /** Base URL under the test host name that the egress proxy maps to 127.0.0.1. */
  url: (pathname: string) => string;
  /** How many requests reached /secret (must stay 0: SSRF protection). */
  secretHits: () => number;
  setToggleFixed: (fixed: boolean) => void;
  close: () => Promise<void>;
}

export const FIXTURE_HOST = 'fixtures.whc.test';

export async function startFixtureServer(): Promise<FixtureServer> {
  let secretHits = 0;
  let toggleFixed = false;
  let port = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    const send = (
      status: number,
      body: string,
      type = 'text/html; charset=utf-8',
      extra: Record<string, string> = {},
    ) => res.writeHead(status, { 'content-type': type, ...extra }).end(body);

    switch (url.pathname) {
      case '/secret':
        secretHits += 1;
        return send(200, 'TOP-SECRET internal data', 'text/plain');
      case '/redirect':
        return send(302, '', 'text/plain', { location: '/a11y/page2.html' });
      case '/redirect-to-secret':
        return send(302, '', 'text/plain', { location: `http://127.0.0.1:${port}/secret` });
      case '/robots.txt':
        return send(200, 'User-agent: *\nDisallow: /private/\n', 'text/plain');
      case '/toggle/':
        return send(
          200,
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Toggle</title></head><body><main>
           <h1>Toggle fixture</h1>
           <img src="/a11y/photo.svg" width="60" height="40"${toggleFixed ? ' alt="A blue rectangle"' : ''}>
           <button type="button" class="icon"></button>
           </main></body></html>`,
        );
      case '/slow/':
        setTimeout(() => {
          if (!res.writableEnded)
            send(
              200,
              '<!doctype html><html lang="en"><title>Slow</title><main><h1>Slow</h1></main></html>',
            );
        }, 20_000);
        return;
    }

    let file = path.normalize(path.join(SITES, decodeURIComponent(url.pathname)));
    if (!file.startsWith(SITES)) return send(403, 'forbidden', 'text/plain');
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try {
      let body = await readFile(file, 'utf8');
      body = body.replaceAll('__PORT__', String(port));
      return send(200, body, TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch {
      return send(
        404,
        '<!doctype html><html lang="en"><title>Not found</title><main><h1>Not found</h1></main></html>',
      );
    }
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;

  return {
    port,
    url: (pathname) => `http://${FIXTURE_HOST}:${port}${pathname}`,
    secretHits: () => secretHits,
    setToggleFixed: (fixed) => {
      toggleFixed = fixed;
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
