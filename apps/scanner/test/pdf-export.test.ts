/**
 * PDF export: the HTML builder escapes scanned content, and the real Chromium
 * renderer produces a PDF without running scripts or making network requests.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ReportData } from '@whc/db';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdf } from '../src/export/pdf-worker';
import { buildReportHtml, esc, PDF_DETAILED_ISSUES } from '../src/export/report-html';

function issue(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `issue-${n}`,
    category: 'ACCESSIBILITY',
    severity: 'HIGH',
    ruleId: 'image-alt',
    title: `Image has no alt text ${n}`,
    description: 'Images must have alternative text.',
    pageUrl: 'https://example.com/',
    viewport: 'DESKTOP',
    selector: 'img.hero',
    htmlSnippet: '<img src="hero.png">',
    suggestedFix: 'Add an alt attribute.',
    accessibility: {
      wcagCriteria: ['1.1.1'],
      wcagLevel: 'A',
      helpUrl: null,
      detection: 'AUTOMATED',
    },
    uiHealth: null,
    trackedIssue: null,
    screenshot: null,
    ...overrides,
  };
}

function reportData(issues: ReturnType<typeof issue>[]): ReportData {
  return {
    scan: {
      id: 'scan-1',
      status: 'COMPLETED',
      mode: 'SINGLE_PAGE',
      createdAt: new Date('2026-11-01T10:00:00Z'),
      startedAt: new Date('2026-11-01T10:00:01Z'),
      finishedAt: new Date('2026-11-01T10:00:31Z'),
      durationMs: 30_000,
      pagesScanned: 1,
      pagesFailed: 0,
      accessibilityScore: 82,
      uiHealthScore: 95,
      errorMessage: null,
      triggeredBy: 'Tester',
      counts: {
        total: issues.length,
        critical: 0,
        high: issues.length,
        medium: 0,
        low: 0,
        info: 0,
      },
    },
    project: { id: 'p1', name: 'Demo project' },
    website: { id: 'w1', name: 'Example', baseUrl: 'https://example.com' },
    category: null,
    totalIssues: issues.length,
    issues,
    pages: [
      {
        url: 'https://example.com/',
        status: 'SCANNED',
        httpStatus: 200,
        title: 'Home',
        loadTimeMs: 120,
        errorMessage: null,
      },
    ],
  } as unknown as ReportData;
}

describe('buildReportHtml', () => {
  it('escapes everything that came from the scanned website', () => {
    const html = buildReportHtml(
      reportData([
        issue(1, {
          title: '<script>alert(1)</script>',
          htmlSnippet: '<img src=x onerror="steal()">',
          selector: 'a[href="javascript:x"]',
        }),
      ]),
      new Map(),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain(esc('<script>alert(1)</script>'));
    expect(html).not.toContain('onerror="steal()"');
    expect(html).not.toMatch(/<script/i);
  });

  it('shows real numbers and lists issues beyond the detailed limit in a table', () => {
    const issues = Array.from({ length: PDF_DETAILED_ISSUES + 3 }, (_, i) => issue(i));
    const html = buildReportHtml(reportData(issues), new Map());
    expect(html).toContain('>82<'); // accessibility score
    expect(html).toContain(`More issues (3)`);
    expect(html).toContain('Demo project');
  });

  it('embeds screenshots as data URLs', () => {
    const png = Buffer.from('fake-png-bytes');
    const html = buildReportHtml(
      reportData([issue(1)]),
      new Map([['issue-1', { mimeType: 'image/png', data: png }]]),
    );
    expect(html).toContain(`data:image/png;base64,${png.toString('base64')}`);
  });
});

describe('renderPdf (real Chromium)', () => {
  let browser: Browser;
  let server: Server;
  let hits = 0;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = createServer((_req, res) => {
      hits += 1;
      res.end('x');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('produces a PDF and makes no network requests even if HTML asks for them', async () => {
    const { port } = server.address() as AddressInfo;
    const html = `${buildReportHtml(reportData([issue(1)]), new Map())}
      <img src="http://127.0.0.1:${port}/tracker.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/x.css">`;
    const pdf = await renderPdf(browser, html);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(hits).toBe(0);
  }, 60_000);

  it('does not run scripts: a script cannot change the PDF title', async () => {
    // Chromium writes document.title into the PDF metadata, so a script that ran would show.
    const html =
      '<title>OriginalTitle</title><script>document.title = "ScriptRan"</script><p>x</p>';
    const pdf = (await renderPdf(browser, html)).toString('latin1');
    expect(pdf).toContain('/Title (OriginalTitle)');
    expect(pdf).not.toContain('ScriptRan');
  }, 60_000);
});

describe('removeOldExports', () => {
  it('deletes only export files older than ten minutes', async () => {
    const { mkdtemp, utimes, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { createLocalStorage } = await import('../src/storage');
    const { removeOldExports } = await import('../src/export/pdf-worker');
    const storage = createLocalStorage(await mkdtemp(path.join(tmpdir(), 'whc-exports-')));
    await storage.put('exports/scan1/old.pdf', Buffer.from('old'));
    await storage.put('exports/scan2/new.pdf', Buffer.from('new'));
    const old = new Date(Date.now() - 20 * 60_000);
    await utimes(path.join(storage.root, 'exports/scan1/old.pdf'), old, old);

    expect(await removeOldExports(storage)).toBe(1);
    expect(await readdir(path.join(storage.root, 'exports'))).toEqual(['scan2']);
  });
});
