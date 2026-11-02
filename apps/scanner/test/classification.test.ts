/** Unit tests: resource failure verdicts and console message classification. */
import { describe, expect, it } from 'vitest';
import { classifyResourceFailure } from '../src/audits/resource-check';
import type { FailedRequest, PageNetworkLog } from '../src/checks/collectors';
import { firstStackFrame } from '../src/checks/collectors';
import {
  classifyConsoleMessage,
  classifyPageConsole,
  normalizeMessage,
  serviceDomain,
} from '../src/checks/console-classify';
import { verifyPageResources } from '../src/checks/verify-resources';

describe('classifyResourceFailure', () => {
  it('does not confirm net::ERR_FAILED on its own', () => {
    expect(classifyResourceFailure({ error: 'net::ERR_FAILED' }, null).verdict).toBe(
      'INCONCLUSIVE',
    );
    expect(
      classifyResourceFailure(
        { error: 'net::ERR_FAILED' },
        { kind: 'ok', status: 200, contentType: 'image/png' },
      ).verdict,
    ).toBe('INCONCLUSIVE');
    expect(classifyResourceFailure({ error: 'net::ERR_FAILED' }, { kind: 'timeout' }).verdict).toBe(
      'INCONCLUSIVE',
    );
    expect(
      classifyResourceFailure({ error: 'net::ERR_FAILED' }, { kind: 'unreachable' }).verdict,
    ).toBe('INCONCLUSIVE');
    expect(
      classifyResourceFailure({ error: 'net::ERR_FAILED' }, { kind: 'dns-error' }).verdict,
    ).toBe('INCONCLUSIVE');
  });

  it('confirms ERR_FAILED when the re-check gets the site’s own error answer', () => {
    const result = classifyResourceFailure(
      { error: 'net::ERR_FAILED' },
      { kind: 'http-error', status: 404 },
    );
    expect(result).toMatchObject({ verdict: 'CONFIRMED', status: 404 });
  });

  it('confirms missing domains, invalid certificates and responses the browser refuses', () => {
    expect(
      classifyResourceFailure(
        { error: 'net::ERR_TUNNEL_CONNECTION_FAILED' },
        { kind: 'dns-not-found' },
      ).verdict,
    ).toBe('CONFIRMED');
    expect(
      classifyResourceFailure(
        { error: 'net::ERR_CERT_DATE_INVALID' },
        { kind: 'tls-error', detail: 'certificate has expired' },
      ).verdict,
    ).toBe('CONFIRMED');
    expect(
      classifyResourceFailure(
        { error: 'net::ERR_BLOCKED_BY_ORB' },
        { kind: 'ok', status: 200, contentType: 'text/html' },
      ).verdict,
    ).toBe('CONFIRMED');
  });

  it('separates policy blocks from site failures', () => {
    expect(
      classifyResourceFailure(
        { error: 'net::ERR_TUNNEL_CONNECTION_FAILED' },
        { kind: 'blocked-by-policy' },
      ).verdict,
    ).toBe('BLOCKED_BY_POLICY');
  });

  it('needs two server errors and treats 429 as inconclusive', () => {
    expect(
      classifyResourceFailure({ status: 503 }, { kind: 'http-error', status: 503 }).verdict,
    ).toBe('CONFIRMED');
    expect(
      classifyResourceFailure({ error: 'net::ERR_FAILED' }, { kind: 'http-error', status: 502 })
        .verdict,
    ).toBe('INCONCLUSIVE');
    expect(
      classifyResourceFailure({ status: 429 }, { kind: 'http-error', status: 429 }).verdict,
    ).toBe('INCONCLUSIVE');
    expect(
      classifyResourceFailure({ status: 503 }, { kind: 'ok', status: 200, contentType: null })
        .verdict,
    ).toBe('INCONCLUSIVE');
  });

  it('keeps a 4xx answer from the site as confirmed when no re-check was possible', () => {
    expect(classifyResourceFailure({ status: 404 }, null).verdict).toBe('CONFIRMED');
  });
});

