/**
 * Phase 5 pages, rendered with the real routes and providers against a fake API.
 * Each test checks that the page shows what the API returned and sends the right requests.
 */
import type {
  AccessibilityReportDto,
  DashboardSummaryDto,
  DashboardTrendsDto,
  IssueHistoryDto,
  ScanListItemDto,
} from '@whc/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { describeDevice, formatDuration } from '@/lib/format';
import { filenameFrom } from '@/lib/download';
import { mockApi, page, renderApp, signedIn, TEST_USER } from '@/test/utils';

const ok = (data: unknown) => ({ status: 200, body: { data } });

const summary: DashboardSummaryDto = {
  range: { from: '2026-10-04T00:00:00.000Z', to: '2026-11-02T23:59:59.999Z' },
  totals: {
    projects: 2,
    websites: 3,
    scans: 14,
    openIssues: 57,
    criticalIssues: 4,
    highIssues: 11,
    resolvedIssues: 9,
  },
  scores: {
    accessibility: 81,
    uiHealth: 92,
    seo: 74,
    security: null,
    performance: null,
    websitesMeasured: 3,
  },
  openBySeverity: [
    { severity: 'CRITICAL', count: 4 },
    { severity: 'HIGH', count: 11 },
    { severity: 'MEDIUM', count: 30 },
    { severity: 'LOW', count: 12 },
    { severity: 'INFO', count: 0 },
  ],
  openByCategory: [
    { category: 'ACCESSIBILITY', count: 40 },
    { category: 'UI_HEALTH', count: 17 },
  ],
  recentScans: [
    {
      id: 's1',
      status: 'COMPLETED',
      createdAt: '2026-11-02T09:00:00.000Z',
      durationMs: 30000,
      totalIssues: 20,
      accessibilityScore: 80,
      website: { id: 'w1', name: 'Shop' },
    },
  ],
  recentWebsites: [
    {
      id: 'w1',
      name: 'Shop',
      baseUrl: 'https://shop.example.com/',
      projectName: 'Retail',
      openIssues: 20,
      lastScan: null,
    },
  ],
  recentActivity: [],
};
const trends: DashboardTrendsDto = {
  range: summary.range,
  points: [
    {
      date: '2026-11-01',
      completed: 2,
      partial: 0,
      failed: 1,
      cancelled: 0,
      other: 0,
      accessibilityScore: 78,
      uiHealthScore: 90,
      newIssues: 5,
      resolvedIssues: 2,
    },
    {
      date: '2026-11-02',
      completed: 1,
      partial: 0,
      failed: 0,
      cancelled: 0,
      other: 0,
      accessibilityScore: 81,
      uiHealthScore: 92,
      newIssues: 0,
      resolvedIssues: 3,
    },
  ],
};

const filterLists = {
  'GET /api/projects': page([{ id: 'p1', name: 'Retail' }]),
  'GET /api/websites': page([{ id: 'w1', name: 'Shop' }]),
};

describe('dashboard', () => {
  it('shows the metrics returned by the API and re-queries when a filter changes', async () => {
    const calls = mockApi({
      ...signedIn,
      ...filterLists,
      'GET /api/dashboard/summary': ok(summary),
      'GET /api/dashboard/trends': ok(trends),
    });
    renderApp('/dashboard');

    const tiles = await screen.findByText('Open issues', { selector: 'dt' });
    const openTile = tiles.closest('div[data-slot="card-content"]') as HTMLElement;
    expect(within(openTile).getByText('57')).toBeInTheDocument();
    const a11y = screen
      .getByText('Accessibility score', { selector: 'dt' })
      .closest('div[data-slot="card-content"]') as HTMLElement;
    expect(within(a11y).getByText('81')).toBeInTheDocument();
    // Performance is not measured yet: never shown as a number.
    const perf = screen
      .getByText('Performance score', { selector: 'dt' })
      .closest('div[data-slot="card-content"]') as HTMLElement;
    expect(within(perf).getByText('Not measured')).toBeInTheDocument();
    expect(screen.getByText('Scan activity')).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'p1' } });
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/api/dashboard/summary' && c.search.includes('projectId=p1')),
      ).toBe(true),
    );
    expect(
      calls.some((c) => c.path === '/api/dashboard/trends' && c.search.includes('projectId=p1')),
    ).toBe(true);
  });

  it('suggests adding a website when there is nothing yet', async () => {
    mockApi({
      ...signedIn,
      ...filterLists,
      'GET /api/dashboard/summary': ok({ ...summary, totals: { ...summary.totals, websites: 0 } }),
      'GET /api/dashboard/trends': ok(trends),
    });
    renderApp('/dashboard');
    expect(await screen.findByText('No websites yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a website' })).toHaveAttribute(
      'href',
      '/websites/new',
    );
  });
});

