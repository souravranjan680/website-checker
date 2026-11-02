import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import request from 'supertest';
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

/** A finished scan with issues, as the scanner would have saved it. */
async function seedFinishedScan(
  websiteId: string,
  fingerprints: string[],
  previousScanId?: string,
) {
  const scan = await prisma.scan.create({
    data: {
      websiteId,
      config: {},
      status: 'COMPLETED',
      finishedAt: new Date(),
      previousScanId,
      totalIssues: fingerprints.length,
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
  for (const fingerprint of fingerprints) {
    await prisma.issue.create({
      data: {
        scanId: scan.id,
        scanPageId: page.id,
        category: 'ACCESSIBILITY',
        severity: 'HIGH',
        ruleId: fingerprint,
        title: `Rule ${fingerprint}`,
        description: 'd',
        pageUrl: 'https://example.com/',
        viewport: '1920x1080',
        fingerprint,
        accessibility: {
          create: { axeRuleId: fingerprint, wcagCriteria: ['1.1.1'], wcagLevel: 'A' },
        },
      },
    });
  }
  return { scanId: scan.id, pageId: page.id };
}

describe('starting scans', () => {
  it('creates a QUEUED scan and puts it on the queue', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);

    const res = await agent.post('/api/scans').set(CSRF).send({ websiteId });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'QUEUED',
      mode: 'CRAWL',
      website: { id: websiteId },
      totalIssues: 0,
    });
    expect(ctx.queue.enqueued).toEqual([res.body.data.id]);
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.config).toMatchObject({ baseUrl: 'https://example.com/', maxPages: 20 });
  });

  it('allows only one active scan per website', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    await agent.post('/api/scans').set(CSRF).send({ websiteId });
    const second = await agent.post('/api/scans').set(CSRF).send({ websiteId });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SCAN_ALREADY_RUNNING');
  });

  it('returns 503 and marks the scan FAILED when the queue is down', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    ctx.queue.failNext = true;
    const res = await agent.post('/api/scans').set(CSRF).send({ websiteId });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('QUEUE_UNAVAILABLE');
    const row = await prisma.scan.findFirstOrThrow({ where: { websiteId } });
    expect(row.status).toBe('FAILED');
    // A new scan can be started afterwards (the failed one is not "active").
    expect((await agent.post('/api/scans').set(CSRF).send({ websiteId })).status).toBe(201);
  });

  it('blocks unauthorized scan attempts (signed out, outsider, viewer)', async () => {
    const owner = await signUp(ctx.app, { email: 'owner@example.com' });
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const outsider = await signUp(ctx.app, { email: 'outsider@example.com' });
    const { projectId, websiteId } = await siteFor(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });

    expect((await request(ctx.app).post('/api/scans').set(CSRF).send({ websiteId })).status).toBe(
      401,
    );
    expect((await outsider.agent.post('/api/scans').set(CSRF).send({ websiteId })).status).toBe(
      404,
    );
    const viewerTry = await viewer.agent.post('/api/scans').set(CSRF).send({ websiteId });
    expect(viewerTry.status).toBe(403);
    expect(ctx.queue.enqueued).toHaveLength(0);
    expect(await prisma.scan.count()).toBe(0);
  });

  it('validates the request', async () => {
    const { agent } = await signUp(ctx.app);
    const res = await agent
      .post('/api/scans')
      .set(CSRF)
      .send({ websiteId: '', mode: 'EVERYTHING' });
    expect(res.status).toBe(400);
  });
});

describe('cancelling and rescanning', () => {
  it('cancels a queued scan immediately and removes its job', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const scanId = (await agent.post('/api/scans').set(CSRF).send({ websiteId })).body.data.id;

    const res = await agent.post(`/api/scans/${scanId}/cancel`).set(CSRF);
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(ctx.queue.removed).toEqual([scanId]);
  });

  it('asks the worker to stop a running scan', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const scanId = (await agent.post('/api/scans').set(CSRF).send({ websiteId })).body.data.id;
    await prisma.scan.update({ where: { id: scanId }, data: { status: 'RUNNING' } });

    const res = await agent.post(`/api/scans/${scanId}/cancel`).set(CSRF);
    expect(res.body.data.status).toBe('CANCELLING');
    expect(ctx.events.cancelRequests).toEqual([scanId]);
  });

  it('refuses to cancel a finished scan, and viewers cannot cancel', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedFinishedScan(websiteId, []);
    expect((await agent.post(`/api/scans/${scanId}/cancel`).set(CSRF)).status).toBe(422);
  });

  it('rescans with the same website and mode', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedFinishedScan(websiteId, ['a']);
    const res = await agent.post(`/api/scans/${scanId}/rescan`).set(CSRF);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      trigger: 'RESCAN',
      status: 'QUEUED',
      website: { id: websiteId },
    });
  });
});

