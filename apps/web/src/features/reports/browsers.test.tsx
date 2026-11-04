/**
 * Phase 9, Milestone 3 (Checkpoint 3): the Browsers report (each browser state, older scans,
 * unreadable results), the browser difference card on an issue, the browser filters, and
 * the cross-browser website settings.
 */
import type { BrowsersReportDto, IssueHistoryDto, ReportScanInfo } from '@whc/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const ok = (data: unknown) => ({ status: 200, body: { data } });

const scanInfo: ReportScanInfo = {
  id: 's1',
  status: 'COMPLETED',
  createdAt: '2026-11-04T10:00:00.000Z',
  finishedAt: '2026-11-04T10:02:00.000Z',
  durationMs: 120000,
  pagesScanned: 3,
  previousScanId: null,
  accessibilityScore: 90,
  uiHealthScore: 95,
  seoScore: null,
  performanceScore: null,
  securityScore: null,
  myRole: 'EDITOR',
  website: { id: 'w1', name: 'App', baseUrl: 'https://app.example.com/' },
  project: { id: 'p1', name: 'Product' },
};

const browser = (
  overrides: Partial<BrowsersReportDto['browsers'][number]>,
): BrowsersReportDto['browsers'][number] => ({
  browser: 'FIREFOX',
  role: 'COMPARED',
  state: 'COMPLETED',
  message: null,
  version: null,
  startedAt: null,
  finishedAt: null,
  pagesPlanned: null,
  pagesChecked: null,
  skippedChecks: [],
  issues: 0,
  ...overrides,
});

const report: BrowsersReportDto = {
  scan: scanInfo,
  crossBrowser: 'ON',
  browsers: [
    browser({
      browser: 'CHROMIUM',
      role: 'BASELINE',
      version: 'Chromium 156.0',
      pagesChecked: 3,
    }),
    browser({
      browser: 'FIREFOX',
      state: 'PARTIAL',
      version: 'Firefox 157.0',
      message: '1 page(s) could not be checked in Firefox.',
      startedAt: '2026-11-04T10:01:00.000Z',
      pagesPlanned: 3,
      pagesChecked: 2,
      issues: 2,
      skippedChecks: [
        { check: 'explorer', reason: 'interactions run in Chromium only', viewport: null },
        {
          check: 'mobile-size',
          reason: 'Firefox cannot emulate mobile devices',
          viewport: '390x844',
        },
      ],
    }),
    browser({
      browser: 'WEBKIT',
      state: 'UNAVAILABLE',
      message: 'WebKit failed its network security self-check, so it was not used.',
      startedAt: '2026-11-04T10:01:30.000Z',
      pagesPlanned: 3,
      pagesChecked: 0,
    }),
  ],
  pages: [
    {
      url: 'https://app.example.com/',
      results: [
        {
          browser: 'FIREFOX',
          viewport: '1920x1080',
          status: 'DONE',
          error: null,
          httpStatus: 200,
          loadTimeMs: 1200,
          comparison: {
            compared: true,
            reason: null,
            baselineVersion: 'Chromium 156.0',
            differences: 2,
            confirmed: 1,
            chromiumOnly: 0,
          },
        },
      ],
      unreadable: 0,
    },
    {
      url: 'https://app.example.com/b',
      results: [
        {
          browser: 'FIREFOX',
          viewport: '1920x1080',
          status: 'FAILED',
          error: 'The page did not finish within 75 s.',
          httpStatus: null,
          loadTimeMs: null,
          comparison: {
            compared: false,
            reason: 'The page could not be checked in Firefox.',
            baselineVersion: 'Chromium 156.0',
            differences: 0,
            confirmed: 0,
            chromiumOnly: 0,
          },
        },
      ],
      unreadable: 2,
    },
  ],
  checks: [
    {
      browser: 'FIREFOX',
      checkType: 'BROWSER_ONLY_ERROR',
      count: 1,
      byClassification: { DETECTED: 1 },
    },
    {
      browser: 'FIREFOX',
      checkType: 'UNSUPPORTED_CSS',
      count: 1,
      byClassification: { OBSERVATION: 1 },
    },
  ],
};

