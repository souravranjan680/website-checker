/** Phase 6 pages, rendered with the real routes and providers against a fake API. */
import type { ReportScanInfo, SeoReportDto } from '@whc/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, page, renderApp, signedIn } from '@/test/utils';

const ok = (data: unknown) => ({ status: 200, body: { data } });

const scanInfo: ReportScanInfo = {
  id: 's1',
  status: 'COMPLETED',
  createdAt: '2026-11-02T10:00:00.000Z',
  finishedAt: '2026-11-02T10:01:00.000Z',
  durationMs: 60000,
  pagesScanned: 2,
  previousScanId: null,
  accessibilityScore: 80,
  uiHealthScore: 90,
  seoScore: 87,
  performanceScore: null,
  securityScore: null,
  myRole: 'EDITOR',
  website: { id: 'w1', name: 'Shop', baseUrl: 'https://shop.example.com/' },
  project: { id: 'p1', name: 'Retail' },
};

const scanDetails = {
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
  accessibilityScore: 80,
  uiHealthScore: 90,
  totalIssues: 3,
  severityCounts: { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 0, INFO: 0 },
  categoryCounts: { SEO: 3 },
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

const seoReport: SeoReportDto = {
  scan: scanInfo,
  site: {
    robotsTxt: {
      url: 'https://shop.example.com/robots.txt',
      status: 200,
      found: true,
      blocksAll: false,
      sitemaps: ['https://shop.example.com/sitemap.xml'],
    },
    sitemap: {
      url: 'https://shop.example.com/sitemap.xml',
      status: null,
      found: false,
      validXml: false,
      source: 'robots.txt',
      error: 'Request failed',
    },
  },
  checks: [
    {
      checkType: 'MISSING_TITLE',
      ruleId: 'seo/missing-title',
      title: 'Page has no title',
      count: 1,
      highestSeverity: 'HIGH',
    },
    {
      checkType: 'NOINDEX',
      ruleId: 'seo/noindex',
      title: 'Page asks search engines not to index it',
      count: 2,
      highestSeverity: 'MEDIUM',
    },
  ],
  pages: [
    {
      url: 'https://shop.example.com/thanks',
      title: null,
      metaDescriptionLength: null,
      canonical: null,
      h1Count: 0,
      metaRobots: 'noindex',
      indexable: false,
      hasOpenGraph: false,
      imagesWithoutAlt: 0,
      issues: 3,
    },
  ],
};

const reportApi = {
  ...signedIn,
  'GET /api/scans/s1': ok(scanDetails),
  'GET /api/scans/s1/pages': ok([]),
  'GET /api/scans/s1/issues': page([]),
};

describe('SEO report', () => {
  it('shows the score, site files, checks and page metadata, and filters issues by check', async () => {
    const calls = mockApi({ ...reportApi, 'GET /api/reports/s1/seo': ok(seoReport) });
    renderApp('/scans/s1/reports/seo');

    expect(await screen.findByText('robots.txt')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText(/Crawling allowed/)).toBeInTheDocument();
    // A sitemap request that failed is "could not be checked", never "missing".
    expect(screen.getByText(/Could not be checked/)).toBeInTheDocument();
    expect(screen.getByText('(no title)')).toBeInTheDocument();
    expect(screen.getAllByText('0 / 1')).toHaveLength(2); // indexable pages, Open Graph complete

    fireEvent.click(screen.getByRole('button', { name: /Page asks search engines/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/api/scans/s1/issues' &&
            c.search.includes('category=SEO') &&
            c.search.includes('ruleId=seo%2Fnoindex'),
        ),
      ).toBe(true),
    );
  });

  it('says plainly when the scan has no SEO data', async () => {
    mockApi({
      ...reportApi,
      'GET /api/reports/s1/seo': ok({ scan: scanInfo, site: null, checks: [], pages: [] }),
    });
    renderApp('/scans/s1/reports/seo');
    expect(await screen.findByText('No SEO data for this scan')).toBeInTheDocument();
  });
});

describe('security report', () => {
  const securityReport = {
    scan: { ...scanInfo, securityScore: 33 },
    site: {
      servedOverHttps: true,
      tls: {
        host: 'shop.example.com',
        port: 443,
        checked: true,
        valid: false,
        error: 'CERT_HAS_EXPIRED',
        validFrom: '2020-01-01T00:00:00.000Z',
        validTo: '2021-01-01T00:00:00.000Z',
        daysRemaining: -100,
        issuer: 'Test CA',
        subject: 'shop.example.com',
        protocol: 'TLSv1.3',
      },
      httpRedirect: {
        url: 'http://shop.example.com/',
        status: 200,
        location: null,
        redirectsToHttps: false,
      },
    },
    levels: { CONFIRMED: 1, WARNING: 1, OBSERVATION: 1 },
    checks: [
      {
        checkType: 'INVALID_CERTIFICATE',
        ruleId: 'security/invalid-certificate',
        title: 'The HTTPS certificate is not valid',
        findingLevel: 'CONFIRMED',
        count: 1,
        highestSeverity: 'HIGH',
      },
      {
        checkType: 'MISSING_CSP',
        ruleId: 'security/missing-csp',
        title: 'No Content-Security-Policy header',
        findingLevel: 'WARNING',
        count: 1,
        highestSeverity: 'MEDIUM',
      },
      {
        checkType: 'VERSION_DISCLOSURE',
        ruleId: 'security/version-disclosure',
        title: 'Server reveals software versions',
        findingLevel: 'OBSERVATION',
        count: 1,
        highestSeverity: 'LOW',
      },
    ],
    headers: [
      {
        url: 'https://shop.example.com/',
        present: {
          'content-security-policy': false,
          'strict-transport-security': true,
          'x-frame-options': true,
          'x-content-type-options': true,
          'referrer-policy': false,
        },
      },
    ],
  };

  it('explains it is passive, shows levels, certificate and redirect facts, and filters findings', async () => {
    const calls = mockApi({ ...reportApi, 'GET /api/reports/s1/security': ok(securityReport) });
    renderApp('/scans/s1/reports/security');

    expect(await screen.findByText(/not a penetration test/)).toBeInTheDocument();
    expect(screen.getByText('33')).toBeInTheDocument();
    expect(screen.getByText('Not valid (CERT_HAS_EXPIRED)')).toBeInTheDocument();
    expect(screen.getByText(/expired 100 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/Does not redirect to HTTPS/)).toBeInTheDocument();
    // Each finding shows its level in words, not colour only.
    expect(screen.getByText('Confirmed', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    expect(screen.getByText('Warning', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    expect(
      screen.getByText('Observation', { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('missing')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Show' })[1]!);
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/api/scans/s1/issues' &&
            c.search.includes('category=SECURITY') &&
            c.search.includes('ruleId=security%2Fmissing-csp'),
        ),
      ).toBe(true),
    );
  });
});

describe('performance report', () => {
  const performanceReport = {
    scan: { ...scanInfo, performanceScore: 68 },
    notMeasuredReason: null,
    pages: [
      {
        resultId: 'r1',
        url: 'https://shop.example.com/',
        formFactor: 'MOBILE',
        error: null,
        scores: { performance: 68, accessibility: 100, bestPractices: 78, seo: 91 },
        metrics: {
          fcpMs: 1500,
          lcpMs: 5067,
          cls: 0.15,
          tbtMs: 120,
          speedIndexMs: 3000,
          inpMs: null,
        },
        opportunities: [
          {
            id: 'render-blocking-insight',
            title: 'Render blocking requests',
            displayValue: 'Est savings of 4,460 ms',
            savingsMs: 4460,
            savingsBytes: null,
          },
        ],
        slowestRequests: [
          {
            url: 'https://shop.example.com/app.js',
            resourceType: 'Script',
            transferSize: 300_000,
            durationMs: 800,
          },
        ],
        totalByteWeight: 350_000,
        warnings: [],
        lighthouseVersion: '13.5.0',
        rawReportAvailable: true,
      },
    ],
    history: [
      {
        scanId: 's0',
        createdAt: '2026-11-01T10:00:00.000Z',
        performanceScore: 55,
        lcpMs: 6000,
        cls: 0.2,
        tbtMs: 300,
      },
      {
        scanId: 's1',
        createdAt: '2026-11-02T10:00:00.000Z',
        performanceScore: 68,
        lcpMs: 5067,
        cls: 0.15,
        tbtMs: 120,
      },
    ],
  };

  it('shows Lighthouse scores, rated metrics, INP as not measurable, opportunities and history', async () => {
    mockApi({ ...reportApi, 'GET /api/reports/s1/performance': ok(performanceReport) });
    renderApp('/scans/s1/reports/performance');

    expect(await screen.findByText('5.1 s')).toBeInTheDocument(); // LCP
    expect(screen.getAllByText('Poor')).toHaveLength(1); // LCP > 4 s
    expect(screen.getAllByText('Needs improvement')).toHaveLength(1); // CLS 0.15
    expect(screen.getAllByText('Good').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Needs real visitors/)).toBeInTheDocument();
    expect(screen.getByText('Render blocking requests')).toBeInTheDocument();
    expect(screen.getByText('https://shop.example.com/app.js')).toBeInTheDocument();
    expect(screen.getByText(/68 \(this scan\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Full Lighthouse JSON/ })).toBeInTheDocument();
  });
});

describe('visual report', () => {
  const visual = (myRole: 'EDITOR' | 'VIEWER') => ({
    scanId: 's1',
    websiteId: 'w1',
    myRole,
    snapshots: [
      {
        screenshotId: 'cur-desktop',
        pageUrl: 'https://shop.example.com/',
        viewport: '1920x1080',
        width: 1920,
        height: 1080,
        baseline: { id: 'b1', screenshotId: 'base-desktop', failPercent: 0.5 },
        comparison: {
          id: 'c1',
          scanId: 's1',
          status: 'CHANGED',
          passed: false,
          diffPercent: 9.53,
          diffPixels: 197_000,
          totalPixels: 2_073_600,
          currentScreenshotId: 'cur-desktop',
          diffScreenshotId: 'diff-desktop',
          regions: [{ x: 0, y: 300, width: 1920, height: 224 }],
          sizeChanged: false,
          size: null,
          failPercent: 0.5,
          createdAt: '2026-11-02T10:00:00.000Z',
        },
      },
      {
        screenshotId: 'cur-mobile',
        pageUrl: 'https://shop.example.com/',
        viewport: '390x844',
        width: 390,
        height: 844,
        baseline: null,
        comparison: null,
      },
    ],
  });

  it('shows before / after / diff with the result in words, and changes baselines only on request', async () => {
    const calls = mockApi({
      ...reportApi,
      'GET /api/visual/scans/s1': ok(visual('EDITOR')),
      'POST /api/visual/baselines/b1/replace': ok({ id: 'b1' }),
      'POST /api/visual/websites/w1/baselines': { status: 201, body: { data: { id: 'b2' } } },
    });
    renderApp('/scans/s1/reports/visual');

    expect(
      await screen.findByText('Changed', { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/9\.53 % of the page differs · threshold 0\.5 % · 1 changed area/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open screenshot: Differences/ }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method !== 'GET')).toBe(false); // viewing changes nothing

    // Replace: only after confirming.
    fireEvent.click(screen.getByRole('button', { name: 'Accept as new baseline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace baseline' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/visual/baselines/b1/replace')?.body).toEqual({
        screenshotId: 'cur-desktop',
      }),
    );

    // New baseline for the mobile snapshot, with a threshold and an ignored element.
    fireEvent.click(screen.getByRole('button', { name: 'Use as baseline' }));
    fireEvent.change(await screen.findByLabelText(/Change threshold/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Ignore these elements/), {
      target: { value: '.clock\n  \n#banner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save baseline' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/visual/websites/w1/baselines')?.body).toEqual({
        screenshotId: 'cur-mobile',
        failPercent: 1,
        ignoreSelectors: ['.clock', '#banner'],
      }),
    );
  });

  it('viewers can look but get no baseline buttons', async () => {
    mockApi({ ...reportApi, 'GET /api/visual/scans/s1': ok(visual('VIEWER')) });
    renderApp('/scans/s1/reports/visual');
    expect(
      await screen.findByText('Changed', { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use as baseline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept as new baseline' })).toBeNull();
  });
});

describe('bug reports', () => {
  const report = (myRole: 'EDITOR' | 'VIEWER') => ({
    id: 'b1',
    projectId: 'p1',
    website: { id: 'w1', name: 'Shop' },
    issueId: 'i1',
    scanId: 's1',
    title: 'Form elements must have labels (shop.example.com/contact)',
    description: 'Ensures every form element has a label',
    severity: 'HIGH',
    priority: 'P2',
    status: 'OPEN',
    affectedUrl: 'https://shop.example.com/contact',
    browser: 'Chromium 140.0.7339.16',
    viewport: '1920×1080',
    stepsToReproduce: [
      'Open https://shop.example.com/contact in Chromium 140.0.7339.16 with a 1920×1080 browser window.',
      'Find the element matching the CSS selector: #email',
    ],
    expectedBehavior: '',
    actualBehavior: 'Form element does not have an implicit (wrapped) <label>',
    selector: '#email',
    htmlSnippet: '<input id="email" onfocus="alert(1)">',
    suggestedFix: 'Add a <label for="email">.',
    screenshotId: null,
    aiGenerated: false,
    createdBy: { id: 'u1', name: 'Asha' },
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    myRole,
  });

  it('shows facts, marks unknown expected behavior, copies Markdown and saves edits', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const calls = mockApi({
      ...signedIn,
      'GET /api/bug-reports/b1': ok(report('EDITOR')),
      'PATCH /api/bug-reports/b1': (call) => ok({ ...report('EDITOR'), ...(call.body as object) }),
    });
    renderApp('/bug-reports/b1');

    expect(await screen.findByText(/Not determined by the scanner/)).toBeInTheDocument();
    expect(screen.getByText('Chromium 140.0.7339.16')).toBeInTheDocument();
    // Scanned HTML is text, never rendered.
    expect(screen.getByText('<input id="email" onfocus="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('input#email')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Copy Markdown/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0]![0])).toContain(
      '## Steps to reproduce\n\n1. Open https://shop.example.com/contact',
    );

    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Expected behavior'), {
      target: { value: 'The email field has a visible label.' },
    });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        expectedBehavior: 'The email field has a visible label.',
        status: 'IN_PROGRESS',
        stepsToReproduce: report('EDITOR').stepsToReproduce,
      }),
    );
  });

  it('viewers can read and copy but not edit or delete', async () => {
    mockApi({ ...signedIn, 'GET /api/bug-reports/b1': ok(report('VIEWER')) });
    renderApp('/bug-reports/b1');
    expect(await screen.findByRole('button', { name: /Copy for Jira/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete bug report' })).toBeNull();
  });
});

describe('AI explanation', () => {
  const issuePage = {
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
      htmlSnippet: '<img class="hero">',
      boundingBox: null,
      suggestedFix: 'Add an alt attribute',
      details: null,
      fingerprint: 'f1',
      screenshotId: null,
      pageScreenshotId: null,
      createdAt: '2026-11-02T10:01:00.000Z',
      tracked: null,
      accessibility: null,
      uiHealth: null,
      seo: null,
      security: null,
    },
    scan: { id: 's1', createdAt: '2026-11-02T10:00:00.000Z', status: 'COMPLETED' },
    website: { id: 'w1', name: 'Shop', baseUrl: 'https://shop.example.com/' },
    project: { id: 'p1', name: 'Retail' },
    myRole: 'VIEWER',
    tracking: null,
    timeline: [],
  };
  const status = (enabled: boolean) => ({
    enabled,
    provider: enabled ? 'Anthropic' : null,
    model: enabled ? 'claude-sonnet-5-5' : null,
    limits: { perUserPerHour: 20, perDay: 200, maxOutputTokens: 2500 },
    usageToday: { requests: 0, inputTokens: 0, outputTokens: 0 },
  });
  const insight = {
    issueId: 'i1',
    kind: 'EXPLANATION',
    model: 'claude-sonnet-5-5',
    content: {
      summary: 'The hero image has no text alternative.',
      whyItMatters: 'Screen reader users hear nothing useful.',
      whoIsAffected: ['Screen reader users'],
      howToReproduce: ['Turn on a screen reader', 'Move to the image'],
      howToFix: ['Add a descriptive alt attribute'],
      codeExample: {
        language: 'html',
        before: '<img class="hero" src="hero.png">',
        after: '<img class="hero" src="hero.png" alt="Team photo">',
      },
      limitations: 'The AI could not see the image itself.',
    },
    inputTokens: 800,
    outputTokens: 200,
    createdAt: '2026-11-02T11:00:00.000Z',
    reused: false,
  };

  it('says plainly when AI is not configured and offers no button', async () => {
    mockApi({
      ...signedIn,
      'GET /api/issues/i1': ok(issuePage),
      'GET /api/ai/status': ok(status(false)),
      'GET /api/ai/issues/i1': ok(null),
    });
    renderApp('/issues/i1');
    expect(
      await screen.findByText(/AI explanations are not set up on this server/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Explain with AI/ })).toBeNull();
  });

  it('explains what is sent, asks only on click, and shows the answer as text', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/issues/i1': ok(issuePage),
      'GET /api/ai/status': ok(status(true)),
      'GET /api/ai/issues/i1': ok(null),
      'POST /api/ai/issues/i1/explain': {
        status: 201,
        body: { data: insight, meta: { cached: false } },
      },
    });
    renderApp('/issues/i1');
    expect(await screen.findByText(/cookies and screenshots are never sent/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Explain with AI/ }));
    expect(await screen.findByText('The hero image has no text alternative.')).toBeInTheDocument();
    // Only the issue ID travels in the URL; no body, no prompt from the browser.
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/api/ai/issues/i1/explain',
      body: undefined,
    });
    // Code is shown as text, not turned into elements.
    expect(
      screen.getByText('<img class="hero" src="hero.png" alt="Team photo">'),
    ).toBeInTheDocument();
    expect(screen.getByText(/could not see the image itself/)).toBeInTheDocument();
    expect(screen.getByText(/1000 tokens/)).toBeInTheDocument();
  });

  it('shows the real error when the AI call fails', async () => {
    mockApi({
      ...signedIn,
      'GET /api/issues/i1': ok(issuePage),
      'GET /api/ai/status': ok(status(true)),
      'GET /api/ai/issues/i1': ok(null),
      'POST /api/ai/issues/i1/explain': {
        status: 429,
        body: {
          error: {
            code: 'AI_DAILY_LIMIT',
            message: 'The daily limit for AI explanations has been reached.',
          },
        },
      },
    });
    renderApp('/issues/i1');
    fireEvent.click(await screen.findByRole('button', { name: /Explain with AI/ }));
    expect(await screen.findByText(/daily limit for AI explanations/)).toBeInTheDocument();
  });
});

