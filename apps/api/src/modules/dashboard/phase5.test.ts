/**
 * Phase 5 API: dashboard metrics and trends, scan history filters, reports,
 * exports, issue history, website stats, sessions and preferences.
 * Every expected number is computed from rows this test inserted itself.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  resetDatabase,
  signUp,
  TEST_PASSWORD,
  type Agent,
} from '../../../test/helpers';
import { daysBetween, resolveRange } from './dashboard.service';
import { csvCell } from '../reports/export';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function siteFor(agent: Agent, name = 'Home', baseUrl = 'https://example.com') {
  const project = (
    await agent
      .post('/api/projects')
      .set(CSRF)
      .send({ name: `${name} project` })
  ).body.data;
  const website = (
    await agent.post('/api/websites').set(CSRF).send({
      projectId: project.id,
      name,
      baseUrl,
      authorizationConfirmed: true,
    })
  ).body.data;
  return { projectId: project.id as string, websiteId: website.id as string };
}

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** A finished scan with issues + their tracked identities, as the scanner saves them. */
async function seedScan(
  websiteId: string,
  options: {
    status?: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' | 'QUEUED';
    createdAt?: Date;
    a11y?: number | null;
    ui?: number | null;
    issues?: { rule: string; severity: Sev; category?: 'ACCESSIBILITY' | 'UI_HEALTH' }[];
  } = {},
) {
  const createdAt = options.createdAt ?? new Date();
  const issues = options.issues ?? [];
  const scan = await prisma.scan.create({
    data: {
      websiteId,
      config: {},
      status: options.status ?? 'COMPLETED',
      createdAt,
      startedAt: createdAt,
      finishedAt: new Date(createdAt.getTime() + 30_000),
      durationMs: 30_000,
      pagesScanned: 1,
      accessibilityScore: options.a11y === undefined ? 80 : options.a11y,
      uiHealthScore: options.ui === undefined ? 90 : options.ui,
      totalIssues: issues.length,
      criticalCount: issues.filter((i) => i.severity === 'CRITICAL').length,
      highCount: issues.filter((i) => i.severity === 'HIGH').length,
    },
  });
  const page = await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      status: 'DONE',
      consoleErrors: [{ type: 'error', text: 'Uncaught TypeError: x is undefined' }],
    },
  });
  const ids: string[] = [];
  for (const spec of issues) {
    const category = spec.category ?? 'ACCESSIBILITY';
    const tracked = await prisma.trackedIssue.upsert({
      where: { websiteId_fingerprint: { websiteId, fingerprint: spec.rule } },
      create: {
        websiteId,
        fingerprint: spec.rule,
        category,
        ruleId: spec.rule,
        title: `Rule ${spec.rule}`,
        severity: spec.severity,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
        firstSeenScanId: scan.id,
        lastSeenScanId: scan.id,
      },
      update: { lastSeenAt: createdAt, lastSeenScanId: scan.id, occurrenceCount: { increment: 1 } },
    });
    const issue = await prisma.issue.create({
      data: {
        scanId: scan.id,
        scanPageId: page.id,
        trackedIssueId: tracked.id,
        category,
        severity: spec.severity,
        ruleId: spec.rule,
        title: `Rule ${spec.rule}`,
        description: 'Description',
        pageUrl: 'https://example.com/',
        viewport: '1920x1080',
        selector: `#${spec.rule}`,
        suggestedFix: 'Fix it',
        fingerprint: spec.rule,
        createdAt,
        ...(category === 'ACCESSIBILITY'
          ? {
              accessibility: {
                create: { axeRuleId: spec.rule, wcagCriteria: ['1.1.1'], wcagLevel: 'A' },
              },
            }
          : {
              uiHealth: {
                create: {
                  checkType: 'BROKEN_LINK',
                  resourceUrl: 'https://example.com/x',
                  statusCode: 404,
                },
              },
            }),
      },
    });
    ids.push(issue.id);
  }
  return { scanId: scan.id, issueIds: ids };
}

