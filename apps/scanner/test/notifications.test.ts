/** Which notifications a finished scan creates, following the user's preferences. */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@whc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyScanFinished, type EmailJobQueue } from '../src/notifications';
import { createTestPrisma, silentLogger } from './helpers';

let prisma: PrismaClient;
beforeAll(() => {
  prisma = createTestPrisma();
});
afterAll(() => prisma.$disconnect());

async function setup(
  prefs: Record<string, boolean>,
  scan: { status: 'COMPLETED' | 'PARTIAL' | 'FAILED'; withPrevious?: boolean },
) {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: 'Asha',
      passwordHash: 'x',
      notificationPreferences: prefs,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: 'P',
      createdById: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  const website = await prisma.website.create({
    data: {
      projectId: project.id,
      name: 'Shop',
      baseUrl: `https://${randomUUID()}.example/`,
      hostname: 'shop.example',
      authorizationConfirmedAt: new Date(),
    },
  });
  const previous = scan.withPrevious
    ? await prisma.scan.create({ data: { websiteId: website.id, config: {}, status: 'COMPLETED' } })
    : null;
  const row = await prisma.scan.create({
    data: {
      websiteId: website.id,
      config: {},
      status: scan.status,
      triggeredById: user.id,
      pagesScanned: 3,
      totalIssues: 12,
      previousScanId: previous?.id,
    },
  });
  return { userId: user.id, scanId: row.id };
}

function fakeQueue(fail = false) {
  const jobs: { notificationId: string }[] = [];
  const queue: EmailJobQueue & { jobs: typeof jobs } = {
    jobs,
    async add(_name, data) {
      if (fail) throw new Error('redis down');
      jobs.push(data);
    },
  };
  return queue;
}
const deps = (emailQueue: EmailJobQueue | null) => ({ prisma, emailQueue, logger: silentLogger });

describe('notifyScanFinished', () => {
  it('notifies the user who started a completed scan (in-app only by default)', async () => {
    const { userId, scanId } = await setup({}, { status: 'COMPLETED' });
    const queue = fakeQueue();
    expect(
      await notifyScanFinished(deps(queue), {
        scanId,
        status: 'COMPLETED',
        regressions: { newIssues: 12, reopenedIssues: 0 },
      }),
    ).toBe(1);
    const [n] = await prisma.notification.findMany({ where: { userId } });
    expect(n).toMatchObject({
      type: 'SCAN_COMPLETED',
      title: 'Scan of Shop finished',
      message: '3 pages scanned, 12 issues found.',
      link: `/scans/${scanId}`,
      emailStatus: 'NOT_REQUESTED',
    });
    // First scan: everything is "new", but that is not a regression.
    expect(queue.jobs).toHaveLength(0);
  });

  it('reports regressions only when there is a previous scan, and queues e-mail when chosen', async () => {
    const { userId, scanId } = await setup(
      { email: true },
      { status: 'COMPLETED', withPrevious: true },
    );
    const queue = fakeQueue();
    await notifyScanFinished(deps(queue), {
      scanId,
      status: 'COMPLETED',
      regressions: { newIssues: 2, reopenedIssues: 1 },
    });
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { type: 'asc' },
    });
    expect(rows.map((r) => [r.type, r.emailStatus])).toEqual([
      ['SCAN_COMPLETED', 'PENDING'],
      ['REGRESSION_DETECTED', 'PENDING'],
    ]);
    expect(rows[1]!.message).toBe(
      '2 new problems, 1 fixed problem came back since the previous scan.',
    );
    expect(queue.jobs.map((j) => j.notificationId).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('notifies about failed and partial scans, and respects switched-off preferences', async () => {
    const failed = await setup({}, { status: 'FAILED' });
    await notifyScanFinished(deps(null), {
      scanId: failed.scanId,
      status: 'FAILED',
      regressions: null,
    });
    expect(
      (await prisma.notification.findFirstOrThrow({ where: { userId: failed.userId } })).title,
    ).toBe('Scan of Shop failed');

    const quiet = await setup(
      { scanCompleted: false, scanFailed: false, regressionDetected: false },
      { status: 'PARTIAL', withPrevious: true },
    );
    expect(
      await notifyScanFinished(deps(null), {
        scanId: quiet.scanId,
        status: 'PARTIAL',
        regressions: { newIssues: 5, reopenedIssues: 0 },
      }),
    ).toBe(0);
  });

  it('marks the e-mail as failed (not sent) when it cannot even be queued', async () => {
    const { userId, scanId } = await setup({ email: true }, { status: 'COMPLETED' });
    await notifyScanFinished(deps(fakeQueue(true)), {
      scanId,
      status: 'COMPLETED',
      regressions: null,
    });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId } });
    expect(n.emailStatus).toBe('FAILED');
    expect(n.emailError).toBe('Could not queue the e-mail.');
  });
});