describe('notifications', () => {
  const n = (overrides: Record<string, unknown>) => ({
    id: 'n1',
    type: 'SCAN_COMPLETED',
    title: 'Scan of Shop finished',
    message: '3 pages scanned, 12 issues found.',
    link: '/scans/s1',
    readAt: null,
    emailStatus: 'NOT_REQUESTED',
    emailedAt: null,
    emailError: null,
    createdAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  });

  it('shows the unread count, real e-mail outcomes and marks everything read', async () => {
    const calls = mockApi({
      ...signedIn,
      'GET /api/notifications/unread-count': ok({ count: 2 }),
      'GET /api/notifications': page([
        n({ id: 'a', emailStatus: 'SENT', emailedAt: '2026-11-02T10:01:00.000Z' }),
        n({
          id: 'b',
          type: 'REGRESSION_DETECTED',
          title: 'Changes detected on Shop',
          emailStatus: 'FAILED',
          emailError: 'The mail server did not accept the message.',
        }),
        n({
          id: 'c',
          title: 'Older one',
          readAt: '2026-11-01T10:00:00.000Z',
          emailStatus: 'PENDING',
        }),
      ]),
      'POST /api/notifications/read-all': ok({ updated: 2 }),
    });
    renderApp('/notifications');

    expect(
      await screen.findByRole('button', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('E-mail sent')).toBeInTheDocument();
    expect(
      screen.getByText(/E-mail not delivered: The mail server did not accept the message./),
    ).toBeInTheDocument();
    expect(screen.getByText('E-mail queued, not sent yet')).toBeInTheDocument();
    expect(screen.getAllByText('New')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/notifications/read-all')).toBe(true),
    );
  });
});