describe('date range helpers', () => {
  it('defaults to the last 30 whole UTC days and lists every day', () => {
    const range = resolveRange({ to: new Date('2026-03-31T10:00:00Z') });
    expect(range.from.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-03-31T23:59:59.999Z');
    expect(daysBetween(range.from, range.to)).toHaveLength(30);
  });

  it('caps the range at about a year', () => {
    const range = resolveRange({ from: new Date('2020-01-01'), to: new Date('2026-01-01') });
    expect(daysBetween(range.from, range.to).length).toBeLessThanOrEqual(367);
  });
});

describe('GET /api/dashboard/summary', () => {
  it('matches the database: totals, open issues by severity/category, latest-scan scores', async () => {
    const { agent } = await signUp(ctx.app);
    const a = await siteFor(agent, 'Alpha', 'https://example.org');
    const b = await siteFor(agent, 'Beta', 'https://shop.example.net');

    // Alpha: an older scan (score 50) and a newer one (score 70): only the latest counts.
    await seedScan(a.websiteId, {
      createdAt: daysAgo(5),
      a11y: 50,
      ui: 60,
      issues: [{ rule: 'old', severity: 'LOW' }],
    });
    await seedScan(a.websiteId, {
      createdAt: daysAgo(1),
      a11y: 70,
      ui: 80,
      issues: [
        { rule: 'c1', severity: 'CRITICAL' },
        { rule: 'h1', severity: 'HIGH' },
        { rule: 'u1', severity: 'HIGH', category: 'UI_HEALTH' },
      ],
    });
    // Beta: one finished scan (score 90) plus a FAILED one that must not affect scores.
    await seedScan(b.websiteId, {
      createdAt: daysAgo(2),
      a11y: 90,
      ui: 100,
      issues: [{ rule: 'm1', severity: 'MEDIUM' }],
    });
    await seedScan(b.websiteId, { status: 'FAILED', createdAt: daysAgo(0), a11y: null, ui: null });
    // Resolve one issue (yesterday) and ignore another: neither is "open".
    await prisma.trackedIssue.update({
      where: { websiteId_fingerprint: { websiteId: a.websiteId, fingerprint: 'old' } },
      data: { status: 'RESOLVED', resolvedAt: daysAgo(1) },
    });
    await prisma.trackedIssue.update({
      where: { websiteId_fingerprint: { websiteId: b.websiteId, fingerprint: 'm1' } },
      data: { status: 'IGNORED' },
    });

    const res = await agent.get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.totals).toEqual({
      projects: 2,
      websites: 2,
      scans: 4,
      openIssues: 3,
      criticalIssues: 1,
      highIssues: 2,
      resolvedIssues: 1,
    });
    expect(s.scores).toEqual({
      accessibility: 80,
      uiHealth: 90,
      seo: null, // these seeded scans have no SEO / security audit data
      security: null,
      performance: null,
      websitesMeasured: 2,
    });
    expect(s.openBySeverity).toEqual([
      { severity: 'CRITICAL', count: 1 },
      { severity: 'HIGH', count: 2 },
      { severity: 'MEDIUM', count: 0 },
      { severity: 'LOW', count: 0 },
      { severity: 'INFO', count: 0 },
    ]);
    expect(s.openByCategory).toEqual([
      { category: 'ACCESSIBILITY', count: 2 },
      { category: 'UI_HEALTH', count: 1 },
    ]);
    expect(s.recentScans[0].status).toBe('FAILED');
    expect(s.recentWebsites).toHaveLength(2);
  });

  it('applies project, website and status filters', async () => {
    const { agent } = await signUp(ctx.app);
    const a = await siteFor(agent, 'Alpha', 'https://example.org');
    const b = await siteFor(agent, 'Beta', 'https://shop.example.net');
    await seedScan(a.websiteId, { issues: [{ rule: 'x', severity: 'HIGH' }] });
    await seedScan(b.websiteId, { status: 'FAILED' });

    const byProject = (await agent.get(`/api/dashboard/summary?projectId=${a.projectId}`)).body
      .data;
    expect(byProject.totals).toMatchObject({ projects: 1, websites: 1, scans: 1, openIssues: 1 });
    const byWebsite = (await agent.get(`/api/dashboard/summary?websiteId=${b.websiteId}`)).body
      .data;
    expect(byWebsite.totals).toMatchObject({ websites: 1, scans: 1, openIssues: 0 });
    const failed = (await agent.get('/api/dashboard/summary?status=FAILED')).body.data;
    expect(failed.totals.scans).toBe(1);
  });

  it("never includes other users' data", async () => {
    const owner = await signUp(ctx.app);
    const other = await signUp(ctx.app);
    const site = await siteFor(owner.agent);
    await seedScan(site.websiteId, { issues: [{ rule: 'secret', severity: 'CRITICAL' }] });

    const res = await other.agent.get('/api/dashboard/summary');
    expect(res.body.data.totals).toMatchObject({
      projects: 0,
      websites: 0,
      scans: 0,
      openIssues: 0,
    });
    expect(res.body.data.recentScans).toEqual([]);
    // Filtering by someone else's website ID returns nothing either.
    const sneaky = await other.agent.get(`/api/dashboard/summary?websiteId=${site.websiteId}`);
    expect(sneaky.body.data.totals.scans).toBe(0);
  });

  it('requires sign-in', async () => {
    const { default: request } = await import('supertest');
    expect((await request(ctx.app).get('/api/dashboard/summary')).status).toBe(401);
  });
});