describe('verifyPageResources', () => {
  const emptyLog = (failed: FailedRequest[] = []): PageNetworkLog => ({
    consoleErrors: [],
    pageErrors: [],
    failedRequests: failed,
    imageResponses: new Map(),
  });
  const brokenImage = (src: string) => ({
    check: 'BROKEN_IMAGE' as const,
    severity: 'MEDIUM' as const,
    message: 'broken',
    selector: 'img',
    html: '<img>',
    box: null,
    measurements: { src },
  });

  it('confirms an image that downloaded but cannot be displayed, without a re-check', async () => {
    const log = emptyLog();
    log.imageResponses.set('https://site.test/a.png', { status: 200, contentType: 'text/html' });
    const probe = async () => {
      throw new Error('must not be called');
    };
    const verdicts = await verifyPageResources(
      log,
      [brokenImage('https://site.test/a.png')],
      probe,
    );
    expect(verdicts.get('https://site.test/a.png')?.verdict).toBe('CONFIRMED');
  });

  it('re-checks an image/* download that does not display (corrupt file or interrupted download)', async () => {
    const log = emptyLog();
    log.imageResponses.set('https://site.test/cut.png', { status: 200, contentType: 'image/png' });
    log.imageResponses.set('https://site.test/moved.png', {
      status: 200,
      contentType: 'image/png',
    });
    const verdicts = await verifyPageResources(
      log,
      [brokenImage('https://site.test/cut.png'), brokenImage('https://site.test/moved.png')],
      async (url) => ({
        kind: 'ok',
        status: 200,
        contentType: url.endsWith('cut.png') ? 'image/png' : 'text/html',
      }),
    );
    expect(verdicts.get('https://site.test/cut.png')?.verdict).toBe('INCONCLUSIVE');
    expect(verdicts.get('https://site.test/moved.png')?.verdict).toBe('CONFIRMED');
  });

  it('re-checks failed requests and stores the verdict on each', async () => {
    const log = emptyLog([
      {
        url: 'https://site.test/ok.png',
        resourceType: 'image',
        error: 'net::ERR_FAILED',
        blockedByPolicy: false,
      },
      {
        url: 'https://site.test/gone.png',
        resourceType: 'image',
        error: 'net::ERR_FAILED',
        blockedByPolicy: false,
      },
      { url: 'http://10.0.0.1/x.png', resourceType: 'image', status: 403, blockedByPolicy: true },
    ]);
    const verdicts = await verifyPageResources(
      log,
      [brokenImage('https://site.test/ok.png'), brokenImage('https://site.test/gone.png')],
      async (url) =>
        url.endsWith('ok.png')
          ? { kind: 'ok', status: 200, contentType: 'image/png' }
          : { kind: 'http-error', status: 404 },
    );
    expect(verdicts.get('https://site.test/ok.png')?.verdict).toBe('INCONCLUSIVE');
    expect(verdicts.get('https://site.test/gone.png')?.verdict).toBe('CONFIRMED');
    expect(log.failedRequests.map((f) => f.verdict)).toEqual([
      'INCONCLUSIVE',
      'CONFIRMED',
      'BLOCKED_BY_POLICY',
    ]);
  });

  it('confirms only 4xx answers when re-checks are disabled', async () => {
    const log = emptyLog([
      {
        url: 'https://site.test/a.css',
        resourceType: 'stylesheet',
        status: 404,
        blockedByPolicy: false,
      },
      {
        url: 'https://site.test/b.js',
        resourceType: 'script',
        error: 'net::ERR_FAILED',
        blockedByPolicy: false,
      },
    ]);
    await verifyPageResources(log, [], null);
    expect(log.failedRequests.map((f) => f.verdict)).toEqual(['CONFIRMED', 'INCONCLUSIVE']);
  });
});

