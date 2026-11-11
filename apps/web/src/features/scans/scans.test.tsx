import type { IssueDto, ScanDetailsDto } from '@whc/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

/** jsdom has no EventSource; this stand-in lets the test push "server" events. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.last = null;
});
afterEach(() => vi.unstubAllGlobals());

const website = {
  id: 'w1',
  projectId: 'p1',
  projectName: 'Sites',
  name: 'Homepage',
  baseUrl: 'https://example.com/',
  hostname: 'example.com',
  maxDepth: 2,
  maxPages: 20,
  includePatterns: [],
  excludePatterns: [],
  respectRobotsTxt: true,
  responsivePageLimit: 3,
  lighthousePageLimit: 1,
  verificationStatus: 'UNVERIFIED',
  authorizationConfirmedAt: '2026-11-01T10:00:00.000Z',
  myRole: 'EDITOR',
  scanCount: 0,
  lastScan: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

function scan(overrides: Partial<ScanDetailsDto>): ScanDetailsDto {
  return {
    id: 's1',
    status: 'RUNNING',
    trigger: 'MANUAL',
    mode: 'CRAWL',
    progress: 10,
    currentStep: 'Starting',
    pagesDiscovered: 1,
    pagesScanned: 0,
    pagesFailed: 0,
    errorMessage: null,
    accessibilityScore: null,
    uiHealthScore: null,
    totalIssues: 0,
    severityCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
    categoryCounts: {},
    queuedAt: '2026-11-02T10:00:00.000Z',
    startedAt: '2026-11-02T10:00:01.000Z',
    finishedAt: null,
    durationMs: null,
    previousScanId: null,
    myRole: 'EDITOR',
    website: {
      id: 'w1',
      name: 'Homepage',
      baseUrl: 'https://example.com/',
      projectId: 'p1',
      projectName: 'Sites',
    },
    triggeredBy: { id: 'u1', name: 'Asha' },
    ...overrides,
  };
}

const issue: IssueDto = {
  id: 'i1',
  category: 'ACCESSIBILITY',
  severity: 'CRITICAL',
  ruleId: 'image-alt',
  title: 'Images must have alternative text',
  description: 'Ensures <img> elements have alternative text',
  pageId: 'pg1',
  pageUrl: 'https://example.com/',
  viewport: '1920x1080',
  selector: 'img.hero',
  htmlSnippet: '<img class="hero" src="/hero.png">',
  boundingBox: { x: 10, y: 20, width: 120, height: 80 },
  suggestedFix: 'Fix any of the following: add an alt attribute',
  details: null,
  fingerprint: 'f1',
  screenshotId: 'shot1',
  pageScreenshotId: null,
  createdAt: '2026-11-02T10:01:00.000Z',
  classification: 'DETECTED',
  tracked: {
    id: 't1',
    status: 'OPEN',
    reviewStatus: 'UNREVIEWED',
    occurrenceCount: 1,
    firstSeenAt: '2026-11-02T10:01:00.000Z',
  },
  accessibility: {
    axeRuleId: 'image-alt',
    impact: 'critical',
    wcagCriteria: ['1.1.1'],
    wcagLevel: 'A',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
    detection: 'AUTOMATED',
  },
  uiHealth: null,
  seo: null,
  functional: null,
  compatibility: null,
  security: null,
};

describe('starting a scan', () => {
  it('queues a scan from the website page and opens its progress page', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/websites/w1': { status: 200, body: { data: website } },
      'GET /api/websites/w1/scans': page([]),
      'POST /api/scans': { status: 201, body: { data: scan({ status: 'QUEUED' }) } },
      'GET /api/scans/s1': { status: 200, body: { data: scan({ status: 'QUEUED' }) } },
      'GET /api/scans/s1/pages': { status: 200, body: { data: [] } },
    });
    const { router } = renderApp('/websites/w1');
    fireEvent.click(await screen.findByRole('button', { name: /Start scan/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/scans/s1'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      websiteId: 'w1',
      mode: 'CRAWL',
    });
    expect(await screen.findByText('Waiting for a scanner…')).toBeInTheDocument();
  });

  it('opens the scan that is already running when the API refuses a second one (409)', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/websites/w1': { status: 200, body: { data: website } },
      'GET /api/websites/w1/scans': page([]),
      'POST /api/scans': {
        status: 409,
        body: {
          error: {
            code: 'SCAN_ALREADY_RUNNING',
            message: 'A scan of this website is already queued or running.',
            details: { scanId: 's7' },
          },
        },
      },
      'GET /api/scans/s7': { status: 200, body: { data: scan({ id: 's7', status: 'QUEUED' }) } },
      'GET /api/scans/s7/pages': { status: 200, body: { data: [] } },
    });
    const { router } = renderApp('/websites/w1');
    fireEvent.click(await screen.findByRole('button', { name: /Start scan/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/scans/s7'));
    expect(await screen.findByText('A scan of this website is already running.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    // The scan page loads the running scan the API named.
    await waitFor(() => expect(calls.some((c) => c.path === '/api/scans/s7')).toBe(true));
  });

  it('does not offer Start scan to viewers', async () => {
    mockApi({
      ...signedIn,
      'GET /api/websites/w1': { status: 200, body: { data: { ...website, myRole: 'VIEWER' } } },
      'GET /api/websites/w1/scans': page([]),
    });
    renderApp('/websites/w1');
    expect(
      await screen.findByText(/An owner or editor of this project can start a scan/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start scan/ })).not.toBeInTheDocument();
  });
});

describe('scan progress page', () => {
  it('shows live progress from the server stream and can cancel', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/scans/s1': { status: 200, body: { data: scan({}) } },
      'GET /api/scans/s1/pages': { status: 200, body: { data: [] } },
      'POST /api/scans/s1/cancel': { status: 202, body: { data: scan({ status: 'CANCELLING' }) } },
    });
    renderApp('/scans/s1');
    expect(await screen.findByText('Scanning in progress')).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last?.url).toBe('/api/scans/s1/events'));

    FakeEventSource.last!.emit('progress', {
      type: 'progress',
      scanId: 's1',
      status: 'RUNNING',
      progress: 45,
      step: 'Scanning page 3 of up to 8',
      currentUrl: 'https://example.com/about',
      pagesDiscovered: 8,
      pagesScanned: 2,
      pagesFailed: 0,
      issuesFound: 17,
      at: new Date().toISOString(),
    });
    expect(await screen.findByText('https://example.com/about')).toBeInTheDocument();
    expect(screen.getByText('45% complete')).toBeInTheDocument();
    expect(screen.getByText('Scanning page 3 of up to 8')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancel scan/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/scans/s1/cancel')).toBe(true));
  });

  it('shows the real results of a finished scan', async () => {
    mockApi({
      ...signedIn,
      'GET /api/scans/s1': {
        status: 200,
        body: {
          data: scan({
            status: 'COMPLETED',
            progress: 100,
            accessibilityScore: 72,
            uiHealthScore: 95,
            totalIssues: 1,
            pagesScanned: 1,
            severityCounts: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
            categoryCounts: { ACCESSIBILITY: 1 },
            durationMs: 12_000,
          }),
        },
      },
      'GET /api/scans/s1/pages': { status: 200, body: { data: [] } },
      'GET /api/scans/s1/issues': {
        status: 200,
        body: { data: [issue], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } },
      },
    });
    renderApp('/scans/s1');
    expect(await screen.findByText('72')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
    expect(await screen.findByText('Images must have alternative text')).toBeInTheDocument();
    // Untrusted HTML from the scanned site is shown as text, not rendered.
    expect(screen.getByText('<img class="hero" src="/hero.png">')).toBeInTheDocument();
    expect(screen.getByText(/1\.1\.1/)).toBeInTheDocument();
    expect(FakeEventSource.last).toBeNull(); // no live stream for a finished scan
  });

  it('explains a failed scan without technical details', async () => {
    mockApi({
      ...signedIn,
      'GET /api/scans/s1': {
        status: 200,
        body: {
          data: scan({ status: 'FAILED', errorMessage: 'The domain name could not be found.' }),
        },
      },
      'GET /api/scans/s1/pages': { status: 200, body: { data: [] } },
      'GET /api/scans/s1/issues': page([]),
    });
    renderApp('/scans/s1');
    expect(await screen.findByText('The scan failed')).toBeInTheDocument();
    expect(screen.getByText('The domain name could not be found.')).toBeInTheDocument();
  });
});
