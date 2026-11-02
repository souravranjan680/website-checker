/**
 * Visual regression baselines: created, changed and deleted only by explicit,
 * permission-checked requests. Files are copied by the (fake) scanner worker.
 */
import { existsSync } from 'node:fs';
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

async function siteFor(agent: Agent, baseUrl = 'https://example.com') {
  const project = (await agent.post('/api/projects').set(CSRF).send({ name: 'Sites' })).body.data;
  const website = (
    await agent.post('/api/websites').set(CSRF).send({
      projectId: project.id,
      name: 'Home',
      baseUrl,
      authorizationConfirmed: true,
    })
  ).body.data;
  return { projectId: project.id as string, websiteId: website.id as string };
}

/** A finished scan with desktop + mobile visual snapshots (rows and real files). */
async function seedVisualScan(websiteId: string) {
  const scan = await prisma.scan.create({
    data: { websiteId, config: {}, status: 'COMPLETED', finishedAt: new Date() },
  });
  const page = await prisma.scanPage.create({
    data: {
      scanId: scan.id,
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      status: 'DONE',
    },
  });
  const shot = async (
    viewport: string,
    kind: 'VISUAL_CURRENT' | 'PAGE_FULL' = 'VISUAL_CURRENT',
  ) => {
    const key = `scans/${scan.id}/visual/${page.id}-${viewport}-${kind}.png`;
    const file = path.join(ctx.config.scans.storageDir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `fake png ${viewport}`);
    return prisma.screenshot.create({
      data: {
        scanId: scan.id,
        scanPageId: page.id,
        kind,
        viewport,
        width: 100,
        height: 100,
        storageKey: key,
        mimeType: 'image/png',
        sizeBytes: 10,
      },
    });
  };
  return {
    scanId: scan.id,
    desktop: await shot('1920x1080'),
    mobile: await shot('390x844'),
    fullPage: await shot('1920x1080', 'PAGE_FULL'),
  };
}

