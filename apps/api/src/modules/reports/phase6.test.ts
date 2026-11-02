/**
 * Phase 6 report endpoints. Every expected number is computed from rows this test
 * inserted, the same way the scanner saves them.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

async function siteFor(agent: Agent) {
  const project = (await agent.post('/api/projects').set(CSRF).send({ name: 'Sites' })).body.data;
  const website = (
    await agent.post('/api/websites').set(CSRF).send({
      projectId: project.id,
      name: 'Home',
      baseUrl: 'https://example.com',
      authorizationConfirmed: true,
    })
  ).body.data;
  return { projectId: project.id as string, websiteId: website.id as string };
}

/** A finished scan with two pages and SEO issues, as the scanner stores them. */
async function seedSeoScan(websiteId: string) {
  const scan = await prisma.scan.create({
    data: {
      websiteId,
      config: {},
      status: 'COMPLETED',
      finishedAt: new Date(),
      pagesScanned: 2,
      seoScore: 87,
      siteChecks: {
        seo: {
          robotsTxt: {
            url: 'https://example.com/robots.txt',
            status: 200,
            found: true,
            blocksAll: false,
            sitemaps: [],
          },
          sitemap: {
            url: 'https://example.com/sitemap.xml',
            status: 404,
            found: false,
            validXml: false,
            source: 'default',
          },
        },
      },
    },
  });
  const home = await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      status: 'DONE',
      title: 'Home page of Example',
      metaDescription: 'A description that is long enough to be useful for people searching.',
      canonicalUrl: 'https://example.com/',
      h1Count: 1,
      seoData: {
        metaRobots: null,
        ogTitle: 'x',
        ogDescription: 'y',
        ogImage: 'z',
        headings: [],
        imagesTotal: 0,
        imagesWithoutAlt: 0,
      },
    },
  });
  const hidden = await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/thanks',
      normalizedUrl: 'https://example.com/thanks',
      status: 'DONE',
      title: null,
      h1Count: 0,
      responseHeaders: { 'x-robots-tag': 'noindex' },
      seoData: {
        metaRobots: null,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        headings: [],
        imagesTotal: 2,
        imagesWithoutAlt: 2,
      },
    },
  });
  const issue = (
    scanPageId: string | null,
    checkType: string,
    severity: 'HIGH' | 'MEDIUM' | 'LOW',
    pageUrl: string,
  ) =>
    prisma.issue.create({
      data: {
        scanId: scan.id,
        scanPageId,
        category: 'SEO',
        severity,
        ruleId: `seo/${checkType.toLowerCase().replace(/_/g, '-')}`,
        title: checkType,
        description: 'd',
        pageUrl,
        viewport: '1920x1080',
        fingerprint: `${checkType}-${pageUrl}`,
        seo: { create: { checkType: checkType as never, expected: 'e', actual: 'a' } },
      },
    });
  await issue(hidden.id, 'MISSING_TITLE', 'HIGH', hidden.url);
  await issue(hidden.id, 'NOINDEX', 'MEDIUM', hidden.url);
  await issue(hidden.id, 'MISSING_H1', 'MEDIUM', hidden.url);
  await issue(null, 'MISSING_SITEMAP', 'LOW', home.url);
  return { scanId: scan.id };
}

describe('GET /api/reports/:id/seo', () => {
  it('returns real checks, site files and page metadata', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedSeoScan(websiteId);

    const res = await agent.get(`/api/reports/${scanId}/seo`);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.scan.seoScore).toBe(87);
    expect(r.site.robotsTxt).toMatchObject({ status: 200, found: true });
    expect(r.site.sitemap).toMatchObject({ status: 404, found: false });
    expect(r.checks.map((c: { checkType: string }) => c.checkType)).toEqual([
      'MISSING_TITLE',
      'MISSING_H1',
      'NOINDEX',
      'MISSING_SITEMAP',
    ]);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toMatchObject({ indexable: true, hasOpenGraph: true, issues: 0 });
    // noindex from the X-Robots-Tag header is detected too; the site-level issue has no page.
    expect(r.pages[1]).toMatchObject({
      indexable: false,
      metaRobots: 'noindex',
      imagesWithoutAlt: 2,
      issues: 3,
    });
  });

  it('issues carry SEO details; the issue list filters by rule', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedSeoScan(websiteId);
    const res = await agent.get(`/api/scans/${scanId}/issues?category=SEO&ruleId=seo/noindex`);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].seo).toEqual({ checkType: 'NOINDEX', expected: 'e', actual: 'a' });
  });

  it('JSON export can be limited to SEO', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedSeoScan(websiteId);
    const res = await agent.get(`/api/reports/${scanId}/export?format=json&category=SEO`);
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(4);
    expect(res.body.scan.seoScore).toBe(87);
  });

  it('is not visible to outsiders', async () => {
    const owner = await signUp(ctx.app);
    const outsider = await signUp(ctx.app);
    const { websiteId } = await siteFor(owner.agent);
    const { scanId } = await seedSeoScan(websiteId);
    expect((await outsider.agent.get(`/api/reports/${scanId}/seo`)).status).toBe(404);
  });

  it('says honestly when a scan has no SEO data (scanned before Phase 6)', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const scan = await prisma.scan.create({
      data: { websiteId, config: {}, status: 'COMPLETED' },
    });
    const r = (await agent.get(`/api/reports/${scan.id}/seo`)).body.data;
    expect(r).toMatchObject({ site: null, checks: [], pages: [] });
    expect(r.scan.seoScore).toBeNull();
  });
});