function scanRow(overrides: Partial<ScanListItemDto>): ScanListItemDto {
  return {
    id: 's1',
    status: 'COMPLETED',
    trigger: 'MANUAL',
    mode: 'CRAWL',
    progress: 100,
    totalIssues: 12,
    criticalCount: 1,
    highCount: 2,
    accessibilityScore: 80,
    uiHealthScore: 95,
    pagesScanned: 4,
    createdAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:01:05.000Z',
    durationMs: 65000,
    website: { id: 'w1', name: 'Shop', baseUrl: 'https://shop.example.com/' },
    ...overrides,
  };
}

describe('scan history', () => {
  it('lists scans with status, duration and pages, filters on the server, and compares two scans', async () => {
    const calls = mockApi({
      ...signedIn,
      ...filterLists,
      'GET /api/scans': page([
        scanRow({ id: 's2', createdAt: '2026-11-02T10:00:00.000Z' }),
        scanRow({ id: 's1' }),
        scanRow({
          id: 's3',
          status: 'FAILED',
          website: { id: 'w2', name: 'Blog', baseUrl: 'https://blog.example.com/' },
        }),
      ]),
    });
    const { router } = renderApp('/history');

    expect(await screen.findAllByText('1 min 5 s')).toHaveLength(3);
    expect(screen.getByText('Failed', { selector: '[data-slot="badge"]' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Scan status'), { target: { value: 'FAILED' } });
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/scans' && c.search.includes('status=FAILED'))).toBe(
        true,
      ),
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'shop' } });
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/scans' && c.search.includes('q=shop'))).toBe(true),
    );

    // The failed scan cannot be selected for comparison.
    expect(screen.getByRole('checkbox', { name: /Blog/ })).toBeDisabled();
    const compare = screen.getByRole('button', { name: /Compare/ });
    expect(compare).toBeDisabled();
    const boxes = screen.getAllByRole('checkbox', { name: /Shop/ });
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(compare).toBeEnabled();
    fireEvent.click(compare);
    await waitFor(() => expect(router.state.location.pathname).toBe('/history/compare'));
    // Older scan is the base, newer the target.
    expect(router.state.location.search).toBe('?base=s1&target=s2');
  });
});