const api = {
  ...signedIn,
  'GET /api/scans/s1': ok({
    id: 's1',
    status: 'COMPLETED',
    trigger: 'MANUAL',
    mode: 'CRAWL',
    progress: 100,
    currentStep: null,
    pagesDiscovered: 3,
    pagesScanned: 3,
    pagesFailed: 0,
    errorMessage: null,
    accessibilityScore: 90,
    uiHealthScore: 95,
    totalIssues: 2,
    severityCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 1, INFO: 0 },
    categoryCounts: { COMPATIBILITY: 2 },
    queuedAt: '2026-11-04T10:00:00.000Z',
    startedAt: '2026-11-04T10:00:00.000Z',
    finishedAt: '2026-11-04T10:02:00.000Z',
    durationMs: 120000,
    previousScanId: null,
    myRole: 'EDITOR',
    website: {
      id: 'w1',
      name: 'App',
      baseUrl: 'https://app.example.com/',
      projectId: 'p1',
      projectName: 'Product',
    },
    triggeredBy: null,
  }),
  'GET /api/scans/s1/pages': ok([]),
  'GET /api/scans/s1/issues': page([]),
};

describe('Browsers report', () => {
  it('shows each browser’s own state, pages, reasons, unreadable results, and filters issues', async () => {
    const calls = mockApi({ ...api, 'GET /api/reports/s1/browsers': ok(report) });
    renderApp('/scans/s1/reports/browsers');

    const chromium = await screen.findByLabelText('Chromium status');
    expect(chromium).toHaveTextContent('Completed');
    expect(chromium).toHaveTextContent('Chromium 156.0');
    const firefox = screen.getByLabelText('Firefox status');
    expect(firefox).toHaveTextContent('Partial: some pages failed');
    expect(firefox).toHaveTextContent('2 of 3');
    expect(firefox).toHaveTextContent('1 page(s) could not be checked in Firefox.');
    expect(within(firefox).getByText('Phone size')).toBeInTheDocument();
    expect(firefox).toHaveTextContent('Firefox cannot emulate mobile devices');
    const webkit = screen.getByLabelText('WebKit status');
    expect(webkit).toHaveTextContent('Unavailable');
    expect(webkit).not.toHaveTextContent('Completed');
    expect(webkit).toHaveTextContent('failed its network security self-check');

    expect(screen.getByText('Yes (Chromium 156.0)')).toBeInTheDocument();
    expect(screen.getByText('2 (1 confirmed)')).toBeInTheDocument();
    expect(screen.getByText('Failed: The page did not finish within 75 s.')).toBeInTheDocument();
    expect(screen.getByText(/2 stored results could not be read/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Firefox: JavaScript error (1)' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/api/scans/s1/issues' &&
            c.search.includes('category=COMPATIBILITY') &&
            c.search.includes('browser=FIREFOX') &&
            c.search.includes('checkType=BROWSER_ONLY_ERROR'),
        ),
      ).toBe(true),
    );
  });

  it('cross-browser off: says so, and never shows a success for Firefox or WebKit', async () => {
    mockApi({
      ...api,
      'GET /api/reports/s1/browsers': ok({
        ...report,
        crossBrowser: 'OFF',
        browsers: [
          report.browsers[0],
          browser({ state: 'DISABLED', message: 'Cross-browser checks were off for this scan.' }),
          browser({
            browser: 'WEBKIT',
            state: 'DISABLED',
            message: 'Cross-browser checks were off for this scan.',
          }),
        ],
        pages: [],
        checks: [],
      }),
    });
    renderApp('/scans/s1/reports/browsers');
    expect(
      await screen.findByText('Cross-browser checks were off for this scan'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Firefox status')).toHaveTextContent('Off');
    expect(screen.getByLabelText('Firefox status')).not.toHaveTextContent('Completed');
    expect(screen.getByLabelText('Firefox status')).toHaveTextContent('Not compared in this scan');
    expect(screen.getByLabelText('Firefox status')).not.toHaveTextContent('Version');
    expect(screen.queryByText('Differences')).toBeNull();
  });

  it('older scans: nothing is claimed', async () => {
    mockApi({
      ...api,
      'GET /api/reports/s1/browsers': ok({
        ...report,
        crossBrowser: 'UNKNOWN',
        browsers: [
          report.browsers[0],
          browser({ state: 'NOT_RECORDED' }),
          browser({ browser: 'WEBKIT', state: 'NOT_RECORDED' }),
        ],
        pages: [],
        checks: [],
      }),
    });
    renderApp('/scans/s1/reports/browsers');
    expect(await screen.findByText('No cross-browser results for this scan')).toBeInTheDocument();
    expect(screen.getByLabelText('WebKit status')).toHaveTextContent('Not recorded');
  });
});

const compatIssue: IssueHistoryDto = {
  issue: {
    id: 'i1',
    category: 'COMPATIBILITY',
    severity: 'MEDIUM',
    ruleId: 'compat/browser-only-error',
    title: 'JavaScript error in one browser only: Firefox',
    description: 'Uncaught error: x is not a function',
    pageId: 'pg1',
    pageUrl: 'https://app.example.com/',
    viewport: '1920x1080',
    selector: null,
    htmlSnippet: null,
    boundingBox: null,
    suggestedFix: 'Feature-detect it.',
    details: null,
    fingerprint: 'f1',
    screenshotId: null,
    pageScreenshotId: null,
    createdAt: '2026-11-04T10:01:00.000Z',
    classification: 'DETECTED',
    tracked: null,
    accessibility: null,
    uiHealth: null,
    seo: null,
    functional: null,
    security: null,
    compatibility: {
      browser: 'FIREFOX',
      browserVersion: 'Firefox 157.0',
      baselineVersion: 'Chromium 156.0',
      checkType: 'BROWSER_ONLY_ERROR',
      matchMethod: null,
      evidence: {
        confirmed: true,
        why: 'thrown by the site’s own script; not thrown at this location in Chromium',
        error: {
          message: '<img src=x onerror="alert(1)">',
          source: 'https://app.example.com/app.js',
          line: 42,
        },
        declarations: 'not a list',
        font: 7,
      },
    },
  },
  scan: { id: 's1', createdAt: '2026-11-04T10:00:00.000Z', status: 'COMPLETED' },
  website: { id: 'w1', name: 'App', baseUrl: 'https://app.example.com/' },
  project: { id: 'p1', name: 'Product' },
  myRole: 'EDITOR',
  tracking: null,
  timeline: [],
};

describe('browser difference on an issue', () => {
  it('shows browser, versions, confirmation and evidence as text; odd evidence is left out', async () => {
    mockApi({ ...signedIn, 'GET /api/issues/i1': ok(compatIssue) });
    renderApp('/issues/i1');
    expect(await screen.findByText('Browser difference')).toBeInTheDocument();
    expect(screen.getByText(/Seen in Firefox 157.0, not in Chromium 156.0/)).toBeInTheDocument();
    expect(screen.getByText('Seen again: confirmed')).toBeInTheDocument();
    expect(screen.getByText('JavaScript error')).toBeInTheDocument();
    // Untrusted text from the scanned site is shown literally, never rendered.
    expect(
      screen.getByText(/<img src=x onerror="alert\(1\)"> \(https:\/\/app.example.com\/app.js:42\)/),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.queryByText('Font')).toBeNull();
  });
});

describe('website settings: other browsers', () => {
  const projects = page([
    {
      id: 'p1',
      name: 'Product',
      description: null,
      myRole: 'OWNER',
      websiteCount: 0,
      memberCount: 1,
      scanCount: 0,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ]);

  async function fillIn() {
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'App' } });
    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'https://app.example.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /I own this website/ }));
  }

  it('off by default; when on, Firefox and WebKit are preselected and the choices are sent', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': projects,
      'POST /api/websites': { status: 201, body: { data: { id: 'w9', name: 'App' } } },
    });
    renderApp('/websites/new');
    await fillIn();
    const toggle = screen.getByRole('checkbox', { name: /Also check the first pages in Firefox/ });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Firefox' })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('checkbox', { name: 'Firefox' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'WebKit' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Firefox' }));
    fireEvent.change(screen.getByLabelText('Pages checked in each browser'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /WebKit at a phone size/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeDefined());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      crossBrowserEnabled: true,
      crossBrowserTargets: ['WEBKIT'],
      crossBrowserPageLimit: 5,
      crossBrowserMobile: true,
    });
  });

  it('on with no browser chosen is refused before sending', async () => {
    const calls = mockApi({ ...signedIn, 'GET /api/projects': projects });
    renderApp('/websites/new');
    await fillIn();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Also check the first pages in Firefox/ }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Firefox' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'WebKit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    expect(
      await screen.findByText('Choose at least one browser, or turn cross-browser checks off.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
  });
});
