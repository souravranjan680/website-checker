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

/**
 * Real font files for the font and icon fixtures (Phase 9, Milestone 2), served from
 * installed packages instead of copying third-party binaries into the repository:
 * Geist (SIL Open Font License) and Codicon, an icon font whose glyphs are in the
 * Private Use Area (shipped with Playwright).
 */
const GEIST =
  '../../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2';
const VENDOR_FONTS: Record<string, { file: string; type: string }> = {
  'text.woff2': { file: GEIST, type: 'font/woff2' },
  'icons.ttf': {
    file: '../../../node_modules/playwright-core/lib/vite/recorder/assets/codicon-DCmgc-ay.ttf',
    type: 'font/ttf',
  },
};

/**
 * Seeded page vs corrected twin: "{{a|b}}" in a fixture serves "a" on the seeded page
 * and "b" on its twin (for differences CSS alone cannot switch, such as URLs).
 */
const variant = (body: string, fixed: boolean) =>
  body.replace(/\{\{([^{}|]*)\|([^{}|]*)\}\}/g, (_m, seeded: string, twin: string) =>
    fixed ? twin : seeded,
  );

export interface FixtureServer {
  port: number;
  /** Base URL under the test host name that the egress proxy maps to 127.0.0.1. */
  url: (pathname: string) => string;
  /** How many requests reached /secret (must stay 0: SSRF protection). */
  secretHits: () => number;
  /**
   * Safety counters for the explorer (Phase 9): every request that is not
   * GET/HEAD/OPTIONS, every request to /trap/*, and every WebSocket upgrade.
   * All must stay empty: fixture pages wire destructive actions to these.
   */
  safetyHits: () => { writes: string[]; traps: string[]; websockets: string[] };
  resetSafetyHits: () => void;
  setToggleFixed: (fixed: boolean) => void;
  /** /visual/ shows a big banner when true (a real visual change). */
  setVisualChanged: (changed: boolean) => void;
  close: () => Promise<void>;
}

export const FIXTURE_HOST = 'fixtures.whc.test';
/** Stands in for Storyblok's content API (test proxy only; never contacted for real). */
export const STORYBLOK_HOST = 'api.storyblok.com';
/** A third-party widget script host. */
export const THIRD_PARTY_HOST = 'widgets.thirdparty-cdn.test';