const issueHistory: IssueHistoryDto = {
  issue: {
    id: 'i1',
    category: 'ACCESSIBILITY',
    severity: 'CRITICAL',
    ruleId: 'image-alt',
    title: 'Images must have alternative text',
    description: 'Ensures <img> elements have alternative text',
    pageId: 'pg1',
    pageUrl: 'https://shop.example.com/',
    viewport: '1920x1080',
    selector: 'img.hero',
    htmlSnippet: '<img class="hero" src="/hero.png" onerror="alert(1)">',
    boundingBox: { x: 10, y: 20, width: 120, height: 80 },
    suggestedFix: 'Add an alt attribute',
    details: null,
    fingerprint: 'f1',
    screenshotId: null,
    pageScreenshotId: null,
    createdAt: '2026-11-02T10:01:00.000Z',
    classification: 'DETECTED',
    tracked: {
      id: 't1',
      status: 'OPEN',
      reviewStatus: 'UNREVIEWED',
      occurrenceCount: 3,
      firstSeenAt: '2026-10-20T10:00:00.000Z',
    },
    accessibility: {
      axeRuleId: 'image-alt',
      impact: 'critical',
      wcagCriteria: ['1.1.1'],
      wcagLevel: 'A',
      helpUrl: null,
      detection: 'AUTOMATED',
    },
    uiHealth: null,
    seo: null,
    security: null,
  },
  scan: { id: 's2', createdAt: '2026-11-02T10:00:00.000Z', status: 'COMPLETED' },
  website: { id: 'w1', name: 'Shop', baseUrl: 'https://shop.example.com/' },
  project: { id: 'p1', name: 'Retail' },
  myRole: 'EDITOR',
  tracking: {
    id: 't1',
    status: 'OPEN',
    reviewStatus: 'UNREVIEWED',
    occurrenceCount: 3,
    firstSeenAt: '2026-10-20T10:00:00.000Z',
    lastSeenAt: '2026-11-02T10:00:00.000Z',
    resolvedAt: null,
    firstSeenScanId: 's0',
    lastSeenScanId: 's2',
    resolvedInScanId: null,
  },
  timeline: [
    {
      type: 'DETECTED',
      at: '2026-11-02T10:00:00.000Z',
      scanId: 's2',
      scanStatus: 'COMPLETED',
      issueId: 'i1',
      severity: 'CRITICAL',
    },
    {
      type: 'STATUS_CHANGED',
      at: '2026-10-25T10:00:00.000Z',
      from: 'IGNORED',
      to: 'OPEN',
      user: { id: 'u1', name: 'Asha' },
    },
  ],
};

describe('issue details', () => {
  it('shows location, untrusted HTML as text, history, and marks an issue ignored after confirmation', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/issues/i1': ok(issueHistory),
      'PATCH /api/tracked-issues/t1': ok({ id: 't1', status: 'IGNORED' }),
    });
    renderApp('/issues/i1');

    expect(
      await screen.findByRole('heading', { name: 'Images must have alternative text' }),
    ).toBeInTheDocument();
    expect(screen.getByText('img.hero')).toBeInTheDocument();
    // The scanned HTML is shown literally, not rendered as an element.
    expect(screen.getByText(/onerror="alert\(1\)"/)).toBeInTheDocument();
    expect(document.querySelector('img.hero')).toBeNull();
    expect(screen.getByText('3 scans')).toBeInTheDocument();
    expect(screen.getByText(/changed status from Ignored to/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ignore/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ignore issue' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'IGNORED' }),
    );
  });

  it('shows the automated evidence separately from the team decision, and records a review with a note (Phase 9)', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/issues/i1': ok(issueHistory),
      'GET /api/tracked-issues/t1/reviews': ok([
        {
          id: 'r1',
          createdAt: '2026-11-02T11:00:00.000Z',
          user: { id: 'u1', name: 'Asha' },
          fromStatus: null,
          toStatus: null,
          fromReview: 'UNREVIEWED',
          toReview: 'INTENTIONAL',
          note: 'Decorative image, by design.',
        },
      ]),
      'PATCH /api/tracked-issues/t1': ok({ id: 't1', status: 'OPEN', reviewStatus: 'CONFIRMED' }),
    });
    renderApp('/issues/i1');

    expect(await screen.findByText('Team decision')).toBeInTheDocument();
    expect(screen.getAllByText('Detected').length).toBeGreaterThan(0); // badge, not a decision
    expect(screen.getByTestId('review-status')).toHaveTextContent('Not reviewed');
    const history = await screen.findByRole('list', { name: 'Decision history' });
    expect(history).toHaveTextContent('Asha set the review to “Intentional”');
    expect(history).toHaveTextContent('Decorative image, by design.');

    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Reproduced on Chrome.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm defect' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        reviewStatus: 'CONFIRMED',
        note: 'Reproduced on Chrome.',
      }),
    );
  });
});

