/** Phase 9, Milestone 1: the Interactions report and the explorer settings. */
import type { FunctionalReportDto, ReportScanInfo } from '@whc/shared';
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
  pagesScanned: 2,
  previousScanId: null,
  accessibilityScore: 100,
  uiHealthScore: 95,
  seoScore: null,
  performanceScore: null,
  securityScore: null,
  myRole: 'EDITOR',
  website: { id: 'w1', name: 'App', baseUrl: 'https://app.example.com/' },
  project: { id: 'p1', name: 'Product' },
};

const report: FunctionalReportDto = {
  scan: scanInfo,
  checks: [
    {
      checkType: 'LAYER_CLIPPED',
      count: 2,
      highestSeverity: 'HIGH',
      byClassification: { POTENTIAL_DEFECT: 2 },
    },
    {
      checkType: 'CONTROL_NO_EFFECT',
      count: 1,
      highestSeverity: 'MEDIUM',
      byClassification: { POTENTIAL_DEFECT: 1 },
    },
  ],
  openStateAccessibilityIssues: 1,
  totals: {
    pagesExplored: 1,
    controlsExplored: 3,
    controlsSkipped: 6,
    actionsBlocked: 2,
    pagesKeyboardChecked: 0,
    formFieldsProbed: 0,
    probesSkipped: 0,
  },
  pages: [
    {
      url: 'https://app.example.com/',
      explored: 3,
      eligible: 3,
      error: null,
      stoppedEarly: null,
      controls: [
        { name: 'Account', kind: 'menu', result: 'opened' },
        { name: 'More filters', kind: 'disclosure', result: 'no-visible-effect' },
        { name: 'Help', kind: 'menu', result: 'opened' },
      ],
      skipped: [
        { name: 'Delete project', role: 'button', reason: 'destructive-or-state-changing' },
      ],
      skippedCounts: { 'destructive-or-state-changing': 1, 'navigation-link': 5 },
      blocked: [
        { kind: 'request', method: 'POST', url: 'https://app.example.com/track' },
        { kind: 'download', detail: 'https://app.example.com/report.csv' },
      ],
      keyboard: null,
      forms: null,
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
    pagesDiscovered: 2,
    pagesScanned: 2,
    pagesFailed: 0,
    errorMessage: null,
    accessibilityScore: 100,
    uiHealthScore: 95,
    totalIssues: 3,
    severityCounts: { CRITICAL: 0, HIGH: 2, MEDIUM: 1, LOW: 0, INFO: 0 },
    categoryCounts: { FUNCTIONAL: 3 },
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

describe('Interactions report', () => {
  it('shows what was explored, skipped and blocked, explains the safety rules, and filters by check', async () => {
    const calls = mockApi({ ...api, 'GET /api/reports/s1/functional': ok(report) });
    renderApp('/scans/s1/reports/interactions');

    expect(await screen.findByText('How the explorer stays safe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Interactions' })).toBeInTheDocument();
    const explored = screen.getByRole('list', { name: 'Explored controls' });
    expect(explored).toHaveTextContent('More filters · Nothing happened');
    expect(screen.getByRole('list', { name: 'Skipped controls' })).toHaveTextContent(
      'Delete project · could change data (delete, send, save…)',
    );
    expect(screen.getByRole('list', { name: 'Blocked actions' })).toHaveTextContent(
      'Request POST https://app.example.com/track',
    );

    fireEvent.click(screen.getByRole('button', { name: /Opened menu cut off/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/api/scans/s1/issues' &&
            c.search.includes('ruleId=functional%2Flayer-clipped'),
        ),
      ).toBe(true),
    );
  });

  it('explains when no page was explored', async () => {
    mockApi({
      ...api,
      'GET /api/reports/s1/functional': ok({ ...report, checks: [], pages: [] }),
    });
    renderApp('/scans/s1/reports/interactions');
    expect(await screen.findByText('No pages were explored in this scan')).toBeInTheDocument();
  });
});

describe('website settings', () => {
  it('sends the explorer settings when adding a website', async () => {
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
    expect(screen.getByLabelText('Explore menus, tabs and expandable sections')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Pages explored'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I own this website/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeDefined());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      explorationEnabled: true,
      explorationPageLimit: 2,
      explorationControlLimit: 30,
    });
  });
});

describe('Interactions report: keyboard and form probes (Milestone 2, Checkpoint 2)', () => {
  it('shows what was pressed and probed, and every skipped field or control with its reason', async () => {
    const probed: FunctionalReportDto = {
      ...report,
      totals: { ...report.totals, pagesKeyboardChecked: 1, formFieldsProbed: 1, probesSkipped: 2 },
      pages: [
        {
          ...report.pages[0]!,
          keyboard: {
            error: null,
            steps: 14,
            stoppedBy: 'trap',
            focusOrder: ['Home'],
            activation: [
              {
                name: 'More filters',
                keys: [
                  { key: 'Enter', result: 'fails' },
                  { key: 'Space', result: 'works' },
                ],
              },
            ],
            skipped: [{ name: 'Settings', reason: 'opens-dialog' }],
            clickableNotFocusable: 0,
          },
          forms: {
            error: null,
            mode: 'BLUR',
            fields: 4,
            probed: [{ name: 'Title', action: 'blur', outcome: 'error-not-linked' }],
            skipped: [{ name: 'Password', reason: 'sensitive-field' }],
            skippedCounts: { 'sensitive-field': 1 },
          },
        },
      ],
    };
    mockApi({ ...api, 'GET /api/reports/s1/functional': ok(probed) });
    renderApp('/scans/s1/reports/interactions');

    expect(
      await screen.findByText('Tab pressed 14 times · stopped at a keyboard trap'),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Keyboard activation' })).toHaveTextContent(
      'More filters · Enter: does nothing, Space: works',
    );
    expect(screen.getByRole('list', { name: 'Keyboard checks skipped' })).toHaveTextContent(
      'Settings · opens a dialog (not opened)',
    );
    expect(screen.getByText('Forms (focus and leave (no typing))')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Form fields probed' })).toHaveTextContent(
      'Title · message not linked',
    );
    expect(screen.getByRole('list', { name: 'Form fields left alone' })).toHaveTextContent(
      'Password · secret or payment data: never touched',
    );
    expect(screen.getByText(/never submit a form/)).toBeInTheDocument();
  });
});

describe('website settings: probes', () => {
  it('keyboard on and forms BLUR by default; typing test values only when chosen', async () => {
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
    expect(screen.getByLabelText('Check keyboard use on explored pages')).toBeChecked();
    const mode = screen.getByLabelText('Form checks on explored pages');
    expect(mode).toHaveValue('BLUR');
    fireEvent.change(mode, { target: { value: 'SYNTHETIC' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I own this website/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeDefined());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      keyboardProbeEnabled: true,
      formProbeMode: 'SYNTHETIC',
    });
  });
});
