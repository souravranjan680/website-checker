import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  makeAdmin,
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

async function createProject(agent: Agent, name = 'Marketing sites') {
  const res = await agent
    .post('/api/projects')
    .set(CSRF)
    .send({ name, description: 'Public pages' });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

/** Owner creates a project and adds a member with the given role. */
async function projectWithMember(role: 'EDITOR' | 'VIEWER') {
  const owner = await signUp(ctx.app, { email: 'owner@example.com' });
  const member = await signUp(ctx.app, { email: `${role.toLowerCase()}@example.com` });
  const project = await createProject(owner.agent);
  const add = await owner.agent
    .post(`/api/projects/${project.id}/members`)
    .set(CSRF)
    .send({ email: member.user.email, role });
  expect(add.status).toBe(201);
  return { owner, member, project };
}

describe('project CRUD', () => {
  it('creates a project and makes the creator its OWNER', async () => {
    const { agent, user } = await signUp(ctx.app);
    const project = await createProject(agent);

    expect(project).toMatchObject({ name: 'Marketing sites', myRole: 'OWNER' });
    const membership = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: project.id },
    });
    expect(membership).toMatchObject({ userId: user.id, role: 'OWNER' });
  });

  it('lists, searches and paginates only my projects, with real counts', async () => {
    const { agent } = await signUp(ctx.app);
    for (const name of ['Alpha shop', 'Beta blog', 'Gamma shop']) await createProject(agent, name);

    const all = await agent.get('/api/projects');
    expect(all.body.meta).toMatchObject({ total: 3, page: 1 });
    expect(all.body.data[0]).toMatchObject({ websiteCount: 0, memberCount: 1, scanCount: 0 });

    const search = await agent.get('/api/projects?q=SHOP');
    expect(search.body.data.map((p: { name: string }) => p.name).sort()).toEqual([
      'Alpha shop',
      'Gamma shop',
    ]);

    const page2 = await agent.get('/api/projects?pageSize=2&page=2');
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.meta.totalPages).toBe(2);
  });

  it('shows project statistics computed from the database', async () => {
    const { agent } = await signUp(ctx.app);
    const project = await createProject(agent);
    await agent
      .post('/api/websites')
      .set(CSRF)
      .send({
        projectId: project.id,
        name: 'Home',
        baseUrl: 'https://example.com',
        authorizationConfirmed: true,
      });

    const res = await agent.get(`/api/projects/${project.id}`);
    expect(res.body.data.stats).toEqual({
      websiteCount: 1,
      memberCount: 1,
      scanCount: 0,
      completedScanCount: 0,
      openIssueCount: 0,
      lastScanAt: null,
    });
  });

  it('updates name and description', async () => {
    const { agent } = await signUp(ctx.app);
    const project = await createProject(agent);
    const res = await agent
      .put(`/api/projects/${project.id}`)
      .set(CSRF)
      .send({ name: 'Renamed', description: '' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', description: null });
  });

  it('deletes only when the exact project name is typed, and cascades to websites', async () => {
    const { agent } = await signUp(ctx.app);
    const project = await createProject(agent);
    await agent
      .post('/api/websites')
      .set(CSRF)
      .send({
        projectId: project.id,
        name: 'Home',
        baseUrl: 'example.com',
        authorizationConfirmed: true,
      });

    const wrong = await agent
      .delete(`/api/projects/${project.id}`)
      .set(CSRF)
      .send({ confirmName: 'nope' });
    expect(wrong.status).toBe(400);

    const ok = await agent
      .delete(`/api/projects/${project.id}`)
      .set(CSRF)
      .send({ confirmName: 'Marketing sites' });
    expect(ok.status).toBe(204);
    expect(await prisma.website.count()).toBe(0);
    expect((await agent.get(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it('validates input', async () => {
    const { agent } = await signUp(ctx.app);
    const res = await agent.post('/api/projects').set(CSRF).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'name' });
  });
});

describe('cross-user isolation', () => {
  it("another user cannot see, list, edit or delete my project (404, as if it didn't exist)", async () => {
    const alice = await signUp(ctx.app, { email: 'alice@example.com' });
    const bob = await signUp(ctx.app, { email: 'bob@example.com' });
    const project = await createProject(alice.agent);

    expect((await bob.agent.get('/api/projects')).body.meta.total).toBe(0);
    expect((await bob.agent.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect(
      (await bob.agent.put(`/api/projects/${project.id}`).set(CSRF).send({ name: 'Hacked' }))
        .status,
    ).toBe(404);
    expect(
      (
        await bob.agent
          .delete(`/api/projects/${project.id}`)
          .set(CSRF)
          .send({ confirmName: 'Marketing sites' })
      ).status,
    ).toBe(404);
    expect((await bob.agent.get(`/api/projects/${project.id}/members`)).status).toBe(404);
    expect((await bob.agent.get(`/api/activity?projectId=${project.id}`)).status).toBe(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).name).toBe(
      'Marketing sites',
    );
  });
});

describe('role permissions', () => {
  it('VIEWER can read but not edit, delete or manage members (403)', async () => {
    const { member, project } = await projectWithMember('VIEWER');

    const read = await member.agent.get(`/api/projects/${project.id}`);
    expect(read.status).toBe(200);
    expect(read.body.data.myRole).toBe('VIEWER');

    const edit = await member.agent
      .put(`/api/projects/${project.id}`)
      .set(CSRF)
      .send({ name: 'Nope' });
    expect(edit.status).toBe(403);
    expect(edit.body.error.code).toBe('FORBIDDEN');
    expect(
      (
        await member.agent
          .delete(`/api/projects/${project.id}`)
          .set(CSRF)
          .send({ confirmName: project.name })
      ).status,
    ).toBe(403);
    expect(
      (
        await member.agent
          .post(`/api/projects/${project.id}/members`)
          .set(CSRF)
          .send({ email: 'x@example.com', role: 'VIEWER' })
      ).status,
    ).toBe(403);
  });

  it('EDITOR can edit the project but not delete it or manage members', async () => {
    const { member, project } = await projectWithMember('EDITOR');

    expect(
      (await member.agent.put(`/api/projects/${project.id}`).set(CSRF).send({ name: 'Edited' }))
        .status,
    ).toBe(200);
    expect(
      (
        await member.agent
          .delete(`/api/projects/${project.id}`)
          .set(CSRF)
          .send({ confirmName: 'Edited' })
      ).status,
    ).toBe(403);
    expect(
      (
        await member.agent
          .patch(`/api/projects/${project.id}/members/${member.user.id}`)
          .set(CSRF)
          .send({ role: 'OWNER' })
      ).status,
    ).toBe(403);
  });

  it('global ADMIN can see and manage every project', async () => {
    const owner = await signUp(ctx.app);
    const project = await createProject(owner.agent);
    const admin = await signUp(ctx.app, { email: 'admin@example.com' });
    await makeAdmin(prisma, admin.user.id);

    expect((await admin.agent.get('/api/projects')).body.meta.total).toBe(1);
    const res = await admin.agent.get(`/api/projects/${project.id}`);
    expect(res.body.data.myRole).toBe('OWNER');
  });
});

describe('members', () => {
  it('owner adds, re-roles and removes members', async () => {
    const { owner, member, project } = await projectWithMember('VIEWER');

    const list = await owner.agent.get(`/api/projects/${project.id}/members`);
    expect(list.body.data.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'VIEWER']);

    const promote = await owner.agent
      .patch(`/api/projects/${project.id}/members/${member.user.id}`)
      .set(CSRF)
      .send({ role: 'EDITOR' });
    expect(promote.status).toBe(204);
    expect((await member.agent.get(`/api/projects/${project.id}`)).body.data.myRole).toBe('EDITOR');

    const remove = await owner.agent
      .delete(`/api/projects/${project.id}/members/${member.user.id}`)
      .set(CSRF);
    expect(remove.status).toBe(204);
    expect((await member.agent.get(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it('rejects unknown emails and duplicates', async () => {
    const { owner, member, project } = await projectWithMember('VIEWER');
    const unknown = await owner.agent
      .post(`/api/projects/${project.id}/members`)
      .set(CSRF)
      .send({ email: 'ghost@example.com', role: 'VIEWER' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');

    const duplicate = await owner.agent
      .post(`/api/projects/${project.id}/members`)
      .set(CSRF)
      .send({ email: member.user.email, role: 'EDITOR' });
    expect(duplicate.status).toBe(409);
  });

  it('never leaves a project without an owner', async () => {
    const { owner, project } = await projectWithMember('EDITOR');
    const demote = await owner.agent
      .patch(`/api/projects/${project.id}/members/${owner.user.id}`)
      .set(CSRF)
      .send({ role: 'VIEWER' });
    expect(demote.status).toBe(422);
    expect(demote.body.error.code).toBe('LAST_OWNER');

    const leave = await owner.agent
      .delete(`/api/projects/${project.id}/members/${owner.user.id}`)
      .set(CSRF);
    expect(leave.status).toBe(422);
  });

  it('any member can leave a project themselves', async () => {
    const { member, project } = await projectWithMember('VIEWER');
    const res = await member.agent
      .delete(`/api/projects/${project.id}/members/${member.user.id}`)
      .set(CSRF);
    expect(res.status).toBe(204);
  });
});

describe('activity log', () => {
  it('records project changes for members to read', async () => {
    const { agent } = await signUp(ctx.app);
    const project = await createProject(agent);
    await agent.put(`/api/projects/${project.id}`).set(CSRF).send({ name: 'Renamed' });

    const res = await agent.get(`/api/activity?projectId=${project.id}`);
    expect(res.body.data.map((a: { action: string }) => a.action)).toEqual([
      'project.updated',
      'project.created',
    ]);
    expect(res.body.data[0].user.name).toBe('Test User');
  });

  it('unauthenticated requests are rejected', async () => {
    expect((await request(ctx.app).get('/api/activity')).status).toBe(401);
  });
});
