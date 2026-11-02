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

async function createProject(agent: Agent, name = 'Sites'): Promise<string> {
  const res = await agent.post('/api/projects').set(CSRF).send({ name });
  return res.body.data.id as string;
}

function addWebsite(agent: Agent, projectId: string, overrides: Record<string, unknown> = {}) {
  return agent
    .post('/api/websites')
    .set(CSRF)
    .send({
      projectId,
      name: 'Homepage',
      baseUrl: 'https://example.com',
      authorizationConfirmed: true,
      ...overrides,
    });
}

describe('create website', () => {
  it('normalizes the URL, applies default crawl settings and records authorization', async () => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);

    const res = await addWebsite(agent, projectId, { baseUrl: 'Example.com/#intro', maxPages: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      baseUrl: 'https://example.com/',
      hostname: 'example.com',
      maxPages: 10,
      maxDepth: 2,
      verificationStatus: 'UNVERIFIED',
      scanCount: 0,
      lastScan: null,
      myRole: 'OWNER',
    });
    expect(res.body.data.authorizationConfirmedAt).toBeTruthy();
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'website.created' } });
    expect(log.metadata).toMatchObject({ authorizationConfirmed: true });
  });

  it('requires the authorization confirmation', async () => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);
    const res = await addWebsite(agent, projectId, { authorizationConfirmed: false });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('authorizationConfirmed');
  });

  it.each([
    ['http://localhost'],
    ['http://127.0.0.1'],
    ['http://0x7f.0.0.1'],
    ['http://169.254.169.254/latest/meta-data'],
    ['http://192.168.1.10'],
    ['ftp://example.com'],
    ['https://admin:secret@example.com'],
    ['https://example.com:8443'],
  ])('rejects the unsafe URL %s', async (baseUrl) => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);
    const res = await addWebsite(agent, projectId, { baseUrl });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('baseUrl');
  });

  it('rejects public-looking names that resolve to private addresses (DNS check)', async () => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);
    for (const host of ['sneaky.example.com', 'mixed.example.com']) {
      const res = await addWebsite(agent, projectId, { baseUrl: `https://${host}` });
      expect(res.status, host).toBe(400);
      expect(res.body.error.code).toBe('UNSAFE_URL');
    }
  });

  it('rejects domains that do not exist', async () => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);
    const res = await addWebsite(agent, projectId, { baseUrl: 'https://does-not-exist.example' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNRESOLVABLE_HOST');
  });

  it('rejects the same website twice in one project', async () => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);
    await addWebsite(agent, projectId);
    const res = await addWebsite(agent, projectId, { baseUrl: 'https://EXAMPLE.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WEBSITE_EXISTS');
  });
});

describe('read, update, delete', () => {
  it('lists with search and project filter, and shows details', async () => {
    const { agent } = await signUp(ctx.app);
    const p1 = await createProject(agent, 'One');
    const p2 = await createProject(agent, 'Two');
    const home = (await addWebsite(agent, p1)).body.data;
    await addWebsite(agent, p2, { name: 'Shop', baseUrl: 'https://shop.example.net' });

    expect((await agent.get('/api/websites')).body.meta.total).toBe(2);
    expect((await agent.get(`/api/websites?projectId=${p2}`)).body.data[0].name).toBe('Shop');
    expect((await agent.get('/api/websites?q=shop.example')).body.data).toHaveLength(1);

    const details = await agent.get(`/api/websites/${home.id}`);
    expect(details.body.data).toMatchObject({ projectName: 'One', name: 'Homepage' });
  });

  it('updates settings; changing the URL needs a fresh authorization confirmation', async () => {
    const { agent } = await signUp(ctx.app);
    const projectId = await createProject(agent);
    const website = (await addWebsite(agent, projectId)).body.data;

    const settings = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ name: 'Main site', maxDepth: 4 });
    expect(settings.body.data).toMatchObject({ name: 'Main site', maxDepth: 4 });

    const noConfirm = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ baseUrl: 'https://example.org' });
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.error.code).toBe('AUTHORIZATION_REQUIRED');

    const confirmed = await agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ baseUrl: 'https://example.org', authorizationConfirmed: true });
    expect(confirmed.body.data.hostname).toBe('example.org');
  });

  it('moves a website to another project only if you are an editor there', async () => {
    const alice = await signUp(ctx.app, { email: 'alice@example.com' });
    const bob = await signUp(ctx.app, { email: 'bob@example.com' });
    const aliceProject = await createProject(alice.agent, 'Alice');
    const otherAlice = await createProject(alice.agent, 'Alice 2');
    const bobProject = await createProject(bob.agent, 'Bob');
    const website = (await addWebsite(alice.agent, aliceProject)).body.data;

    const intoBob = await alice.agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ projectId: bobProject });
    expect(intoBob.status).toBe(404);

    const ok = await alice.agent
      .put(`/api/websites/${website.id}`)
      .set(CSRF)
      .send({ projectId: otherAlice });
    expect(ok.body.data.projectName).toBe('Alice 2');
  });

  it('deletes a website', async () => {
    const { agent } = await signUp(ctx.app);
    const website = (await addWebsite(agent, await createProject(agent))).body.data;
    expect((await agent.delete(`/api/websites/${website.id}`).set(CSRF)).status).toBe(204);
    expect((await agent.get(`/api/websites/${website.id}`)).status).toBe(404);
  });

  it('returns a real, empty scan history (no fake scans)', async () => {
    const { agent } = await signUp(ctx.app);
    const website = (await addWebsite(agent, await createProject(agent))).body.data;
    const res = await agent.get(`/api/websites/${website.id}/scans`);
    expect(res.body).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    });
  });
});