describe('GET /api/dashboard/trends', () => {
  it('groups scans, scores and new/resolved issues per day, with empty days filled', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
    await seedScan(site.websiteId, {
      createdAt: day(10),
      a11y: 60,
      issues: [
        { rule: 'r1', severity: 'HIGH' },
        { rule: 'r2', severity: 'LOW' },
      ],
    });
    await seedScan(site.websiteId, { createdAt: day(10), a11y: 80 });
    await seedScan(site.websiteId, { status: 'FAILED', createdAt: day(12), a11y: null });
    await prisma.trackedIssue.updateMany({
      where: { websiteId: site.websiteId, fingerprint: 'r2' },
      data: { status: 'RESOLVED', resolvedAt: day(12) },
    });

    const res = await agent.get('/api/dashboard/trends?from=2026-10-09&to=2026-10-13');
    expect(res.status).toBe(200);
    const points = res.body.data.points as Record<string, unknown>[];
    expect(points.map((p) => p.date)).toEqual([
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(points[1]).toMatchObject({
      completed: 2,
      failed: 0,
      accessibilityScore: 70,
      newIssues: 2,
      resolvedIssues: 0,
    });
    expect(points[2]).toMatchObject({ completed: 0, accessibilityScore: null, newIssues: 0 });
    expect(points[3]).toMatchObject({ failed: 1, completed: 0, resolvedIssues: 1 });
  });
});

describe('scan history filters', () => {
  it('filters by website, status, date range and search text', async () => {
    const { agent } = await signUp(ctx.app);
    const a = await siteFor(agent, 'Alpha shop', 'https://example.org');
    const b = await siteFor(agent, 'Beta blog', 'https://shop.example.net');
    await seedScan(a.websiteId, { createdAt: daysAgo(10) });
    await seedScan(a.websiteId, { status: 'FAILED', createdAt: daysAgo(1) });
    await seedScan(b.websiteId, { status: 'PARTIAL', createdAt: daysAgo(1) });

    const total = async (query: string) => (await agent.get(`/api/scans?${query}`)).body.meta.total;
    expect(await total('')).toBe(3);
    expect(await total(`websiteId=${a.websiteId}`)).toBe(2);
    expect(await total(`projectId=${b.projectId}`)).toBe(1);
    expect(await total('status=FAILED')).toBe(1);
    expect(await total(`from=${daysAgo(3).toISOString()}`)).toBe(2);
    expect(await total('q=beta')).toBe(1);
    expect(await total('q=example.org')).toBe(2);
    expect(await total('pageSize=1')).toBe(3);
    expect((await agent.get('/api/scans?pageSize=1')).body.data).toHaveLength(1);
  });
});

describe('issue filters, history and status tracking', () => {
  it("filters a scan's issues by category, severity, search and tracked status", async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId, {
      issues: [
        { rule: 'image-alt', severity: 'CRITICAL' },
        { rule: 'label', severity: 'HIGH' },
        { rule: 'broken', severity: 'HIGH', category: 'UI_HEALTH' },
      ],
    });
    const count = async (q: string) =>
      (await agent.get(`/api/scans/${scanId}/issues?${q}`)).body.meta.total;
    expect(await count('')).toBe(3);
    expect(await count('category=UI_HEALTH')).toBe(1);
    expect(await count('severity=HIGH')).toBe(2);
    expect(await count('q=image')).toBe(1);
    expect(await count('checkType=BROKEN_LINK')).toBe(1);
    expect((await agent.get(`/api/scans/${scanId}/issues?checkType=NOPE`)).status).toBe(400);

    const tracked = await prisma.trackedIssue.findFirstOrThrow({ where: { ruleId: 'label' } });
    await agent
      .patch(`/api/tracked-issues/${tracked.id}`)
      .set(CSRF)
      .send({ status: 'FALSE_POSITIVE' });
    expect(await count('trackedStatus=FALSE_POSITIVE')).toBe(1);
    expect(await count('trackedStatus=OPEN')).toBe(2);
  });

  it('GET /api/issues/:id returns the issue with its detection and status timeline', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    await seedScan(site.websiteId, {
      createdAt: daysAgo(3),
      issues: [{ rule: 'image-alt', severity: 'HIGH' }],
    });
    const second = await seedScan(site.websiteId, {
      createdAt: daysAgo(1),
      issues: [{ rule: 'image-alt', severity: 'HIGH' }],
    });
    const issueId = second.issueIds[0]!;
    const tracked = await prisma.trackedIssue.findFirstOrThrow({ where: { ruleId: 'image-alt' } });
    await agent.patch(`/api/tracked-issues/${tracked.id}`).set(CSRF).send({ status: 'IGNORED' });
    await agent.patch(`/api/tracked-issues/${tracked.id}`).set(CSRF).send({ status: 'OPEN' });

    const res = await agent.get(`/api/issues/${issueId}`);
    expect(res.status).toBe(200);
    const h = res.body.data;
    expect(h.issue).toMatchObject({ id: issueId, ruleId: 'image-alt', selector: '#image-alt' });
    expect(h.tracking).toMatchObject({ status: 'OPEN', occurrenceCount: 2 });
    expect(h.myRole).toBe('OWNER');
    const types = h.timeline.map((t: { type: string }) => t.type);
    expect(types.filter((t: string) => t === 'DETECTED')).toHaveLength(2);
    expect(h.timeline[0]).toMatchObject({ type: 'STATUS_CHANGED', from: 'IGNORED', to: 'OPEN' });

    const outsider = await signUp(ctx.app);
    expect((await outsider.agent.get(`/api/issues/${issueId}`)).status).toBe(404);
  });
});

