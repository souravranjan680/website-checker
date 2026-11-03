/**
 * Phase 9, Milestone 1 in the API: the Functional report, the explorer settings of a
 * website, and bug reports built from interaction findings.
 */
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

async function site(agent: Agent, settings: object = {}) {
  const project = (await agent.post('/api/projects').set(CSRF).send({ name: 'Sites' })).body.data;
  const res = await agent
    .post('/api/websites')
    .set(CSRF)
    .send({
      projectId: project.id,
      name: 'App',
      baseUrl: 'https://example.com',
      authorizationConfirmed: true,
      ...settings,
    });
  return { projectId: project.id as string, website: res.body.data };
}

/** A finished scan with one explored page, as the scanner saves it. */
async function seedExploredScan(websiteId: string) {
  const scan = await prisma.scan.create({
    data: { websiteId, config: {}, status: 'COMPLETED', pagesScanned: 2 },
  });
  const page = await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      status: 'DONE',
      exploration: {
        url: 'https://example.com/',
        eligible: 3,
        explored: 3,
        controls: [
          { name: 'Account', kind: 'menu', result: 'opened' },
          { name: 'More filters', kind: 'disclosure', result: 'no-visible-effect' },
          { name: 'Help', kind: 'menu', result: 'opened' },
        ],
        skipped: [
          {
            name: 'Delete',
            role: 'button',
            selector: '#delete',
            reason: 'destructive-or-state-changing',
          },
        ],
        skippedCounts: { 'destructive-or-state-changing': 1, 'navigation-link': 4 },
        blocked: [
          { kind: 'request', method: 'POST', url: 'https://example.com/track', detail: 'fetch' },
        ],
        reloads: 1,
        stoppedEarly: null,
      },
    },
  });
  await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/b',
      normalizedUrl: 'https://example.com/b',
      status: 'DONE',
    },
  });
  const issue = await prisma.issue.create({
    data: {
      scanId: scan.id,
      scanPageId: page.id,
      category: 'FUNCTIONAL',
      severity: 'MEDIUM',
      ruleId: 'functional/control-no-effect',
      title: 'Control does nothing when used',
      description: 'Clicking “More filters” changed nothing on the page (tried 2 times).',
      pageUrl: 'https://example.com/',
      viewport: '1920x1080',
      selector: '#filters',
      fingerprint: 'f-functional',
      classification: 'POTENTIAL_DEFECT',
      functional: {
        create: {
          checkType: 'CONTROL_NO_EFFECT',
          controlName: 'More filters',
          controlRole: 'button',
          controlSelector: '#filters',
          interaction: { steps: ['Clicked “More filters”'], attempts: 2 },
        },
      },
    },
  });
  await prisma.issue.create({
    data: {
      scanId: scan.id,
      scanPageId: page.id,
      category: 'ACCESSIBILITY',
      severity: 'CRITICAL',
      ruleId: 'button-name',
      title: 'Buttons must have discernible text',
      description: 'd',
      fingerprint: 'f-open-state',
      classification: 'DETECTED',
      details: { interactionState: { opened: 'Account' } },
    },
  });
  return { scanId: scan.id, issueId: issue.id };
}

describe('GET /api/reports/:scanId/functional', () => {
  it('summarises explored pages, skipped controls, blocked actions and findings', async () => {
    const { agent } = await signUp(ctx.app);
    const { website } = await site(agent);
    const { scanId } = await seedExploredScan(website.id);

    const res = await agent.get(`/api/reports/${scanId}/functional`);
    expect(res.status).toBe(200);
    const report = res.body.data;
    expect(report.checks).toEqual([
      {
        checkType: 'CONTROL_NO_EFFECT',
        count: 1,
        highestSeverity: 'MEDIUM',
        byClassification: { POTENTIAL_DEFECT: 1 },
      },
    ]);
    expect(report.openStateAccessibilityIssues).toBe(1);
    expect(report.totals).toEqual({
      pagesExplored: 1,
      controlsExplored: 3,
      controlsSkipped: 5,
      actionsBlocked: 1,
    });
    expect(report.pages).toHaveLength(1); // the second page was not explored
    expect(report.pages[0].skipped).toEqual([
      { name: 'Delete', role: 'button', reason: 'destructive-or-state-changing' },
    ]);
  });

  it('is only visible to project members', async () => {
    const owner = await signUp(ctx.app);
    const outsider = await signUp(ctx.app);
    const { website } = await site(owner.agent);
    const { scanId } = await seedExploredScan(website.id);
    expect((await outsider.agent.get(`/api/reports/${scanId}/functional`)).status).toBe(404);
  });
});

