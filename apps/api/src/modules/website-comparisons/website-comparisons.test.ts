/**
 * Phase 9, Milestone 4 (Checkpoint 1): website comparisons. The API (validation, CRUD,
 * derived state, activity, access rules), the protection of websites they use, and the
 * database constraints themselves (checked directly against PostgreSQL).
 */
import type { PrismaClient } from '@whc/db';
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
import { createWebsiteComparisonsService } from './website-comparisons.service';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

async function project(agent: Agent, name = 'Sites') {
  return (await agent.post('/api/projects').set(CSRF).send({ name })).body.data.id as string;
}
async function website(agent: Agent, projectId: string, baseUrl: string) {
  const res = await agent
    .post('/api/websites')
    .set(CSRF)
    .send({ projectId, name: baseUrl, baseUrl, authorizationConfirmed: true });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}
/** An owner with a project and two websites. */
async function setup() {
  const owner = await signUp(ctx.app);
  const projectId = await project(owner.agent);
  const live = await website(owner.agent, projectId, 'https://example.com');
  const redesign = await website(owner.agent, projectId, 'https://www.example.com');
  return { owner, projectId, live, redesign };
}
const create = (agent: Agent, body: object) =>
  agent.post('/api/website-comparisons').set(CSRF).send(body);
async function addMember(owner: Agent, projectId: string, email: string, role: string) {
  const res = await owner
    .post(`/api/projects/${projectId}/members`)
    .set(CSRF)
    .send({ email, role });
  expect(res.status).toBe(201);
}

