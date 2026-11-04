/**
 * Phase 9, Milestone 3 (Checkpoint 3) in the API: the Browsers report (every browser state,
 * older scans, malformed stored results), browser and check-type filters, access rules, and
 * exports that stay exactly as before for scans that did not check other browsers.
 */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  resetDatabase,
  signUp,
  type Agent,
} from '../../../test/helpers';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

async function site(agent: Agent) {
  const project = (await agent.post('/api/projects').set(CSRF).send({ name: 'Sites' })).body.data;
  const res = await agent.post('/api/websites').set(CSRF).send({
    projectId: project.id,
    name: 'App',
    baseUrl: 'https://example.com',
    authorizationConfirmed: true,
  });
  return { projectId: project.id as string, websiteId: res.body.data.id as string };
}

async function scanWith(websiteId: string, config: object, status = 'COMPLETED') {
  return prisma.scan.create({
    data: {
      websiteId,
      config,
      status: status as never,
      pagesScanned: 2,
      browserVersion: 'Chromium 156.0.8078.80',
    },
  });
}

/** A scan that checked Firefox (completed) and WebKit (unavailable), as the scanner saves it. */
async function seedCrossBrowserScan(websiteId: string) {
  const scan = await scanWith(websiteId, {
    crossBrowserEnabled: true,
    crossBrowserTargets: ['FIREFOX', 'WEBKIT'],
  });
  await prisma.scanBrowserRun.createMany({
    data: [
      {
        scanId: scan.id,
        browser: 'FIREFOX',
        status: 'COMPLETED',
        version: 'Firefox 157.0',
        pagesPlanned: 1,
        pagesChecked: 1,
        finishedAt: new Date(),
        skippedChecks: [
          { check: 'explorer', reason: 'interactions run in Chromium only' },
          {
            check: 'mobile-size',
            viewport: '390x844',
            reason: 'Firefox cannot emulate mobile devices',
          },
        ],
      },
      {
        scanId: scan.id,
        browser: 'WEBKIT',
        status: 'UNAVAILABLE',
        errorMessage: 'WebKit is not installed on this server.',
        pagesPlanned: 1,
        finishedAt: new Date(),
        skippedChecks: 'not a list',
      },
    ],
  });
  const page = await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      status: 'DONE',
      compatibility: {
        firefox: [
          {
            viewport: '1920x1080',
            status: 'DONE',
            error: null,
            httpStatus: 200,
            finalUrl: 'https://example.com/',
            loadTimeMs: 812,
            facts: {},
            comparison: {
              compared: true,
              reason: null,
              baselineVersion: 'Chromium 156.0.8078.80',
              differences: 2,
              confirmed: 1,
              chromiumOnly: 0,
            },
          },
          { viewport: '390x844', status: 'MAYBE' }, // malformed: unreadable, never a success
          'garbage',
        ],
        safari: [],
      },
    },
  });
  // A page whose whole record is malformed.
  await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/b',
      normalizedUrl: 'https://example.com/b',
      status: 'DONE',
      compatibility: ['not', 'an', 'object'],
    },
  });
  const compat = (n: number, checkType: string, classification: string) =>
    prisma.issue.create({
      data: {
        scanId: scan.id,
        scanPageId: page.id,
        category: 'COMPATIBILITY',
        severity: 'MEDIUM',
        ruleId: `compat/${checkType.toLowerCase().replace(/_/g, '-')}`,
        title: `Difference ${n}: Firefox`,
        description: 'Seen in Firefox only.',
        pageUrl: 'https://example.com/',
        viewport: '1920x1080',
        fingerprint: `f-compat-${n}`,
        classification: classification as never,
        details: { browser: 'FIREFOX' },
        compatibility: {
          create: {
            browser: 'FIREFOX',
            browserVersion: 'Firefox 157.0',
            baselineVersion: 'Chromium 156.0.8078.80',
            checkType: checkType as never,
            matchMethod: null,
            evidence: {
              confirmed: n === 1,
              url: 'https://example.com/<img src=x onerror=alert(1)>',
            },
          },
        },
      },
    });
  await compat(1, 'BROWSER_ONLY_ERROR', 'DETECTED');
  await compat(2, 'UNSUPPORTED_CSS', 'OBSERVATION');
  await prisma.issue.create({
    data: {
      scanId: scan.id,
      category: 'UI_HEALTH',
      severity: 'LOW',
      ruleId: 'ui/broken-link',
      title: 'Broken link',
      description: 'd',
      fingerprint: 'f-ui',
      classification: 'DETECTED',
      uiHealth: { create: { checkType: 'BROKEN_LINK' } },
    },
  });
  return scan.id;
}

const stateOf = (report: { browsers: { browser: string; state: string }[] }) =>
  Object.fromEntries(report.browsers.map((b) => [b.browser, b.state]));