describe('explorer settings of a website', () => {
  it('defaults to 5 pages × 30 controls, and can be changed or switched off', async () => {
    const { agent } = await signUp(ctx.app);
    const { website } = await site(agent);
    expect(website).toMatchObject({
      explorationEnabled: true,
      explorationPageLimit: 5,
      explorationControlLimit: 30,
    });
    const updated = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ explorationEnabled: false, explorationPageLimit: 2, explorationControlLimit: 10 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      explorationEnabled: false,
      explorationPageLimit: 2,
      explorationControlLimit: 10,
    });
  });

  it('keeps the settings when an older client saves a website without them', async () => {
    const { agent } = await signUp(ctx.app);
    const { website } = await site(agent, { explorationEnabled: false, explorationPageLimit: 2 });
    const updated = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ name: 'Renamed', maxPages: 10 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      name: 'Renamed',
      explorationEnabled: false,
      explorationPageLimit: 2,
      explorationControlLimit: 30,
    });
  });

  it('rejects limits outside the allowed range', async () => {
    const { agent } = await signUp(ctx.app);
    const { website } = await site(agent);
    const res = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ explorationPageLimit: 11, explorationControlLimit: 0 });
    expect(res.status).toBe(400);
  });
});

describe('existing endpoints with interaction findings', () => {
  it('count, list, compare, report and export them without breaking older scans', async () => {
    const { agent } = await signUp(ctx.app);
    const { website } = await site(agent);
    // A scan from before the explorer existed: no FUNCTIONAL issues, no exploration data.
    const older = await prisma.scan.create({
      data: { websiteId: website.id, config: {}, status: 'COMPLETED', accessibilityScore: 90 },
    });
    const { scanId } = await seedExploredScan(website.id);
    await prisma.scan.update({
      where: { id: scanId },
      data: { previousScanId: older.id, accessibilityScore: 90 },
    });

    const details = (await agent.get(`/api/scans/${scanId}`)).body.data;
    expect(details.categoryCounts).toEqual({ FUNCTIONAL: 1, ACCESSIBILITY: 1 });
    expect(details.severityCounts).toMatchObject({ CRITICAL: 1, MEDIUM: 1 });
    expect(details.totalIssues).toBe(2);
    expect(details.accessibilityScore).toBe(90); // stored score, unchanged

    const listed = await agent.get(`/api/scans/${scanId}/issues?category=FUNCTIONAL`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].functional).toMatchObject({ checkType: 'CONTROL_NO_EFFECT' });
    const oldIssue = (await agent.get(`/api/scans/${scanId}/issues?category=ACCESSIBILITY`)).body
      .data[0];
    expect(oldIssue.functional).toBeNull();

    const compare = await agent.get(`/api/scans/${scanId}/compare`);
    expect(compare.status).toBe(200);

    for (const report of [
      'accessibility',
      'ui-health',
      'responsive',
      'seo',
      'security',
      'performance',
    ])
      expect((await agent.get(`/api/reports/${scanId}/${report}`)).status, report).toBe(200);
    expect((await agent.get(`/api/reports/${older.id}/functional`)).body.data.pages).toEqual([]);

    const csv = await agent.get(`/api/reports/${scanId}/export?format=csv&category=FUNCTIONAL`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('functional/control-no-effect');
    const json = await agent.get(`/api/reports/${scanId}/export?format=json`);
    expect(json.status).toBe(200);
    expect(JSON.stringify(json.body)).toContain('FUNCTIONAL');

    for (const path of ['/api/dashboard/summary', '/api/dashboard/trends'])
      expect((await agent.get(path)).status, path).toBe(200);
    for (const path of [`/issues?category=FUNCTIONAL`, `/scans`, `/stats`])
      expect((await agent.get(`/api/websites/${website.id}${path}`)).status, path).toBe(200);
  });
});

describe('bug reports from interaction findings', () => {
  it('use only the steps the explorer recorded, and the check’s expectation', async () => {
    const { agent } = await signUp(ctx.app);
    const { website } = await site(agent);
    const { issueId } = await seedExploredScan(website.id);
    const res = await agent.post('/api/bug-reports').set(CSRF).send({ issueId });
    expect(res.status).toBe(201);
    const report = res.body.data;
    expect(report.stepsToReproduce).toContain('Clicked “More filters”.');
    expect(report.expectedBehavior).toBe(
      'Using the control shows the content or menu it controls.',
    );
  });
});
