/** Phase 9, Milestone 3 (Checkpoint 1): the cross-browser settings of a website. */
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
  return agent
    .post('/api/websites')
    .set(CSRF)
    .send({
      projectId: project.id,
      name: 'App',
      baseUrl: 'https://example.com',
      authorizationConfirmed: true,
      ...settings,
    });
}

describe('cross-browser settings', () => {
  it('are off by default, with Firefox and WebKit preselected, 3 pages, no mobile', async () => {
    const { agent } = await signUp(ctx.app);
    const res = await site(agent);
    expect(res.body.data).toMatchObject({
      crossBrowserEnabled: false,
      crossBrowserTargets: ['FIREFOX', 'WEBKIT'],
      crossBrowserPageLimit: 3,
      crossBrowserMobile: false,
    });
  });

  it('can be turned on and narrowed; older clients that omit them keep the stored values', async () => {
    const { agent } = await signUp(ctx.app);
    const website = (await site(agent)).body.data;
    const on = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({
        crossBrowserEnabled: true,
        crossBrowserTargets: ['WEBKIT'],
        crossBrowserPageLimit: 10,
        crossBrowserMobile: true,
      });
    expect(on.status).toBe(200);
    const renamed = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ name: 'Renamed' });
    expect(renamed.body.data).toMatchObject({
      crossBrowserEnabled: true,
      crossBrowserTargets: ['WEBKIT'],
      crossBrowserPageLimit: 10,
      crossBrowserMobile: true,
    });
  });

  it('rejects Chromium as a target (it is the scan browser), duplicates, and limits over 10', async () => {
    const { agent } = await signUp(ctx.app);
    const website = (await site(agent)).body.data;
    for (const body of [
      { crossBrowserTargets: ['CHROMIUM'] },
      { crossBrowserTargets: ['FIREFOX', 'FIREFOX'] },
      { crossBrowserPageLimit: 11 },
      { crossBrowserPageLimit: 0 },
    ]) {
      const res = await agent.put(`/api/websites/${website.id}`).set(CSRF).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