export async function startFixtureServer(): Promise<FixtureServer> {
  let secretHits = 0;
  const safety = { writes: [] as string[], traps: [] as string[], websockets: [] as string[] };
  let toggleFixed = false;
  let visualChanged = false;
  let timingRequests = 0;
  let port = 0;

  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) {
      safety.writes.push(`${req.method} ${req.url}`);
    }
    if ((req.url ?? '').startsWith('/trap/')) {
      safety.traps.push(`${req.method} ${req.url}`);
      return void res.writeHead(200, { 'content-type': 'text/plain' }).end('trap');
    }
    const url = new URL(req.url ?? '/', 'http://fixture');
    const send = (
      status: number,
      body: string,
      type = 'text/html; charset=utf-8',
      extra: Record<string, string> = {},
    ) => res.writeHead(status, { 'content-type': type, ...extra }).end(body);

    // Other "websites" (third-party services), mapped to this server by the test proxy.
    const host = (req.headers.host ?? '').split(':')[0];
    if (host === STORYBLOK_HOST) {
      // The Storyblok content API without a valid access token.
      return send(401, '{"error":"Unauthorized"}', 'application/json', {
        'access-control-allow-origin': '*',
      });
    }
    if (host === THIRD_PARTY_HOST) {
      return send(
        200,
        "window.addEventListener('load', () => { throw new Error('Widget failed to initialise'); });\n",
        'text/javascript',
      );
    }

    switch (url.pathname) {
      case '/resources/flaky.png':
        // Fails in the browser (connection cut mid-file), loads fine for the re-check:
        // the "net::ERR_FAILED but not actually broken" case.
        if ((req.headers['user-agent'] ?? '').includes('Chrome')) {
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': '5000' });
          res.write(Buffer.alloc(16));
          setTimeout(() => res.socket?.destroy(), 20);
          return;
        }
        return res
          .writeHead(200, { 'content-type': 'image/svg+xml' })
          .end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
      case '/compat/timing.js':
        // Throws on the third request only (see tests/fixtures/sites/compat/timing.html).
        timingRequests += 1;
        return send(
          200,
          timingRequests === 3
            ? "throw new Error('Timing control: fails once');\n"
            : "document.documentElement.dataset.timing = 'ok';\n",
          'text/javascript',
        );
      case '/resources/not-an-image.png':
        // Downloads fine, but it is an HTML error page served with 200: a real broken image.
        return send(200, '<!doctype html><title>Oops</title><p>Image moved</p>');
      case '/resources/always-500':
        return send(500, 'Internal Server Error', 'text/plain');
      case '/secret':
        secretHits += 1;
        return send(200, 'TOP-SECRET internal data', 'text/plain');
      case '/redirect':
        return send(302, '', 'text/plain', { location: '/a11y/page2.html' });
      case '/redirect-to-secret':
        return send(302, '', 'text/plain', { location: `http://127.0.0.1:${port}/secret` });
      case '/robots.txt':
        return send(
          200,
          `User-agent: *\nDisallow: /private/\nSitemap: http://${FIXTURE_HOST}:${port}/sitemap.xml\n`,
          'text/plain',
        );
      case '/sitemap.xml':
        return send(
          200,
          '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/seo/</loc></url></urlset>',
          'application/xml',
        );
      case '/security/':
        // Weak configuration on purpose; the cookie value must never be stored.
        res.setHeader('set-cookie', [
          'session=SECRET-SESSION-VALUE-123; Path=/',
          'theme=dark; Path=/; SameSite=Lax',
        ]);
        return send(
          200,
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Security fixture page</title></head><body><main><h1>Security</h1></main></body></html>',
          'text/html; charset=utf-8',
          { server: 'Apache/2.4.41 (Ubuntu)', 'x-powered-by': 'PHP/7.4.3' },
        );
      case '/perf/':
        // A render-blocking script that keeps the main thread busy: poor TBT, slow LCP.
        return send(
          200,
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Performance fixture page</title><script src="/perf/heavy.js"></script></head><body><main><h1>Performance fixture</h1><p>Text.</p></main></body></html>',
        );
      case '/perf/heavy.js':
        return send(
          200,
          `/* ${'unused padding '.repeat(20_000)} */\nconst until = Date.now() + 700; while (Date.now() < until) {}\n`,
          'text/javascript',
        );
      case '/visual/':
        return send(
          200,
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visual fixture page</title>
           <style>body{margin:0;font-family:sans-serif} .hero{height:300px;background:#2a78d6;color:#fff;padding:24px}
           .banner{height:200px;background:#eb6834} .clock{padding:8px}</style></head><body><main>
           <div class="hero"><h1>Visual fixture</h1></div>
           ${visualChanged ? '<div class="banner">New promotion banner</div>' : ''}
           <p class="clock">Rendered at ${Date.now()}</p>
           <p>Stable text paragraph.</p></main></body></html>`,
        );
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

    // Corrected twin (Phase 9): the same page with its seeded defects switched off.
    const twin = /^\/([\w-]+)\/fixed\.html$/.exec(url.pathname);
    if (twin) {
      try {
        const body = await readFile(path.join(SITES, twin[1]!, 'index.html'), 'utf8');
        return send(
          200,
          variant(body, true)
            .replaceAll('__PORT__', String(port))
            .replace('<body data-variant="seeded">', '<body data-variant="fixed">'),
        );
      } catch {
        /* no such site: fall through to the 404 below */
      }
    }
    const vendor = /^\/vendor-fonts\/([\w.-]+)$/.exec(url.pathname);
    if (vendor && VENDOR_FONTS[vendor[1]!]) {
      const font = VENDOR_FONTS[vendor[1]!]!;
      const data = await readFile(path.resolve(import.meta.dirname, font.file));
      return void res.writeHead(200, { 'content-type': font.type }).end(data);
    }
    let file = path.normalize(path.join(SITES, decodeURIComponent(url.pathname)));
    if (!file.startsWith(SITES)) return send(403, 'forbidden', 'text/plain');
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try {
      let body = await readFile(file, 'utf8');
      // "?fixed" serves the corrected variant of any page (subpages of a twin).
      const fixed = url.searchParams.has('fixed');
      body = variant(body, fixed).replaceAll('__PORT__', String(port));
      if (fixed) body = body.replace('<body data-variant="seeded">', '<body data-variant="fixed">');
      return send(200, body, TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch {
      return send(
        404,
        '<!doctype html><html lang="en"><title>Not found</title><main><h1>Not found</h1></main></html>',
      );
    }
  });

  server.on('upgrade', (req, socket) => {
    safety.websockets.push(req.url ?? '');
    socket.destroy();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;

  return {
    port,
    url: (pathname) => `http://${FIXTURE_HOST}:${port}${pathname}`,
    secretHits: () => secretHits,
    safetyHits: () => ({
      writes: [...safety.writes],
      traps: [...safety.traps],
      websockets: [...safety.websockets],
    }),
    resetSafetyHits: () => {
      safety.writes.length = 0;
      safety.traps.length = 0;
      safety.websockets.length = 0;
      timingRequests = 0;
    },
    setVisualChanged: (changed) => {
      visualChanged = changed;
    },
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