describe('console classification', () => {
  const site = 'www.example.com';
  const storyblokText =
    'You need to provide an access token to interact with Storyblok API. Read https://www.storyblok.com/docs/api/content-delivery#topics/authentication';
  const storyblokRequest: FailedRequest = {
    url: 'https://api.storyblok.com/v2/cdn/stories/home?token=&version=published',
    resourceType: 'fetch',
    status: 401,
    blockedByPolicy: false,
    verdict: 'CONFIRMED',
  };

  it('classifies the Storyblok missing access token as an integration configuration error', () => {
    const result = classifyConsoleMessage(
      {
        level: 'error',
        text: storyblokText,
        source: 'https://www.example.com/_nuxt/entry.3f9a.js',
        line: 2,
        column: 1180,
      },
      site,
      [
        storyblokRequest,
        {
          url: 'https://www.example.com/missing.css',
          resourceType: 'stylesheet',
          status: 404,
          blockedByPolicy: false,
        },
      ],
    );
    expect(result).toMatchObject({
      kind: 'INTEGRATION_CONFIG',
      severity: 'MEDIUM',
      sourcePath: 'www.example.com/_nuxt/entry.3f9a.js',
    });
    // Linked to the Storyblok API request only (same service), not to unrelated failures.
    expect(result.related).toEqual([
      expect.objectContaining({ url: storyblokRequest.url, status: 401, relation: 'same-service' }),
    ]);
  });

  it('classifies an unexplained message as integration config when another service answered 401', () => {
    const result = classifyConsoleMessage(
      {
        level: 'error',
        text: `Request to ${storyblokRequest.url} failed`,
        source: 'https://www.example.com/app.js',
      },
      site,
      [storyblokRequest],
    );
    expect(result.kind).toBe('INTEGRATION_CONFIG');
    expect(result.related[0]?.relation).toBe('mentioned');
  });

  it('does not treat the site’s own 401 (not logged in) as a configuration error', () => {
    const result = classifyConsoleMessage(
      {
        level: 'error',
        text: 'Could not load the basket',
        source: 'https://www.example.com/app.js',
      },
      site,
      [
        {
          url: 'https://www.example.com/api/me',
          resourceType: 'fetch',
          status: 401,
          blockedByPolicy: false,
        },
      ],
    );
    expect(result.kind).toBe('APPLICATION');
  });

  it('separates site code, third-party scripts, network failures and harmless warnings', () => {
    const own = { source: 'https://cdn.example.com/app.js' }; // same site, other subdomain
    expect(
      classifyConsoleMessage(
        { level: 'exception', text: "Cannot read properties of undefined (reading 'x')", ...own },
        site,
        [],
      ),
    ).toMatchObject({ kind: 'APPLICATION', severity: 'HIGH' });
    expect(
      classifyConsoleMessage({ level: 'error', text: 'Something went wrong', ...own }, site, []),
    ).toMatchObject({ kind: 'APPLICATION', severity: 'MEDIUM' });
    expect(
      classifyConsoleMessage(
        { level: 'exception', text: 'boom', source: 'https://widget.other.io/w.js' },
        site,
        [],
      ),
    ).toMatchObject({ kind: 'THIRD_PARTY', severity: 'MEDIUM' });
    expect(
      classifyConsoleMessage(
        { level: 'error', text: 'TypeError: Failed to fetch', ...own },
        site,
        [],
      ),
    ).toMatchObject({ kind: 'NETWORK', severity: 'LOW' });
    expect(
      classifyConsoleMessage(
        {
          level: 'error',
          text: "Access to fetch at 'https://api.other.io/' from origin 'https://www.example.com' has been blocked by CORS policy",
          ...own,
        },
        site,
        [],
      ),
    ).toMatchObject({ kind: 'NETWORK' });
    expect(
      classifyConsoleMessage(
        {
          level: 'warning',
          text: '[Deprecation] Listener added for a synchronous DOMNodeInserted event',
          ...own,
        },
        site,
        [],
      ),
    ).toMatchObject({ kind: 'HARMLESS', severity: null });
    expect(
      classifyConsoleMessage({ level: 'warning', text: 'Some library notice', ...own }, site, []),
    ).toMatchObject({ kind: 'HARMLESS', severity: null });
    expect(
      classifyConsoleMessage(
        { level: 'warning', text: 'reCAPTCHA: invalid domain for site key', ...own },
        site,
        [],
      ),
    ).toMatchObject({ kind: 'INTEGRATION_CONFIG', severity: 'LOW' });
  });

  it('treats the browser’s echo of a failed request as NETWORK, not a site-code error', () => {
    // Seen on a real scan: a 404 HTML page served for a script.
    const script: FailedRequest = {
      url: 'https://www.example.com/analytics/piwik.js',
      resourceType: 'script',
      status: 404,
      blockedByPolicy: false,
      verdict: 'CONFIRMED',
    };
    const result = classifyConsoleMessage(
      {
        level: 'error',
        text: "Refused to execute script from 'https://www.example.com/analytics/piwik.js' because its MIME type ('text/html') is not executable, and strict MIME type checking is enabled.",
        source: 'https://www.example.com/',
        line: 1,
        column: 1,
      },
      site,
      [script],
    );
    expect(result).toMatchObject({
      kind: 'NETWORK',
      severity: 'LOW',
      related: [expect.objectContaining({ relation: 'mentioned', status: 404 })],
    });
  });

  it('never hides an uncaught exception as harmless', () => {
    expect(
      classifyConsoleMessage(
        {
          level: 'exception',
          text: 'X is deprecated and was removed',
          source: 'https://www.example.com/a.js',
        },
        site,
        [],
      ).kind,
    ).toBe('APPLICATION');
  });

  it('groups repeats of the same problem and stores the classification on the entries', () => {
    const log: PageNetworkLog = {
      consoleErrors: [
        {
          level: 'error',
          text: 'Cart item 123 could not be restored',
          source: 'https://www.example.com/app.js?v=1',
          line: 3,
          column: 9,
        },
        {
          level: 'error',
          text: 'Cart item 456 could not be restored',
          source: 'https://www.example.com/app.js?v=2',
          line: 3,
          column: 9,
        },
        { level: 'error', text: storyblokText, source: 'https://www.example.com/app.js' },
      ],
      pageErrors: [],
      failedRequests: [storyblokRequest],
      imageResponses: new Map(),
    };
    const groups = classifyPageConsole(log, site);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ occurrences: 2, classification: { kind: 'APPLICATION' } });
    expect(log.consoleErrors[2]).toMatchObject({
      kind: 'INTEGRATION_CONFIG',
      related: [expect.objectContaining({ status: 401 })],
    });
  });

  it('normalizes ids, numbers and query strings', () => {
    expect(
      normalizeMessage(
        'Order 12345 (id 3f2a9c1e-1b2c-4d5e-8f90-123456789abc) at https://x.io/a?b=1 failed',
      ),
    ).toBe('Order <n> (id <id>) at https://x.io/a failed');
    expect(serviceDomain('api.storyblok.com')).toBe('storyblok.com');
    expect(serviceDomain('www.shop.co.uk')).toBe('shop.co.uk');
  });

  it('reads file, line and column from a stack trace', () => {
    expect(
      firstStackFrame('TypeError: x\n    at load (https://www.example.com/app.js:21:28)'),
    ).toEqual({
      source: 'https://www.example.com/app.js',
      line: 21,
      column: 28,
    });
    expect(firstStackFrame(undefined)).toEqual({});
  });
});