const a11yReport: AccessibilityReportDto = {
  scan: {
    id: 's2',
    status: 'COMPLETED',
    createdAt: '2026-11-02T10:00:00.000Z',
    finishedAt: '2026-11-02T10:01:00.000Z',
    durationMs: 60000,
    pagesScanned: 3,
    previousScanId: null,
    accessibilityScore: 74,
    uiHealthScore: 90,
    seoScore: null,
    performanceScore: null,
    securityScore: null,
    myRole: 'EDITOR',
    website: { id: 'w1', name: 'Shop', baseUrl: 'https://shop.example.com/' },
    project: { id: 'p1', name: 'Retail' },
  },
  totals: { violations: 5, needsReview: 1, rules: 2, pagesAffected: 2, pagesScanned: 3 },
  severity: [
    { severity: 'CRITICAL', count: 2 },
    { severity: 'HIGH', count: 3 },
    { severity: 'MEDIUM', count: 0 },
    { severity: 'LOW', count: 0 },
    { severity: 'INFO', count: 0 },
  ],
  criteria: [{ criterion: '1.1.1', name: 'Non-text Content', level: 'A', issues: 2, pages: 2 }],
  rules: [
    {
      ruleId: 'image-alt',
      title: 'Images must have alternative text',
      severity: 'CRITICAL',
      issues: 2,
      pages: 2,
      wcag: ['1.1.1'],
      helpUrl: null,
    },
  ],
  pages: [{ url: 'https://shop.example.com/', issues: 4, critical: 2 }],
  checklist: {},
};

const scanDetails = {
  id: 's2',
  status: 'COMPLETED',
  trigger: 'MANUAL',
  mode: 'CRAWL',
  progress: 100,
  currentStep: null,
  pagesDiscovered: 3,
  pagesScanned: 3,
  pagesFailed: 0,
  errorMessage: null,
  accessibilityScore: 74,
  uiHealthScore: 90,
  totalIssues: 5,
  severityCounts: { CRITICAL: 2, HIGH: 3, MEDIUM: 0, LOW: 0, INFO: 0 },
  categoryCounts: { ACCESSIBILITY: 5 },
  queuedAt: '2026-11-02T10:00:00.000Z',
  startedAt: '2026-11-02T10:00:00.000Z',
  finishedAt: '2026-11-02T10:01:00.000Z',
  durationMs: 60000,
  previousScanId: null,
  myRole: 'EDITOR',
  website: {
    id: 'w1',
    name: 'Shop',
    baseUrl: 'https://shop.example.com/',
    projectId: 'p1',
    projectName: 'Retail',
  },
  triggeredBy: null,
};

describe('reports', () => {
  const reportApi = {
    ...signedIn,
    'GET /api/scans/s2': ok(scanDetails),
    'GET /api/scans/s2/pages': ok([]),
    'GET /api/scans/s2/issues': page([]),
    'GET /api/reports/s2/accessibility': ok(a11yReport),
  };

  it('renders the accessibility report and saves a manual checklist result', async () => {
    const calls = mockApi({
      ...reportApi,
      'PATCH /api/reports/s2/accessibility/checklist': ok({ keyboard: { status: 'FAIL' } }),
    });
    renderApp('/scans/s2/reports/accessibility');
    expect(await screen.findByText('Non-text Content', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('74')).toBeInTheDocument();
    expect(screen.getByText(/0 of 12 done/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Result: Everything works with the keyboard alone/), {
      target: { value: 'FAIL' },
    });
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        itemId: 'keyboard',
        status: 'FAIL',
      }),
    );
  });

  it('says plainly that performance data does not exist instead of inventing a score', async () => {
    mockApi({
      ...reportApi,
      'GET /api/reports/s2/performance': ok({
        scan: a11yReport.scan,
        pages: [],
        history: [],
        notMeasuredReason: 'Lighthouse did not run for this scan. Nothing is estimated.',
      }),
    });
    renderApp('/scans/s2/reports/performance');
    expect(
      await screen.findByText('Performance was not measured for this scan'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing is estimated/)).toBeInTheDocument();
  });

  it('downloads a CSV export from the API', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const calls = mockApi({
      ...reportApi,
      'GET /api/reports/s2/export': { status: 200, body: 'severity,title' },
    });
    renderApp('/scans/s2/reports/accessibility');
    fireEvent.pointerDown(await screen.findByRole('button', { name: /Export/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const exportCall = calls.find((c) => c.path === '/api/reports/s2/export');
    expect(exportCall?.search).toBe('?format=csv&category=ACCESSIBILITY');
    click.mockRestore();
  });
});

