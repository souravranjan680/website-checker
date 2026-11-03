/**
 * Phase 9, Milestone 2 (Checkpoint 1) in the API: the consistency setting of a website,
 * and the newer UI checks in the UI health report and issue filters.
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
  return res.body.data;
}

describe('component consistency setting', () => {
  it('is on by default, can be switched off, and older clients keep it', async () => {
    const { agent } = await signUp(ctx.app);
    const website = await site(agent);
    expect(website.consistencyEnabled).toBe(true);
    const off = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ consistencyEnabled: false });
    expect(off.body.data.consistencyEnabled).toBe(false);
    const renamed = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ name: 'Renamed' });
    expect(renamed.body.data).toMatchObject({ name: 'Renamed', consistencyEnabled: false });
  });

  it('rejects a value that is not a boolean', async () => {
    const { agent } = await signUp(ctx.app);
    const website = await site(agent);
    const res = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ consistencyEnabled: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('UI health report', () => {
  it('counts the newer checks at every screen size, by evidence, without changing the existing fields', async () => {
    const { agent } = await signUp(ctx.app);
    const website = await site(agent);
    const scan = await prisma.scan.create({
      data: { websiteId: website.id, config: {}, status: 'COMPLETED', uiHealthScore: 100 },
    });
    const page = await prisma.scanPage.create({
      data: {
        scanId: scan.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        status: 'DONE',
        components: [],
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
    const issue = (
      checkType: string,
      category: 'UI_HEALTH' | 'RESPONSIVE',
      classification: 'DETECTED' | 'POTENTIAL_DEFECT' | 'OBSERVATION',
      n: number,
    ) =>
      prisma.issue.create({
        data: {
          scanId: scan.id,
          scanPageId: page.id,
          category,
          severity: 'LOW',
          ruleId: `ui/${checkType.toLowerCase().replace(/_/g, '-')}`,
          title: checkType,
          description: 'd',
          viewport: category === 'RESPONSIVE' ? '390x844' : '1920x1080',
          fingerprint: `f-${checkType}-${n}`,
          classification,
          uiHealth: { create: { checkType: checkType as 'TEXT_OVERLAP' } },
        },
      });
    await issue('TEXT_OVERLAP', 'UI_HEALTH', 'POTENTIAL_DEFECT', 1);
    await issue('TEXT_OVERLAP', 'RESPONSIVE', 'POTENTIAL_DEFECT', 2);
    await issue('FONT_LOAD_FAILED', 'UI_HEALTH', 'DETECTED', 3);
    await issue('COMPONENT_INCONSISTENT', 'UI_HEALTH', 'OBSERVATION', 4);
    await issue('TEXT_CLIPPING', 'UI_HEALTH', 'POTENTIAL_DEFECT', 5); // an earlier check

    const res = await agent.get(`/api/reports/${scan.id}/ui-health`);
    expect(res.status).toBe(200);
    expect(res.body.data.extraChecks).toEqual({
      layout: 2,
      fontsAndIcons: 1,
      consistency: 1,
      consistencyPages: 1,
      byClassification: { POTENTIAL_DEFECT: 2, DETECTED: 1, OBSERVATION: 1 },
    });
    // The check list keeps its meaning: UI_HEALTH issues of this scan, newer ones included.
    expect(res.body.data.checks.map((c: { checkType: string }) => c.checkType).sort()).toEqual([
      'COMPONENT_INCONSISTENT',
      'FONT_LOAD_FAILED',
      'TEXT_CLIPPING',
      'TEXT_OVERLAP',
    ]);

    const filtered = await agent.get(
      `/api/scans/${scan.id}/issues?checkType=COMPONENT_INCONSISTENT`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
  });
});