describe('GET /api/reports/:scanId/browsers', () => {
  it('shows each browser’s own state, version, pages, skipped checks and differences', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const scanId = await seedCrossBrowserScan(websiteId);

    const res = await agent.get(`/api/reports/${scanId}/browsers`);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.crossBrowser).toBe('ON');
    expect(stateOf(r)).toEqual({
      CHROMIUM: 'COMPLETED',
      FIREFOX: 'COMPLETED',
      WEBKIT: 'UNAVAILABLE',
    });
    const [chromium, firefox, webkit] = r.browsers;
    expect(chromium).toMatchObject({
      role: 'BASELINE',
      version: 'Chromium 156.0.8078.80',
      pagesChecked: 2,
    });
    expect(firefox).toMatchObject({
      role: 'COMPARED',
      version: 'Firefox 157.0',
      pagesPlanned: 1,
      pagesChecked: 1,
      issues: 2,
      skippedChecks: [
        { check: 'explorer', reason: 'interactions run in Chromium only', viewport: null },
        {
          check: 'mobile-size',
          reason: 'Firefox cannot emulate mobile devices',
          viewport: '390x844',
        },
      ],
    });
    // Malformed skipped checks are left out, never invented.
    expect(webkit).toMatchObject({
      message: 'WebKit is not installed on this server.',
      skippedChecks: [],
      issues: 0,
    });
    expect(r.checks).toEqual([
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
    ]);
  });

  it('reads stored page results defensively: malformed entries are counted, never shown as success', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const scanId = await seedCrossBrowserScan(websiteId);
    const r = (await agent.get(`/api/reports/${scanId}/browsers`)).body.data;
    expect(r.pages).toEqual([
      {
        url: 'https://example.com/',
        results: [
          {
            browser: 'FIREFOX',
            viewport: '1920x1080',
            status: 'DONE',
            error: null,
            httpStatus: 200,
            loadTimeMs: 812,
            comparison: {
              compared: true,
              reason: null,
              baselineVersion: 'Chromium 156.0.8078.80',
              differences: 2,
              confirmed: 1,
              chromiumOnly: 0,
            },
          },
        ],
        unreadable: 3, // the bad status, the string, the unknown browser key
      },
      { url: 'https://example.com/b', results: [], unreadable: 1 },
    ]);
  });

  it('cross-browser off, older scans, not chosen and not run are told apart', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const off = await scanWith(websiteId, {
      crossBrowserEnabled: false,
      crossBrowserTargets: ['FIREFOX', 'WEBKIT'],
    });
    const older = await scanWith(websiteId, { baseUrl: 'https://example.com/' });
    const ended = await scanWith(
      websiteId,
      { crossBrowserEnabled: true, crossBrowserTargets: ['WEBKIT'] },
      'CANCELLED',
    );
    const running = await scanWith(
      websiteId,
      { crossBrowserEnabled: true, crossBrowserTargets: ['FIREFOX', 'WEBKIT'] },
      'RUNNING',
    );
    const get = async (id: string) => (await agent.get(`/api/reports/${id}/browsers`)).body.data;

    const a = await get(off.id);
    expect(a.crossBrowser).toBe('OFF');
    expect(stateOf(a)).toEqual({ CHROMIUM: 'COMPLETED', FIREFOX: 'DISABLED', WEBKIT: 'DISABLED' });
    expect(a.pages).toEqual([]);

    const b = await get(older.id);
    expect(b.crossBrowser).toBe('UNKNOWN');
    expect(stateOf(b)).toEqual({
      CHROMIUM: 'COMPLETED',
      FIREFOX: 'NOT_RECORDED',
      WEBKIT: 'NOT_RECORDED',
    });

    const c = await get(ended.id);
    expect(stateOf(c)).toEqual({ CHROMIUM: 'CANCELLED', FIREFOX: 'DISABLED', WEBKIT: 'NOT_RUN' });
    expect(c.browsers[1].message).toBe('Not chosen for this website.');

    expect(stateOf(await get(running.id))).toEqual({
      CHROMIUM: 'RUNNING',
      FIREFOX: 'RUNNING',
      WEBKIT: 'RUNNING',
    });
  });

  it('follows the project rules: members (viewers too) only; signed in only', async () => {
    const owner = await signUp(ctx.app);
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const outsider = await signUp(ctx.app);
    const { projectId, websiteId } = await site(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });
    const scanId = await seedCrossBrowserScan(websiteId);
    expect((await viewer.agent.get(`/api/reports/${scanId}/browsers`)).status).toBe(200);
    expect((await outsider.agent.get(`/api/reports/${scanId}/browsers`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/reports/${scanId}/browsers`)).status).toBe(401);
    expect(
      (await owner.agent.get('/api/reports/not-a-scan/browsers')).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('browser and check-type filters', () => {
  it('scan issues: by browser and cross-browser check type; UI check types unchanged; bad values 400', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const scanId = await seedCrossBrowserScan(websiteId);
    const titles = async (query: string) => {
      const res = await agent.get(`/api/scans/${scanId}/issues?${query}`);
      expect(res.status).toBe(200);
      return res.body.data.map((i: { title: string }) => i.title).sort();
    };
    expect(await titles('category=COMPATIBILITY&browser=FIREFOX')).toEqual([
      'Difference 1: Firefox',
      'Difference 2: Firefox',
    ]);
    expect(await titles('category=COMPATIBILITY&browser=WEBKIT')).toEqual([]);
    expect(await titles('checkType=BROWSER_ONLY_ERROR')).toEqual(['Difference 1: Firefox']);
    expect(await titles('browser=FIREFOX&checkType=UNSUPPORTED_CSS')).toEqual([
      'Difference 2: Firefox',
    ]);
    expect(await titles('checkType=BROKEN_LINK')).toEqual(['Broken link']);
    const issue = (await agent.get(`/api/scans/${scanId}/issues?checkType=BROWSER_ONLY_ERROR`)).body
      .data[0];
    expect(issue.compatibility).toMatchObject({
      browser: 'FIREFOX',
      checkType: 'BROWSER_ONLY_ERROR',
    });
    expect((await agent.get(`/api/scans/${scanId}/issues?browser=CHROMIUM`)).status).toBe(400);
    expect((await agent.get(`/api/scans/${scanId}/issues?browser=safari`)).status).toBe(400);
    expect((await agent.get(`/api/scans/${scanId}/issues?checkType=NOT_A_CHECK`)).status).toBe(400);
  });

  it('tracked issues of a website: by browser', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const scanId = await seedCrossBrowserScan(websiteId);
    for (const issue of await prisma.issue.findMany({ where: { scanId } })) {
      const tracked = await prisma.trackedIssue.create({
        data: {
          websiteId,
          fingerprint: issue.fingerprint,
          category: issue.category,
          ruleId: issue.ruleId,
          title: issue.title,
          severity: issue.severity,
          firstSeenScanId: scanId,
          lastSeenScanId: scanId,
        },
      });
      await prisma.issue.update({ where: { id: issue.id }, data: { trackedIssueId: tracked.id } });
    }
    const count = async (query: string) => {
      const res = await agent.get(`/api/websites/${websiteId}/issues?${query}`);
      expect(res.status).toBe(200);
      return res.body.data.length;
    };
    expect(await count('category=COMPATIBILITY')).toBe(2);
    expect(await count('category=COMPATIBILITY&browser=FIREFOX')).toBe(2);
    expect(await count('category=COMPATIBILITY&browser=WEBKIT')).toBe(0);
    expect(await count('')).toBe(3);
    expect((await agent.get(`/api/websites/${websiteId}/issues?browser=OPERA`)).status).toBe(400);
  });
});

describe('scan settings snapshot', () => {
  it('a new scan records whether other browsers were chosen', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    await agent
      .put(`/api/websites/${websiteId}`)
      .set(CSRF)
      .send({ crossBrowserEnabled: true, crossBrowserTargets: ['WEBKIT'] });
    const res = await agent.post('/api/scans').set(CSRF).send({ websiteId });
    expect(res.status).toBe(201);
    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(scan.config).toMatchObject({
      crossBrowserEnabled: true,
      crossBrowserTargets: ['WEBKIT'],
    });
  });
});

describe('exports', () => {
  const JSON_KEYS = [
    'category',
    'generatedAt',
    'issues',
    'pages',
    'project',
    'scan',
    'totalIssues',
    'website',
  ];
  const CSV_HEADER =
    '"Severity","Category","Rule","Title","Page URL","Screen size","CSS selector","WCAG","Tracking status","First detected","Last detected","Description","HTML","Suggested fix","Issue ID"';

  it('without other browsers: JSON has exactly the earlier keys and CSV the same columns', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const scan = await scanWith(websiteId, { crossBrowserEnabled: false });
    const json = (await agent.get(`/api/reports/${scan.id}/export?format=json`)).body;
    expect(Object.keys(json).sort()).toEqual(JSON_KEYS);
    const csv = (await agent.get(`/api/reports/${scan.id}/export?format=csv`).buffer(true)).text;
    expect(csv.replace(String.fromCharCode(0xfeff), '').split(/\r\n/)[0]).toBe(CSV_HEADER);
  });

  it('with other browsers: JSON adds the browser runs; CSV columns unchanged', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await site(agent);
    const scanId = await seedCrossBrowserScan(websiteId);
    const json = (await agent.get(`/api/reports/${scanId}/export?format=json`)).body;
    expect(Object.keys(json).sort()).toEqual([...JSON_KEYS, 'browsers'].sort());
    expect(json.browsers.chromiumVersion).toBe('Chromium 156.0.8078.80');
    expect(
      json.browsers.runs.map(
        (r: { browser: string; status: string }) => `${r.browser} ${r.status}`,
      ),
    ).toEqual(['FIREFOX COMPLETED', 'WEBKIT UNAVAILABLE']);
    const compat = json.issues.find((i: { category: string }) => i.category === 'COMPATIBILITY');
    expect(compat.compatibility).toMatchObject({
      browser: 'FIREFOX',
      browserVersion: 'Firefox 157.0',
    });
    const filtered = (
      await agent.get(`/api/reports/${scanId}/export?format=json&category=COMPATIBILITY`)
    ).body;
    expect(filtered.issues).toHaveLength(2);
    const csv = (await agent.get(`/api/reports/${scanId}/export?format=csv`).buffer(true)).text;
    const lines = csv.replace(String.fromCharCode(0xfeff), '').trim().split(/\r\n/);
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(4); // header + 3 issues
  });
});