describe('create, read, update, archive, restore, delete', () => {
  it('creates a DRAFT comparison with default settings and logs it', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const res = await create(owner.agent, {
      projectId,
      name: 'Redesign vs live',
      referenceWebsiteId: live,
      targetWebsiteId: redesign,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      projectId,
      name: 'Redesign vs live',
      state: 'DRAFT',
      reference: { id: live, baseUrl: 'https://example.com/' },
      target: { id: redesign, baseUrl: 'https://www.example.com/' },
      settings: {
        maxPages: 10,
        maxDepth: 1,
        includePatterns: [],
        excludePatterns: [],
        viewports: ['1920x1080'],
      },
      latestRun: null,
      runCount: 0,
      archivedAt: null,
      myRole: 'OWNER',
      createdBy: { id: owner.user.id },
    });
    const log = await prisma.activityLog.findFirst({
      where: { action: 'website-comparison.created' },
    });
    expect(log).toMatchObject({ entityId: res.body.data.id, projectId });
  });

  it('lists with search and pagination; archived ones only when asked', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const ids: string[] = [];
    for (const name of ['Alpha check', 'Beta check', 'Gamma check']) {
      ids.push(
        (
          await create(owner.agent, {
            projectId,
            name,
            referenceWebsiteId: live,
            targetWebsiteId: redesign,
          })
        ).body.data.id,
      );
    }
    await owner.agent.put(`/api/website-comparisons/${ids[2]}`).set(CSRF).send({ archived: true });

    const list = async (query: string) =>
      (await owner.agent.get(`/api/website-comparisons?${query}`)).body;
    const names = (body: { data: { name: string }[] }) => body.data.map((c) => c.name);
    expect(names(await list(''))).toEqual(['Beta check', 'Alpha check']);
    expect(names(await list('archived=true'))).toEqual(['Gamma check']);
    expect(names(await list('archived=all'))).toHaveLength(3);
    expect(names(await list('q=alpha'))).toEqual(['Alpha check']);
    // Also finds comparisons by the name of either website (here the site names are URLs).
    expect(names(await list('q=www.example'))).toEqual(['Beta check', 'Alpha check']);
    expect(names(await list('q=nothing-like-this'))).toEqual([]);
    const page = await list('archived=all&pageSize=2&page=2');
    expect(page.data).toHaveLength(1);
    expect(page.meta).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect((await owner.agent.get('/api/website-comparisons?unknown=1')).status).toBe(400);
  });

  it('updates settings, archives and restores (state derived), and deletes', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Compare',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id;
    const put = (body: object) =>
      owner.agent.put(`/api/website-comparisons/${id}`).set(CSRF).send(body);

    const updated = await put({ maxPages: 25, viewports: ['1920x1080', '390x844'] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.settings).toMatchObject({
      maxPages: 25,
      viewports: ['1920x1080', '390x844'],
    });
    const archived = await put({ archived: true });
    expect(archived.body.data).toMatchObject({ state: 'ARCHIVED' });
    expect(archived.body.data.archivedAt).not.toBeNull();
    const restored = await put({ archived: false });
    expect(restored.body.data).toMatchObject({ state: 'DRAFT', archivedAt: null });

    // A run (inserted directly: runs are created from Checkpoint 3) makes it IN_USE.
    await prisma.websiteComparisonRun.create({
      data: { comparisonId: id, status: 'COMPLETED', activeLock: null, config: {} },
    });
    const inUse = (await owner.agent.get(`/api/website-comparisons/${id}`)).body.data;
    expect(inUse).toMatchObject({
      state: 'IN_USE',
      runCount: 1,
      latestRun: { status: 'COMPLETED' },
    });

    expect((await put({ referenceWebsiteId: redesign })).status).toBe(400); // fixed websites
    expect((await owner.agent.delete(`/api/website-comparisons/${id}`).set(CSRF)).status).toBe(204);
    expect((await owner.agent.get(`/api/website-comparisons/${id}`)).status).toBe(404);
    expect(await prisma.websiteComparisonRun.count()).toBe(0); // runs go with it
    const actions = (
      await prisma.activityLog.findMany({
        where: { entityId: id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'website-comparison.created',
      'website-comparison.updated',
      'website-comparison.archived',
      'website-comparison.restored',
      'website-comparison.deleted',
    ]);
  });

  it('refuses settings changes and deletion while a run is active; archiving and restoring stay allowed', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Compare',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id;
    await prisma.websiteComparisonRun.create({
      data: { comparisonId: id, status: 'RUNNING', config: {} },
    });
    const put = await owner.agent
      .put(`/api/website-comparisons/${id}`)
      .set(CSRF)
      .send({ maxPages: 5 });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('WEBSITE_COMPARISON_RUN_ACTIVE');
    const del = await owner.agent.delete(`/api/website-comparisons/${id}`).set(CSRF);
    expect(del.status).toBe(409);
    expect(
      (await owner.agent.put(`/api/website-comparisons/${id}`).set(CSRF).send({ name: 'Renamed' }))
        .status,
    ).toBe(409);
    // Archiving and restoring change no settings, so they work during a run.
    const archived = await owner.agent
      .put(`/api/website-comparisons/${id}`)
      .set(CSRF)
      .send({ archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body.data).toMatchObject({ state: 'ARCHIVED', name: 'Compare' });
    expect(archived.body.data.archivedAt).not.toBeNull();
    const restored = await owner.agent
      .put(`/api/website-comparisons/${id}`)
      .set(CSRF)
      .send({ archived: false });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ state: 'IN_USE', archivedAt: null }); // it has a run
    expect(restored.body.data.settings.maxPages).toBe(10); // the refused change was not saved
  });
});