describe('results', () => {
  it('returns details with real counts, pages, and issues with details', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const { scanId } = await seedFinishedScan(websiteId, ['image-alt', 'label']);

    const details = await agent.get(`/api/scans/${scanId}`);
    expect(details.body.data).toMatchObject({
      status: 'COMPLETED',
      totalIssues: 2,
      severityCounts: { HIGH: 2, CRITICAL: 0 },
      categoryCounts: { ACCESSIBILITY: 2 },
      myRole: 'OWNER',
    });
    const pages = await agent.get(`/api/scans/${scanId}/pages`);
    expect(pages.body.data[0]).toMatchObject({ status: 'DONE', issueCount: 2 });
    const issues = await agent.get(`/api/scans/${scanId}/issues?category=ACCESSIBILITY`);
    expect(issues.body.meta.total).toBe(2);
    expect(issues.body.data[0].accessibility).toMatchObject({ wcagCriteria: ['1.1.1'] });
    const list = await agent.get(`/api/scans?websiteId=${websiteId}`);
    expect(list.body.data).toHaveLength(1);
  });

  it('compares a rescan with the previous scan by issue identity', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const first = await seedFinishedScan(websiteId, ['kept', 'fixed']);
    const second = await seedFinishedScan(websiteId, ['kept', 'brand-new'], first.scanId);

    const res = await agent.get(`/api/scans/${second.scanId}/compare`);
    expect(res.body.data.counts).toEqual({ new: 1, resolved: 1, recurring: 1 });
    expect(res.body.data.newIssues[0].fingerprint).toBe('brand-new');
    expect(res.body.data.resolvedIssues[0].fingerprint).toBe('fixed');
  });

  it('hides scans and screenshots from users outside the project', async () => {
    const owner = await signUp(ctx.app, { email: 'owner@example.com' });
    const outsider = await signUp(ctx.app, { email: 'outsider@example.com' });
    const { websiteId } = await siteFor(owner.agent);
    const { scanId, pageId } = await seedFinishedScan(websiteId, ['x']);

    const key = `scans/${scanId}/pages/${pageId}.jpg`;
    await mkdir(path.dirname(path.join(ctx.config.scans.storageDir, key)), { recursive: true });
    await writeFile(
      path.join(ctx.config.scans.storageDir, key),
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    );
    const shot = await prisma.screenshot.create({
      data: {
        scanId,
        scanPageId: pageId,
        kind: 'PAGE_FULL',
        width: 10,
        height: 10,
        storageKey: key,
        mimeType: 'image/jpeg',
        sizeBytes: 4,
      },
    });

    const ok = await owner.agent.get(`/api/screenshots/${shot.id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toContain('private');

    for (const path of [
      `/api/scans/${scanId}`,
      `/api/scans/${scanId}/issues`,
      `/api/scans/${scanId}/pages`,
      `/api/screenshots/${shot.id}`,
    ]) {
      expect((await outsider.agent.get(path)).status, path).toBe(404);
      expect((await request(ctx.app).get(path)).status, path).toBe(401);
    }
    expect((await outsider.agent.get('/api/scans')).body.meta.total).toBe(0);
  });

  it('lets editors mark a tracked issue as a false positive', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const tracked = await prisma.trackedIssue.create({
      data: {
        websiteId,
        fingerprint: 'f',
        category: 'UI_HEALTH',
        ruleId: 'ui/overlapping-elements',
        title: 't',
        severity: 'HIGH',
      },
    });
    const res = await agent
      .patch(`/api/tracked-issues/${tracked.id}`)
      .set(CSRF)
      .send({ status: 'FALSE_POSITIVE' });
    expect(res.status).toBe(200);
    expect(
      (await prisma.trackedIssue.findUniqueOrThrow({ where: { id: tracked.id } })).status,
    ).toBe('FALSE_POSITIVE');
  });
});

describe('live progress (Server-Sent Events)', () => {
  it('streams a snapshot, live updates, and closes when the scan finishes', async () => {
    const { agent } = await signUp(ctx.app);
    const { websiteId } = await siteFor(agent);
    const scanId = (await agent.post('/api/scans').set(CSRF).send({ websiteId })).body.data.id;

    // Real HTTP server so we can read the stream as it arrives.
    const server = ctx.app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({
        email: (await prisma.user.findFirstOrThrow()).email,
        password: 'correct horse battery staple',
      });
    const cookies = (login.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');

    const response = await fetch(`http://127.0.0.1:${port}/api/scans/${scanId}/events`, {
      headers: { cookie: cookies },
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    let text = '';
    const readUntil = async (marker: string) => {
      while (!text.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    };

    await readUntil('event: progress');
    expect(text).toContain('"status":"QUEUED"');
    ctx.events.emit({
      type: 'progress',
      scanId,
      status: 'RUNNING',
      progress: 42,
      step: 'Scanning page 2',
      currentUrl: 'https://example.com/about',
      pagesDiscovered: 5,
      pagesScanned: 2,
      pagesFailed: 0,
      issuesFound: 7,
      at: new Date().toISOString(),
    });
    await readUntil('"progress":42');
    expect(text).toContain('https://example.com/about');
    ctx.events.emit({
      type: 'finished',
      scanId,
      status: 'COMPLETED',
      at: new Date().toISOString(),
    });
    await readUntil('event: finished');
    const { done } = await reader.read();
    expect(done).toBe(true); // the server closed the stream
    server.close();
  });
});