describe('website stats and tracked issues', () => {
  it('counts scans and tracked issues by status', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    await seedScan(site.websiteId, {
      a11y: 40,
      issues: [
        { rule: 'a', severity: 'HIGH' },
        { rule: 'b', severity: 'LOW' },
      ],
    });
    await seedScan(site.websiteId, {
      status: 'FAILED',
      createdAt: new Date(Date.now() + 1000),
      a11y: null,
    });
    await prisma.trackedIssue.updateMany({
      where: { ruleId: 'b' },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    const stats = (await agent.get(`/api/websites/${site.websiteId}/stats`)).body.data;
    expect(stats.totalScans).toBe(2);
    expect(stats.latestScan.accessibilityScore).toBe(40); // latest *finished* scan
    expect(stats.issues).toEqual({ open: 1, resolved: 1, ignored: 0, falsePositive: 0 });

    const open = await agent.get(`/api/websites/${site.websiteId}/issues?status=OPEN`);
    expect(open.body.meta.total).toBe(1);
    expect(open.body.data[0]).toMatchObject({
      ruleId: 'a',
      latest: { pageUrl: 'https://example.com/' },
    });

    const outsider = await signUp(ctx.app);
    expect((await outsider.agent.get(`/api/websites/${site.websiteId}/stats`)).status).toBe(404);
  });

  it('website activity includes scans and issue status changes', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const other = await siteFor(agent, 'Other', 'https://example.org');
    await agent.post('/api/scans').set(CSRF).send({ websiteId: site.websiteId });
    await agent.post('/api/scans').set(CSRF).send({ websiteId: other.websiteId });
    await seedScan(site.websiteId, { issues: [{ rule: 'image-alt', severity: 'HIGH' }] });
    const tracked = await prisma.trackedIssue.findFirstOrThrow({
      where: { websiteId: site.websiteId },
    });
    await agent.patch(`/api/tracked-issues/${tracked.id}`).set(CSRF).send({ status: 'IGNORED' });
    const res = await agent.get(`/api/activity?websiteId=${site.websiteId}`);
    const actions = res.body.data.map((a: { action: string }) => a.action);
    expect(actions).toContain('scan.started');
    expect(actions).toContain('website.created');
    expect(actions).toContain('issue.status_changed');
    expect(
      res.body.data.every(
        (a: { metadata: { websiteId?: string } | null; entityId: string }) =>
          a.entityId === site.websiteId || a.metadata?.websiteId === site.websiteId,
      ),
    ).toBe(true);
  });
});