describe('validation', () => {
  it.each([
    [{ maxPages: 51 }, 'maxPages'],
    [{ maxPages: 0 }, 'maxPages'],
    [{ maxDepth: 4 }, 'maxDepth'],
    [{ includePatterns: Array.from({ length: 21 }, (_, i) => `/p${i}`) }, 'includePatterns'],
    [{ excludePatterns: Array.from({ length: 21 }, (_, i) => `/p${i}`) }, 'excludePatterns'],
    [{ viewports: ['1280x720'] }, 'viewports.0'],
    [{ status: 'RUNNING' }, ''],
  ])('rejects %j with 400', async (override, path) => {
    const { owner, projectId, live, redesign } = await setup();
    const res = await create(owner.agent, {
      projectId,
      name: 'Compare',
      referenceWebsiteId: live,
      targetWebsiteId: redesign,
      ...override,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('the same website twice is refused', async () => {
    const { owner, projectId, live } = await setup();
    const res = await create(owner.agent, {
      projectId,
      name: 'Self',
      referenceWebsiteId: live,
      targetWebsiteId: live,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'targetWebsiteId', message: 'Choose two different websites.' },
    ]);
  });

  it('a website of another project (even one the user owns) is not found', async () => {
    const { owner, projectId, live } = await setup();
    const other = await project(owner.agent, 'Other');
    const foreign = await website(owner.agent, other, 'https://example.org');
    const res = await create(owner.agent, {
      projectId,
      name: 'Cross project',
      referenceWebsiteId: live,
      targetWebsiteId: foreign,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.details).toEqual([
      { path: 'targetWebsiteId', message: 'Choose a website of this project.' },
    ]);
    expect(await prisma.websiteComparison.count()).toBe(0);
  });
});

describe('access rules', () => {
  it('viewers read; only editors write; outsiders get 404; signed out 401; CSRF required', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const outsider = await signUp(ctx.app);
    await addMember(owner.agent, projectId, 'viewer@example.com', 'VIEWER');
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Compare',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id;
    const body = {
      projectId,
      name: 'Another',
      referenceWebsiteId: live,
      targetWebsiteId: redesign,
    };

    // Viewer: read yes, write no.
    expect((await viewer.agent.get(`/api/website-comparisons/${id}`)).body.data.myRole).toBe(
      'VIEWER',
    );
    expect((await viewer.agent.get('/api/website-comparisons')).body.data).toHaveLength(1);
    expect((await create(viewer.agent, body)).status).toBe(403);
    expect(
      (await viewer.agent.put(`/api/website-comparisons/${id}`).set(CSRF).send({ name: 'No' }))
        .status,
    ).toBe(403);
    expect((await viewer.agent.delete(`/api/website-comparisons/${id}`).set(CSRF)).status).toBe(
      403,
    );

    // Outsider: nothing exists.
    expect((await outsider.agent.get(`/api/website-comparisons/${id}`)).status).toBe(404);
    expect((await outsider.agent.get('/api/website-comparisons')).body.data).toEqual([]);
    expect((await create(outsider.agent, body)).status).toBe(404);
    expect(
      (await outsider.agent.put(`/api/website-comparisons/${id}`).set(CSRF).send({ name: 'No' }))
        .status,
    ).toBe(404);
    expect((await outsider.agent.delete(`/api/website-comparisons/${id}`).set(CSRF)).status).toBe(
      404,
    );

    // Signed out, and the CSRF header.
    expect((await request(ctx.app).get('/api/website-comparisons')).status).toBe(401);
    expect((await request(ctx.app).get(`/api/website-comparisons/${id}`)).status).toBe(401);
    expect((await owner.agent.post('/api/website-comparisons').send(body)).status).toBe(403);
    expect((await owner.agent.delete(`/api/website-comparisons/${id}`)).status).toBe(403);
    expect(await prisma.websiteComparison.count()).toBe(1);
  });

  it('an editor can create; a global admin acts as owner in every project', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const editor = await signUp(ctx.app, { email: 'editor@example.com' });
    await addMember(owner.agent, projectId, 'editor@example.com', 'EDITOR');
    const body = {
      projectId,
      name: 'By editor',
      referenceWebsiteId: live,
      targetWebsiteId: redesign,
    };
    expect((await create(editor.agent, body)).status).toBe(201);

    const admin = await signUp(ctx.app);
    await makeAdmin(prisma, admin.user.id);
    const list = (await admin.agent.get('/api/website-comparisons')).body.data;
    expect(list).toHaveLength(1);
    const res = await create(admin.agent, { ...body, name: 'By admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.myRole).toBe('OWNER');
  });
});

describe('websites used by comparisons (Mode 1 change, approved)', () => {
  it('cannot be deleted or moved to another project (409); the comparison is kept', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Keep me',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id;
    const del = await owner.agent.delete(`/api/websites/${redesign}`).set(CSRF);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatchObject({
      code: 'WEBSITE_IN_COMPARISON',
      details: { count: 1, comparisons: [{ id, name: 'Keep me' }] },
    });
    const other = await project(owner.agent, 'Other');
    const move = await owner.agent
      .put(`/api/websites/${live}`)
      .set(CSRF)
      .send({ projectId: other });
    expect(move.status).toBe(409);
    expect(move.body.error.code).toBe('WEBSITE_IN_COMPARISON');
    expect(await prisma.website.count({ where: { id: { in: [live, redesign] }, projectId } })).toBe(
      2,
    );
    expect(await prisma.websiteComparison.count()).toBe(1);
    // Other edits of a used website are unchanged.
    expect(
      (await owner.agent.put(`/api/websites/${live}`).set(CSRF).send({ maxPages: 7 })).status,
    ).toBe(200);
  });

  it('websites no comparison uses: delete and move exactly as before', async () => {
    const { owner, live } = await setup();
    const other = await project(owner.agent, 'Other');
    expect(
      (await owner.agent.put(`/api/websites/${live}`).set(CSRF).send({ projectId: other })).status,
    ).toBe(200);
    expect((await owner.agent.delete(`/api/websites/${live}`).set(CSRF)).status).toBe(204);
  });

  it('after the comparison is deleted, the website can be deleted', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Temporary',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id;
    await owner.agent.delete(`/api/website-comparisons/${id}`).set(CSRF);
    expect((await owner.agent.delete(`/api/websites/${live}`).set(CSRF)).status).toBe(204);
  });

  it('deleting the whole project still works and removes its comparisons and runs', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Goes with the project',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id;
    await prisma.websiteComparisonRun.create({
      data: { comparisonId: id, status: 'COMPLETED', activeLock: null, config: {} },
    });
    const res = await owner.agent
      .delete(`/api/projects/${projectId}`)
      .set(CSRF)
      .send({ confirmName: 'Sites' });
    expect(res.status).toBe(204);
    expect(await prisma.websiteComparison.count()).toBe(0);
    expect(await prisma.websiteComparisonRun.count()).toBe(0);
    expect(await prisma.website.count()).toBe(0);
  });
});

describe('database constraints (directly against PostgreSQL)', () => {
  async function comparisonRow() {
    const { owner, projectId, live, redesign } = await setup();
    const id = (
      await create(owner.agent, {
        projectId,
        name: 'Constraints',
        referenceWebsiteId: live,
        targetWebsiteId: redesign,
      })
    ).body.data.id as string;
    return { owner, projectId, live, redesign, id };
  }
  const code = (error: unknown) => (error as { code?: string }).code;

  it('a comparison whose website is in another project is rejected by the database', async () => {
    const { owner, projectId, live } = await comparisonRow();
    const other = await project(owner.agent, 'Other');
    const foreign = await website(owner.agent, other, 'https://example.org');
    const insert = prisma.websiteComparison.create({
      data: { projectId, name: 'Bypass', referenceWebsiteId: live, targetWebsiteId: foreign },
    });
    await expect(insert).rejects.toSatisfy((e) => code(e) === 'P2003');
    // Raw SQL, without Prisma in between: the composite foreign key itself refuses it.
    await expect(
      prisma.$executeRaw`INSERT INTO "WebsiteComparison" ("id","projectId","name","referenceWebsiteId","targetWebsiteId","updatedAt")
        VALUES ('raw1', ${projectId}, 'Raw', ${foreign}, ${live}, now())`,
    ).rejects.toThrow(/WebsiteComparison_referenceWebsiteId_projectId_fkey/);
  });

  it('deleting or moving a referenced website is refused by the database (NO ACTION)', async () => {
    const { owner, live, redesign } = await comparisonRow();
    await expect(prisma.website.delete({ where: { id: redesign } })).rejects.toSatisfy(
      (e) => code(e) === 'P2003',
    );
    const other = await project(owner.agent, 'Other');
    await expect(
      prisma.website.update({ where: { id: live }, data: { projectId: other } }),
    ).rejects.toSatisfy((e) => code(e) === 'P2003');
    expect(await prisma.website.count({ where: { id: { in: [live, redesign] } } })).toBe(2);
  });

  it('an unreferenced website is deleted normally', async () => {
    const { owner, projectId } = await comparisonRow();
    const spare = await website(owner.agent, projectId, 'https://example.org');
    await prisma.website.delete({ where: { id: spare } });
    expect(await prisma.website.count({ where: { id: spare } })).toBe(0);
  });

  it('deleting the project in one statement succeeds (NO ACTION is checked at the end)', async () => {
    const { projectId } = await comparisonRow();
    await prisma.$executeRaw`DELETE FROM "Project" WHERE id = ${projectId}`;
    expect(await prisma.websiteComparison.count()).toBe(0);
  });

  it('finished runs coexist; a second active run is rejected', async () => {
    const { id } = await comparisonRow();
    const run = (status: 'COMPLETED' | 'FAILED' | 'QUEUED' | 'RUNNING', activeLock: true | null) =>
      prisma.websiteComparisonRun.create({
        data: { comparisonId: id, status, activeLock, config: {} },
      });
    await run('COMPLETED', null);
    await run('FAILED', null);
    await run('COMPLETED', null);
    await run('QUEUED', true);
    await expect(run('RUNNING', true)).rejects.toSatisfy((e) => code(e) === 'P2002');
    // The default is "active": a run inserted without activeLock is active too.
    await expect(
      prisma.websiteComparisonRun.create({ data: { comparisonId: id, config: {} } }),
    ).rejects.toSatisfy((e) => code(e) === 'P2002');
    expect(await prisma.websiteComparisonRun.count({ where: { comparisonId: id } })).toBe(4);
    // Once the active run finishes (lock cleared), a new one may start.
    await prisma.websiteComparisonRun.updateMany({
      where: { comparisonId: id, activeLock: true },
      data: { status: 'COMPLETED', activeLock: null },
    });
    await run('QUEUED', true);
  });
});

describe('creation race: a website changes between the check and the insert', () => {
  /**
   * A Prisma client whose transactions run the real check, then let `meanwhile` change the
   * database on another connection before the insert: a deterministic race.
   */
  function racing(meanwhile: () => Promise<unknown>): PrismaClient {
    return new Proxy(prisma, {
      get(target, key, receiver) {
        if (key !== '$transaction') return Reflect.get(target, key, receiver);
        return (fn: (tx: PrismaClient) => Promise<unknown>) =>
          target.$transaction(async (tx) => {
            const website = new Proxy(tx.website, {
              get(w, k, r) {
                if (k !== 'findMany') return Reflect.get(w, k, r);
                return async (args: Parameters<typeof tx.website.findMany>[0]) => {
                  const found = await tx.website.findMany(args);
                  await meanwhile();
                  return found;
                };
              },
            });
            return fn(
              new Proxy(tx, {
                get: (t, k, r) => (k === 'website' ? website : Reflect.get(t, k, r)),
              }) as never,
            );
          });
      },
    });
  }
  const input = (projectId: string, live: string, redesign: string) => ({
    projectId,
    name: 'Raced',
    referenceWebsiteId: live,
    targetWebsiteId: redesign,
  });
  const caught = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) => e,
    );
  async function nothingSaved() {
    expect(await prisma.websiteComparison.count()).toBe(0);
    expect(
      await prisma.activityLog.count({ where: { action: 'website-comparison.created' } }),
    ).toBe(0);
  }

  it('a website moved to another project meanwhile: 404 on that field, nothing saved', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const other = await project(owner.agent, 'Other');
    const service = createWebsiteComparisonsService({
      prisma: racing(() =>
        prisma.website.update({ where: { id: redesign }, data: { projectId: other } }),
      ),
    });
    const error = await caught(
      service.create({ ...owner.user, role: 'USER' }, input(projectId, live, redesign)),
    );
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      details: [{ path: 'targetWebsiteId', message: 'Choose a website of this project.' }],
    });
    await nothingSaved();
    expect((await prisma.website.findUniqueOrThrow({ where: { id: redesign } })).projectId).toBe(
      other,
    );
  });

  it('a website deleted meanwhile: 404 on that field, nothing saved', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const service = createWebsiteComparisonsService({
      prisma: racing(() => prisma.website.delete({ where: { id: live } })),
    });
    const error = await caught(
      service.create({ ...owner.user, role: 'USER' }, input(projectId, live, redesign)),
    );
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      details: [{ path: 'referenceWebsiteId', message: 'Choose a website of this project.' }],
    });
    await nothingSaved();
  });

  it('another foreign key (the creator deleted meanwhile) is not turned into a 404', async () => {
    const { owner, projectId, live, redesign } = await setup();
    const service = createWebsiteComparisonsService({
      prisma: racing(() => prisma.user.delete({ where: { id: owner.user.id } })),
    });
    const error = await caught(
      service.create({ ...owner.user, role: 'USER' }, input(projectId, live, redesign)),
    );
    expect(error).toMatchObject({ code: 'P2003' }); // the original database error, untranslated
    expect((error as { status?: number }).status).toBeUndefined();
    await nothingSaved();
  });
});