describe('visual baselines', () => {
  it('creates a baseline from a scan snapshot by copying the file (explicit action)', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const seed = await seedVisualScan(websiteId);

    const res = await agent
      .post(`/api/visual/websites/${websiteId}/baselines`)
      .set(CSRF)
      .send({ screenshotId: seed.desktop.id, failPercent: 1, ignoreSelectors: ['.clock'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      pageUrl: 'https://example.com/',
      viewport: '1920x1080',
      failPercent: 1,
      ignoreSelectors: ['.clock'],
      ignoreRects: [],
      latest: null,
      comparisons: 0,
    });
    // A copy: a new BASELINE image, not the scan's own snapshot.
    expect(res.body.data.screenshotId).not.toBe(seed.desktop.id);
    const copy = await prisma.screenshot.findUniqueOrThrow({
      where: { id: res.body.data.screenshotId },
    });
    expect(copy).toMatchObject({ kind: 'BASELINE', scanId: null, viewport: '1920x1080' });
    expect(copy.storageKey).toMatch(new RegExp(`^baselines/${websiteId}/`));
    expect(existsSync(path.join(ctx.config.scans.storageDir, copy.storageKey))).toBe(true);
    expect(ctx.pdf.copies).toEqual([{ fromKey: seed.desktop.storageKey, toKey: copy.storageKey }]);

    // Only one baseline per page + screen size; changing it needs "replace".
    const again = await agent
      .post(`/api/visual/websites/${websiteId}/baselines`)
      .set(CSRF)
      .send({ screenshotId: seed.desktop.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('BASELINE_EXISTS');

    const list = (await agent.get(`/api/visual/websites/${websiteId}/baselines`)).body.data;
    expect(list.baselines).toHaveLength(1);
    expect(list.myRole).toBe('OWNER');
    const activity = await prisma.activityLog.findMany({
      where: { action: 'visual.baseline_created' },
    });
    expect(activity).toHaveLength(1);
  });

  it('refuses snapshots that are not visual snapshots of this website', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const other = await siteFor(agent, 'https://example.org');
    const seed = await seedVisualScan(websiteId);
    const send = (site: string, screenshotId: string) =>
      agent.post(`/api/visual/websites/${site}/baselines`).set(CSRF).send({ screenshotId });
    expect((await send(other.websiteId, seed.desktop.id)).body.error.code).toBe('INVALID_SNAPSHOT');
    expect((await send(websiteId, seed.fullPage.id)).body.error.code).toBe('INVALID_SNAPSHOT');
    expect((await send(websiteId, 'missing-id')).status).toBe(422);
    expect(
      (
        await agent
          .post(`/api/visual/websites/${websiteId}/baselines`)
          .set(CSRF)
          .send({ screenshotId: seed.desktop.id, failPercent: 500 })
      ).status,
    ).toBe(400);
  });

  it('lets viewers look but not change; outsiders see nothing', async () => {
    const owner = await signUp(ctx.app);
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const outsider = await signUp(ctx.app);
    const { projectId, websiteId } = await siteFor(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });
    const seed = await seedVisualScan(websiteId);
    const baseline = (
      await owner.agent
        .post(`/api/visual/websites/${websiteId}/baselines`)
        .set(CSRF)
        .send({ screenshotId: seed.desktop.id })
    ).body.data;

    expect((await viewer.agent.get(`/api/visual/websites/${websiteId}/baselines`)).status).toBe(
      200,
    );
    expect((await viewer.agent.get(`/api/visual/scans/${seed.scanId}`)).status).toBe(200);
    expect(
      (
        await viewer.agent
          .post(`/api/visual/websites/${websiteId}/baselines`)
          .set(CSRF)
          .send({ screenshotId: seed.mobile.id })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer.agent
          .patch(`/api/visual/baselines/${baseline.id}`)
          .set(CSRF)
          .send({ failPercent: 2 })
      ).status,
    ).toBe(403);
    expect(
      (await viewer.agent.delete(`/api/visual/baselines/${baseline.id}`).set(CSRF)).status,
    ).toBe(403);
    expect((await outsider.agent.get(`/api/visual/websites/${websiteId}/baselines`)).status).toBe(
      404,
    );
    expect((await outsider.agent.get(`/api/visual/scans/${seed.scanId}`)).status).toBe(404);
  });

  it('updates settings, replaces the image only on request, and deletes', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const first = await seedVisualScan(websiteId);
    const baseline = (
      await agent
        .post(`/api/visual/websites/${websiteId}/baselines`)
        .set(CSRF)
        .send({ screenshotId: first.desktop.id })
    ).body.data;

    const updated = await agent
      .patch(`/api/visual/baselines/${baseline.id}`)
      .set(CSRF)
      .send({ failPercent: 2.5, ignoreRects: [{ x: 0, y: 0, width: 100, height: 20 }] });
    expect(updated.body.data).toMatchObject({
      failPercent: 2.5,
      ignoreSelectors: [],
      ignoreRects: [{ x: 0, y: 0, width: 100, height: 20 }],
      screenshotId: baseline.screenshotId, // settings never touch the image
    });
    expect(
      (await agent.patch(`/api/visual/baselines/${baseline.id}`).set(CSRF).send({})).status,
    ).toBe(400);

    // A later scan's snapshot becomes the new baseline only through "replace".
    const second = await seedVisualScan(websiteId);
    const wrongSize = await agent
      .post(`/api/visual/baselines/${baseline.id}/replace`)
      .set(CSRF)
      .send({ screenshotId: second.mobile.id });
    expect(wrongSize.status).toBe(422);
    const replaced = await agent
      .post(`/api/visual/baselines/${baseline.id}/replace`)
      .set(CSRF)
      .send({ screenshotId: second.desktop.id });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.screenshotId).not.toBe(baseline.screenshotId);
    expect(await prisma.screenshot.findUnique({ where: { id: baseline.screenshotId } })).toBeNull();

    expect((await agent.delete(`/api/visual/baselines/${baseline.id}`).set(CSRF)).status).toBe(204);
    expect(await prisma.visualBaseline.count()).toBe(0);
    expect(
      (await prisma.activityLog.findMany({ where: { entityType: 'VisualBaseline' } }))
        .map((a) => a.action)
        .sort(),
    ).toEqual([
      'visual.baseline_created',
      'visual.baseline_deleted',
      'visual.baseline_replaced',
      'visual.baseline_updated',
    ]);
  });

  it("returns a scan's snapshots with their baseline and comparison", async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const first = await seedVisualScan(websiteId);
    const baseline = (
      await agent
        .post(`/api/visual/websites/${websiteId}/baselines`)
        .set(CSRF)
        .send({ screenshotId: first.desktop.id })
    ).body.data;
    const second = await seedVisualScan(websiteId);
    await prisma.visualComparison.create({
      data: {
        baselineId: baseline.id,
        scanId: second.scanId,
        currentScreenshotId: second.desktop.id,
        diffPixels: 900,
        totalPixels: 10_000,
        diffPercent: 9,
        passed: false,
        status: 'CHANGED',
        details: {
          regions: [{ x: 0, y: 0, width: 30, height: 30 }],
          size: {
            baseline: { width: 100, height: 100 },
            current: { width: 100, height: 100 },
            changed: false,
          },
          failPercent: 0.5,
        },
      },
    });

    const r = (await agent.get(`/api/visual/scans/${second.scanId}`)).body.data;
    const byViewport = Object.fromEntries(
      r.snapshots.map((s: { viewport: string }) => [s.viewport, s]),
    );
    expect(byViewport['1920x1080']).toMatchObject({
      baseline: { id: baseline.id },
      comparison: {
        status: 'CHANGED',
        diffPercent: 9,
        passed: false,
        regions: [{ x: 0, y: 0, width: 30, height: 30 }],
      },
    });
    expect(byViewport['390x844']).toMatchObject({ baseline: null, comparison: null });

    const history = (await agent.get(`/api/visual/baselines/${baseline.id}/comparisons`)).body.data;
    expect(history).toHaveLength(1);
    const list = (await agent.get(`/api/visual/websites/${websiteId}/baselines`)).body.data;
    expect(list.baselines[0]).toMatchObject({ comparisons: 1, latest: { status: 'CHANGED' } });
  });
});

describe('baseline images and the overview list', () => {
  it('serves baseline images only to project members, and lists baselines per user', async () => {
    const owner = await signUp(ctx.app);
    const outsider = await signUp(ctx.app);
    const { websiteId } = await siteFor(owner.agent);
    const seed = await seedVisualScan(websiteId);
    const baseline = (
      await owner.agent
        .post(`/api/visual/websites/${websiteId}/baselines`)
        .set(CSRF)
        .send({ screenshotId: seed.desktop.id })
    ).body.data;

    const image = await owner.agent.get(`/api/screenshots/${baseline.screenshotId}`).buffer(true);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect((await outsider.agent.get(`/api/screenshots/${baseline.screenshotId}`)).status).toBe(
      404,
    );

    const mine = (await owner.agent.get('/api/visual/baselines')).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0].website).toMatchObject({ id: websiteId, name: 'Home' });
    expect((await outsider.agent.get('/api/visual/baselines')).body.data).toEqual([]);
  });
});