describe('permissions and cross-user access', () => {
  it("another user can't see or change my website", async () => {
    const alice = await signUp(ctx.app, { email: 'alice@example.com' });
    const bob = await signUp(ctx.app, { email: 'bob@example.com' });
    const aliceProject = await createProject(alice.agent);
    const website = (await addWebsite(alice.agent, aliceProject)).body.data;

    expect((await bob.agent.get('/api/websites')).body.meta.total).toBe(0);
    expect((await bob.agent.get(`/api/websites?projectId=${aliceProject}`)).body.meta.total).toBe(
      0,
    );
    expect((await bob.agent.get(`/api/websites/${website.id}`)).status).toBe(404);
    expect((await bob.agent.get(`/api/websites/${website.id}/scans`)).status).toBe(404);
    expect(
      (await bob.agent.put(`/api/websites/${website.id}`).set(CSRF).send({ name: 'Hacked' }))
        .status,
    ).toBe(404);
    expect((await bob.agent.delete(`/api/websites/${website.id}`).set(CSRF)).status).toBe(404);
    // Nor add websites to my project
    expect(
      (await addWebsite(bob.agent, aliceProject, { baseUrl: 'https://example.org' })).status,
    ).toBe(404);
    expect(await prisma.website.count()).toBe(1);
  });

  it('VIEWER can see websites but not add, edit or delete them', async () => {
    const owner = await signUp(ctx.app, { email: 'owner@example.com' });
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const projectId = await createProject(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });
    const website = (await addWebsite(owner.agent, projectId)).body.data;

    expect((await viewer.agent.get(`/api/websites/${website.id}`)).body.data.myRole).toBe('VIEWER');
    expect(
      (await addWebsite(viewer.agent, projectId, { baseUrl: 'https://example.org' })).status,
    ).toBe(403);
    expect(
      (await viewer.agent.put(`/api/websites/${website.id}`).set(CSRF).send({ name: 'No' })).status,
    ).toBe(403);
    expect((await viewer.agent.delete(`/api/websites/${website.id}`).set(CSRF)).status).toBe(403);
  });

  it('EDITOR can add, edit and delete websites', async () => {
    const owner = await signUp(ctx.app, { email: 'owner@example.com' });
    const editor = await signUp(ctx.app, { email: 'editor@example.com' });
    const projectId = await createProject(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'editor@example.com', role: 'EDITOR' });

    const created = await addWebsite(editor.agent, projectId);
    expect(created.status).toBe(201);
    expect(
      (
        await editor.agent
          .put(`/api/websites/${created.body.data.id}`)
          .set(CSRF)
          .send({ maxPages: 5 })
      ).status,
    ).toBe(200);
    expect(
      (await editor.agent.delete(`/api/websites/${created.body.data.id}`).set(CSRF)).status,
    ).toBe(204);
  });
});