describe('reports', () => {
  it('accessibility report aggregates criteria, rules and pages; checklist is saved', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId, {
      issues: [
        { rule: 'image-alt', severity: 'CRITICAL' },
        { rule: 'label', severity: 'HIGH' },
        { rule: 'broken', severity: 'HIGH', category: 'UI_HEALTH' },
      ],
    });
    const res = await agent.get(`/api/reports/${scanId}/accessibility`);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.totals).toMatchObject({ violations: 2, rules: 2, pagesAffected: 1 });
    expect(r.criteria[0]).toMatchObject({
      criterion: '1.1.1',
      name: 'Non-text Content',
      issues: 2,
    });
    expect(Object.keys(r.checklist)).toContain('keyboard');

    const saved = await agent
      .patch(`/api/reports/${scanId}/accessibility/checklist`)
      .set(CSRF)
      .send({ itemId: 'keyboard', status: 'FAIL', note: 'Menu traps focus' });
    expect(saved.status).toBe(200);
    const again = (await agent.get(`/api/reports/${scanId}/accessibility`)).body.data;
    expect(again.checklist.keyboard).toMatchObject({ status: 'FAIL', note: 'Menu traps focus' });
    expect(
      (
        await agent
          .patch(`/api/reports/${scanId}/accessibility/checklist`)
          .set(CSRF)
          .send({ itemId: 'bogus', status: 'PASS' })
      ).status,
    ).toBe(400);
  });

  it('UI health report lists checks and console errors from the pages', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId, {
      issues: [{ rule: 'broken', severity: 'HIGH', category: 'UI_HEALTH' }],
    });
    const r = (await agent.get(`/api/reports/${scanId}/ui-health`)).body.data;
    expect(r.checks).toEqual([{ checkType: 'BROKEN_LINK', count: 1, highestSeverity: 'HIGH' }]);
    expect(r.consoleErrors[0].text).toContain('TypeError');
  });

  it('performance says honestly that nothing was measured', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId);
    const r = (await agent.get(`/api/reports/${scanId}/performance`)).body.data;
    expect(r).toMatchObject({ pages: [], history: [] });
    expect(r.scan.performanceScore).toBeNull();
    expect(r.notMeasuredReason).toContain('Nothing is estimated');
  });

  it('reports are not visible to outsiders', async () => {
    const owner = await signUp(ctx.app);
    const outsider = await signUp(ctx.app);
    const site = await siteFor(owner.agent);
    const { scanId } = await seedScan(site.websiteId);
    expect((await outsider.agent.get(`/api/reports/${scanId}/accessibility`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/reports/${scanId}/export?format=csv`)).status).toBe(404);
  });
});

describe('exports', () => {
  it('CSV contains real rows and neutralises spreadsheet formulas', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId, {
      issues: [{ rule: 'image-alt', severity: 'HIGH' }],
    });
    await prisma.issue.updateMany({
      where: { scanId },
      data: { title: '=HYPERLINK("http://evil")' },
    });

    const res = await agent.get(`/api/reports/${scanId}/export?format=csv`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+\.csv"/);
    const lines = res.text.replace(String.fromCharCode(0xfeff), '').trim().split(/\r?\n/);
    expect(lines).toHaveLength(2); // header + 1 issue
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain('https://example.com');
  });

  it('csvCell escapes quotes and formula prefixes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell(null)).toBe('""');
  });

  it('JSON export has scan, summary and issues; category filter narrows it', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId, {
      issues: [
        { rule: 'image-alt', severity: 'HIGH' },
        { rule: 'broken', severity: 'LOW', category: 'UI_HEALTH' },
      ],
    });
    const all = await agent.get(`/api/reports/${scanId}/export?format=json`);
    expect(all.status).toBe(200);
    expect(all.body.scan.id).toBe(scanId);
    expect(all.body.website.baseUrl).toBe('https://example.com/');
    expect(all.body.issues).toHaveLength(2);
    const ui = await agent.get(`/api/reports/${scanId}/export?format=json&category=UI_HEALTH`);
    expect(ui.body.issues).toHaveLength(1);
    expect((await agent.get(`/api/reports/${scanId}/export?format=xml`)).status).toBe(400);
  });

  it('PDF export is produced by the renderer and sent as a download', async () => {
    const { agent } = await signUp(ctx.app);
    const site = await siteFor(agent);
    const { scanId } = await seedScan(site.websiteId);
    const res = await agent
      .get(`/api/reports/${scanId}/export?format=pdf&category=ACCESSIBILITY`)
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/\.pdf"$/);
    expect(ctx.pdf.calls).toEqual([{ scanId, category: 'ACCESSIBILITY' }]);
  });
});

describe('sessions and preferences', () => {
  it('lists sessions, marks the current one, and signs out others', async () => {
    const { agent, user } = await signUp(ctx.app, { email: 'multi@example.com' });
    // A second device signs in.
    const { default: request } = await import('supertest');
    const phone = request.agent(ctx.app);
    await phone
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'multi@example.com', password: TEST_PASSWORD });

    const list = (await agent.get('/api/auth/sessions')).body.data;
    expect(list).toHaveLength(2);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const res = await agent.delete('/api/auth/sessions/others').set(CSRF);
    expect(res.body.data.revoked).toBe(1);
    // The phone can no longer refresh; this device still can.
    expect((await phone.post('/api/auth/refresh').set(CSRF)).status).toBe(401);
    expect((await agent.post('/api/auth/refresh').set(CSRF)).status).toBe(200);
    const after = (await agent.get('/api/auth/sessions')).body.data;
    expect(after).toHaveLength(1);

    // Revoking a single session by ID, and nobody else's.
    const other = await signUp(ctx.app);
    expect((await other.agent.delete(`/api/auth/sessions/${after[0].id}`).set(CSRF)).status).toBe(
      404,
    );
    expect((await agent.delete(`/api/auth/sessions/${after[0].id}`).set(CSRF)).status).toBe(204);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });

  it('reads defaults and saves notification preferences', async () => {
    const { agent } = await signUp(ctx.app);
    const defaults = (await agent.get('/api/auth/preferences')).body.data;
    expect(defaults).toEqual({
      scanCompleted: true,
      scanFailed: true,
      regressionDetected: true,
      weeklySummary: false,
      email: false,
    });
    const next = { ...defaults, weeklySummary: true, scanCompleted: false };
    expect((await agent.put('/api/auth/preferences').set(CSRF).send(next)).body.data).toEqual(next);
    expect((await agent.get('/api/auth/preferences')).body.data).toEqual(next);
    expect((await agent.put('/api/auth/preferences').set(CSRF).send({ email: 'yes' })).status).toBe(
      400,
    );
  });

  it('profile name update and password change work end to end', async () => {
    const { agent } = await signUp(ctx.app, { email: 'pw@example.com' });
    const renamed = await agent.patch('/api/auth/me').set(CSRF).send({ name: 'New Name' });
    expect(renamed.body.data.user.name).toBe('New Name');
    const changed = await agent
      .post('/api/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'An0ther-Strong-Passw0rd!' });
    expect(changed.status).toBe(204);
    const { default: request } = await import('supertest');
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'pw@example.com', password: 'An0ther-Strong-Passw0rd!' });
    expect(login.status).toBe(200);
  });
});