/** A finished scan with security findings at all three levels. */
async function seedSecurityScan(websiteId: string) {
  const scan = await prisma.scan.create({
    data: {
      websiteId,
      config: {},
      status: 'COMPLETED',
      finishedAt: new Date(),
      pagesScanned: 1,
      securityScore: 33,
      siteChecks: {
        security: {
          servedOverHttps: true,
          tls: {
            host: 'example.com',
            port: 443,
            checked: true,
            valid: false,
            error: 'CERT_HAS_EXPIRED',
            validFrom: '2020-01-01T00:00:00.000Z',
            validTo: '2021-01-01T00:00:00.000Z',
            daysRemaining: -2000,
            issuer: 'Test CA',
            subject: 'example.com',
            protocol: 'TLSv1.3',
          },
          httpRedirect: {
            url: 'http://example.com/',
            status: 301,
            location: 'https://example.com/',
            redirectsToHttps: true,
          },
        },
      },
    },
  });
  await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      status: 'DONE',
      responseHeaders: { 'x-content-type-options': 'nosniff', server: 'nginx/1.18.0' },
    },
  });
  const finding = (checkType: string, findingLevel: string, severity: 'HIGH' | 'MEDIUM' | 'LOW') =>
    prisma.issue.create({
      data: {
        scanId: scan.id,
        category: 'SECURITY',
        severity,
        ruleId: `security/${checkType.toLowerCase().replace(/_/g, '-')}`,
        title: checkType,
        description: 'd',
        pageUrl: 'https://example.com/',
        viewport: '1920x1080',
        fingerprint: `${checkType}-${findingLevel}`,
        security: {
          create: {
            checkType: checkType as never,
            findingLevel: findingLevel as never,
            observedValue: 'observed',
          },
        },
      },
    });
  await finding('INVALID_CERTIFICATE', 'CONFIRMED', 'HIGH');
  await finding('MISSING_CSP', 'WARNING', 'MEDIUM');
  await finding('VERSION_DISCLOSURE', 'OBSERVATION', 'LOW');
  await finding('MIXED_CONTENT', 'CONFIRMED', 'HIGH');
  return { scanId: scan.id };
}

describe('GET /api/reports/:id/security', () => {
  it('groups findings by level and returns TLS, redirect and header facts', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedSecurityScan(websiteId);
    const r = (await agent.get(`/api/reports/${scanId}/security`)).body.data;
    expect(r.scan.securityScore).toBe(33);
    expect(r.levels).toEqual({ CONFIRMED: 2, WARNING: 1, OBSERVATION: 1 });
    expect(
      r.checks.map(
        (c: { checkType: string; findingLevel: string }) => `${c.checkType}:${c.findingLevel}`,
      ),
    ).toEqual([
      'INVALID_CERTIFICATE:CONFIRMED',
      'MIXED_CONTENT:CONFIRMED',
      'MISSING_CSP:WARNING',
      'VERSION_DISCLOSURE:OBSERVATION',
    ]);
    expect(r.site.tls).toMatchObject({ valid: false, error: 'CERT_HAS_EXPIRED' });
    expect(r.site.httpRedirect.redirectsToHttps).toBe(true);
    expect(r.headers[0].present).toEqual({
      'content-security-policy': false,
      'strict-transport-security': false,
      'x-frame-options': false,
      'x-content-type-options': true,
      'referrer-policy': false,
    });
  });

  it('issues carry the finding level', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedSecurityScan(websiteId);
    const res = await agent.get(`/api/scans/${scanId}/issues?category=SECURITY&severity=LOW`);
    expect(res.body.data[0].security).toMatchObject({
      checkType: 'VERSION_DISCLOSURE',
      findingLevel: 'OBSERVATION',
      observedValue: 'observed',
    });
  });

  it('CSV export can be limited to security, and outsiders get 404', async () => {
    const owner = await signUp(ctx.app);
    const outsider = await signUp(ctx.app);
    const { websiteId } = await siteFor(owner.agent);
    const { scanId } = await seedSecurityScan(websiteId);
    const csv = await owner.agent
      .get(`/api/reports/${scanId}/export?format=csv&category=SECURITY`)
      .buffer(true);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('INVALID_CERTIFICATE');
    expect((await outsider.agent.get(`/api/reports/${scanId}/security`)).status).toBe(404);
  });

  it('says so when the scan has no security data', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const scan = await prisma.scan.create({ data: { websiteId, config: {}, status: 'COMPLETED' } });
    const r = (await agent.get(`/api/reports/${scan.id}/security`)).body.data;
    expect(r).toMatchObject({
      site: null,
      checks: [],
      levels: { CONFIRMED: 0, WARNING: 0, OBSERVATION: 0 },
    });
  });
});

