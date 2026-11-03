/**
 * Phase 9, Milestone 2 (Checkpoint 2) in the API: the keyboard and form probe settings of
 * a website, and the probes' results in the Functional (Interactions) report.
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

describe('probe settings', () => {
  it('default to keyboard on and forms BLUR; SYNTHETIC only when chosen; older clients keep them', async () => {
    const { agent } = await signUp(ctx.app);
    const website = await site(agent);
    expect(website).toMatchObject({ keyboardProbeEnabled: true, formProbeMode: 'BLUR' });
    const opted = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ formProbeMode: 'SYNTHETIC', keyboardProbeEnabled: false });
    expect(opted.body.data).toMatchObject({
      formProbeMode: 'SYNTHETIC',
      keyboardProbeEnabled: false,
    });
    const renamed = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ name: 'Renamed' });
    expect(renamed.body.data).toMatchObject({
      formProbeMode: 'SYNTHETIC',
      keyboardProbeEnabled: false,
    });
  });

  it('rejects unknown modes', async () => {
    const { agent } = await signUp(ctx.app);
    const website = await site(agent);
    const res = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ formProbeMode: 'SUBMIT' });
    expect(res.status).toBe(400);
  });
});

describe('Functional report', () => {
  it('shows each page’s keyboard and form probe results, with skipped items and reasons; null on older scans', async () => {
    const { agent } = await signUp(ctx.app);
    const website = await site(agent);
    const scan = await prisma.scan.create({
      data: { websiteId: website.id, config: {}, status: 'COMPLETED' },
    });
    const base = {
      explored: 1,
      eligible: 1,
      controls: [{ name: 'More', kind: 'disclosure', result: 'opened' }],
      skipped: [],
      skippedCounts: {},
      blocked: [],
      stoppedEarly: null,
    };
    await prisma.scanPage.create({
      data: {
        scanId: scan.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        status: 'DONE',
        exploration: {
          url: 'https://example.com/',
          ...base,
          keyboard: {
            steps: 12,
            stoppedBy: 'end',
            focusOrder: ['Home', 'More'],
            activation: [{ name: 'More', keys: [{ key: 'Enter', result: 'works' }] }],
            skipped: [{ name: 'Settings', reason: 'opens-dialog' }],
            clickableNotFocusable: 0,
          },
          forms: {
            mode: 'BLUR',
            fields: 3,
            probed: [{ name: 'Title', action: 'blur', outcome: 'no-feedback' }],
            skipped: [
              { name: 'E-mail', reason: 'personal-data-field' },
              { name: 'Password', reason: 'sensitive-field' },
            ],
            skippedCounts: { 'personal-data-field': 1, 'sensitive-field': 1 },
          },
        },
      },
    });
    await prisma.scanPage.create({
      data: {
        scanId: scan.id,
        url: 'https://example.com/old',
        normalizedUrl: 'https://example.com/old',
        status: 'DONE',
        exploration: { url: 'https://example.com/old', ...base },
      },
    });

    const res = await agent.get(`/api/reports/${scan.id}/functional`);
    expect(res.status).toBe(200);
    const report = res.body.data;
    expect(report.totals).toMatchObject({
      pagesExplored: 2,
      pagesKeyboardChecked: 1,
      formFieldsProbed: 1,
      probesSkipped: 3,
    });
    const [probed, older] = report.pages;
    expect(probed.keyboard).toMatchObject({
      steps: 12,
      error: null,
      skipped: [{ name: 'Settings', reason: 'opens-dialog' }],
    });
    expect(probed.forms).toMatchObject({ mode: 'BLUR', fields: 3, error: null });
    expect(probed.forms.skipped).toHaveLength(2);
    expect(older).toMatchObject({ keyboard: null, forms: null });
  });
});
