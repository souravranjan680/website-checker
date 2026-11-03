/** Phase 9, Milestone 2 (Checkpoint 1): newer checks in the UI health report, and the setting. */
import type { ReportScanInfo, UiHealthReportDto } from '@whc/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const ok = (data: unknown) => ({ status: 200, body: { data } });

const scanInfo: ReportScanInfo = {
  id: 's1',
  status: 'COMPLETED',
  createdAt: '2026-11-03T10:00:00.000Z',
  finishedAt: '2026-11-03T10:01:00.000Z',
  durationMs: 60000,
  pagesScanned: 4,
  previousScanId: null,
  accessibilityScore: 100,
  uiHealthScore: 100,
  seoScore: null,
  performanceScore: null,
  securityScore: null,
  myRole: 'EDITOR',
  website: { id: 'w1', name: 'App', baseUrl: 'https://app.example.com/' },
  project: { id: 'p1', name: 'Product' },
};

const report: UiHealthReportDto = {
  scan: scanInfo,
  checks: [
    { checkType: 'COMPONENT_INCONSISTENT', count: 3, highestSeverity: 'MEDIUM' },
    { checkType: 'FONT_LOAD_FAILED', count: 1, highestSeverity: 'MEDIUM' },
  ],
  consoleErrors: [],
  failedRequests: [],
  links: null,
  pages: [],
  extraChecks: {
    layout: 0,
    fontsAndIcons: 1,
    consistency: 3,
    consistencyPages: 4,
    byClassification: { POTENTIAL_DEFECT: 1, OBSERVATION: 2, DETECTED: 1 },
  },
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
    pagesDiscovered: 4,
    pagesScanned: 4,
    pagesFailed: 0,
    errorMessage: null,
    accessibilityScore: 100,
    uiHealthScore: 100,
    totalIssues: 4,
    severityCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 2, LOW: 2, INFO: 0 },
    categoryCounts: { UI_HEALTH: 4 },
    queuedAt: '2026-11-03T10:00:00.000Z',
    startedAt: '2026-11-03T10:00:00.000Z',
    finishedAt: '2026-11-03T10:01:00.000Z',
    durationMs: 60000,
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

describe('UI health report: newer checks', () => {
  it('shows them separately, says they are not scored, and filters by them', async () => {
    const calls = mockApi({ ...api, 'GET /api/reports/s1/ui-health': ok(report) });
    renderApp('/scans/s1/reports/ui-health');

    expect(await screen.findByText('Layout, fonts, icons and consistency')).toBeInTheDocument();
    expect(screen.getByText(/not part of the score/)).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Newer checks by strength of evidence' }),
    ).toHaveTextContent('Observation × 2');

    fireEvent.click(screen.getByRole('button', { name: /Inconsistent components \(3\)/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/api/scans/s1/issues' &&
            c.search.includes('checkType=COMPONENT_INCONSISTENT'),
        ),
      ).toBe(true),
    );
  });
});

describe('website settings', () => {
  it('compares similar buttons and fields by default, and can be switched off', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/projects': page([
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
      ]),
      'POST /api/websites': { status: 201, body: { data: { id: 'w9', name: 'App' } } },
    });
    renderApp('/websites/new');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'App' } });
    fireEvent.change(screen.getByLabelText('Website address'), {
      target: { value: 'https://app.example.com' },
    });
    const checkbox = screen.getByLabelText('Compare similar buttons and fields');
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('checkbox', { name: /I own this website/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeDefined());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      consistencyEnabled: false,
    });
  });
});