/** Two finished scans of one website with Lighthouse rows, as the scanner stores them. */
async function seedPerformanceScans(websiteId: string) {
  const make = async (createdAt: Date, score: number, lcpMs: number, withFile: boolean) => {
    const scan = await prisma.scan.create({
      data: {
        websiteId,
        config: {},
        status: 'COMPLETED',
        createdAt,
        finishedAt: createdAt,
        performanceScore: score,
      },
    });
    const page = await prisma.scanPage.create({
      data: {
        scanId: scan.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        status: 'DONE',
      },
    });
    const rawReportKey = withFile ? `scans/${scan.id}/lighthouse/${page.id}-mobile.json` : null;
    if (rawReportKey) {
      const file = path.join(ctx.config.scans.storageDir, rawReportKey);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ lighthouseVersion: '13.5.0', audits: {} }));
    }
    const result = await prisma.performanceResult.create({
      data: {
        scanId: scan.id,
        scanPageId: page.id,
        performanceScore: score,
        accessibilityScore: 100,
        bestPracticesScore: 78,
        seoScore: 91,
        fcpMs: 1200,
        lcpMs,
        cls: 0.0123,
        tbtMs: 150,
        speedIndexMs: 2000,
        opportunities: [
          {
            id: 'render-blocking-insight',
            title: 'Render blocking requests',
            displayValue: 'Est savings of 900 ms',
            savingsMs: 900,
            savingsBytes: null,
          },
        ],
        diagnostics: {
          slowestRequests: [
            {
              url: 'https://example.com/app.js',
              resourceType: 'Script',
              transferSize: 1000,
              durationMs: 800,
            },
          ],
          totalByteWeight: 5000,
          warnings: [],
          error: null,
        },
        lighthouseVersion: '13.5.0',
        rawReportKey,
      },
    });
    return { scanId: scan.id, resultId: result.id };
  };
  const older = await make(new Date(Date.now() - 86_400_000), 55, 4200, false);
  const newer = await make(new Date(), 81, 2100, true);
  return { older, newer };
}

describe('GET /api/reports/:id/performance', () => {
  it('returns real Lighthouse metrics, opportunities and the website history', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { newer } = await seedPerformanceScans(websiteId);
    const r = (await agent.get(`/api/reports/${newer.scanId}/performance`)).body.data;
    expect(r.notMeasuredReason).toBeNull();
    expect(r.scan.performanceScore).toBe(81);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({
      url: 'https://example.com/',
      formFactor: 'MOBILE',
      error: null,
      scores: { performance: 81, accessibility: 100, bestPractices: 78, seo: 91 },
      metrics: { lcpMs: 2100, cls: 0.0123, inpMs: null },
      rawReportAvailable: true,
      lighthouseVersion: '13.5.0',
    });
    expect(r.pages[0].opportunities[0].id).toBe('render-blocking-insight');
    expect(r.pages[0].slowestRequests[0].durationMs).toBe(800);
    // History is oldest first, with averaged metrics per scan.
    expect(
      r.history.map((h: { performanceScore: number; lcpMs: number }) => [
        h.performanceScore,
        h.lcpMs,
      ]),
    ).toEqual([
      [55, 4200],
      [81, 2100],
    ]);
  });

  it('downloads the raw Lighthouse JSON after a permission check', async () => {
    const owner = await signUp(ctx.app);
    const outsider = await signUp(ctx.app);
    const { websiteId } = await siteFor(owner.agent);
    const { newer, older } = await seedPerformanceScans(websiteId);
    const url = `/api/reports/${newer.scanId}/lighthouse/${newer.resultId}`;
    const res = await owner.agent.get(url).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('lighthouse-report.json');
    expect(JSON.parse(res.text).lighthouseVersion).toBe('13.5.0');
    expect((await outsider.agent.get(url)).status).toBe(404);
    // A result ID from another scan, or one without a stored file, is not served.
    expect(
      (await owner.agent.get(`/api/reports/${newer.scanId}/lighthouse/${older.resultId}`)).status,
    ).toBe(404);
    expect(
      (await owner.agent.get(`/api/reports/${older.scanId}/lighthouse/${older.resultId}`)).status,
    ).toBe(404);
  });
});