describe('profile and settings', () => {
  it('updates the name and validates the password confirmation in the browser', async () => {
    const calls = mockApi({
      ...signedIn,
      'PATCH /api/auth/me': ok({ user: { ...TEST_USER, name: 'Asha Rao' } }),
      'POST /api/auth/change-password': { status: 204 },
    });
    renderApp('/profile');

    const name = await screen.findByLabelText('Full name');
    fireEvent.change(name, { target: { value: 'Asha Rao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Asha Rao' }),
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'old-password-123' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'brand-new-password-9' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'something-else-99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/auth/change-password')).toBe(false);

    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'brand-new-password-9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/auth/change-password')?.body).toEqual({
        currentPassword: 'old-password-123',
        newPassword: 'brand-new-password-9',
      }),
    );
  });

  it('switches the theme, saves preferences and lists sessions', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/auth/preferences': ok({
        scanCompleted: true,
        scanFailed: true,
        regressionDetected: true,
        weeklySummary: false,
        email: false,
      }),
      'PUT /api/auth/preferences': (call) => ok(call.body),
      'GET /api/auth/sessions': ok([
        {
          id: 'f1',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0',
          ipAddress: '10.0.0.1',
          signedInAt: '2026-11-01T10:00:00.000Z',
          lastActiveAt: '2026-11-02T10:00:00.000Z',
          expiresAt: '2026-12-01T10:00:00.000Z',
          current: true,
        },
        {
          id: 'f2',
          userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
          ipAddress: '10.0.0.2',
          signedInAt: '2026-10-30T10:00:00.000Z',
          lastActiveAt: '2026-10-31T10:00:00.000Z',
          expiresAt: '2026-11-29T10:00:00.000Z',
          current: false,
        },
      ]),
      'DELETE /api/auth/sessions/f2': { status: 204 },
    });
    renderApp('/settings');

    fireEvent.click(await screen.findByRole('radio', { name: /Dark/ }));
    expect(document.documentElement).toHaveClass('dark');
    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));
    expect(document.documentElement).not.toHaveClass('dark');

    // The weekly summary is not built yet, so it cannot be switched on.
    expect(await screen.findByLabelText('Weekly summary')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Send by email'));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        email: true,
        scanCompleted: true,
      }),
    );

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/auth/sessions/f2')).toBe(
        true,
      ),
    );
  });
});

describe('layout', () => {
  it('has a mobile menu with the same destinations as the sidebar', async () => {
    mockApi({
      ...signedIn,
      ...filterLists,
      'GET /api/dashboard/summary': ok(summary),
      'GET /api/dashboard/trends': ok(trends),
    });
    const { router } = renderApp('/dashboard');
    fireEvent.pointerDown(await screen.findByRole('button', { name: /Menu/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /History/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/history'));
  });
});

describe('formatting helpers', () => {
  it('formats durations, device names and download file names', () => {
    expect(formatDuration(null)).toBe('–');
    expect(formatDuration(4200)).toBe('4 s');
    expect(formatDuration(95_000)).toBe('1 min 35 s');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/130.0')).toBe(
      'Firefox on macOS',
    );
    expect(describeDevice(null)).toBe('Unknown device');
    expect(filenameFrom('attachment; filename="shop-2026-11-02.csv"', 'x.csv')).toBe(
      'shop-2026-11-02.csv',
    );
    expect(filenameFrom(null, 'x.csv')).toBe('x.csv');
  });
});
