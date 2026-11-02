/**
 * Queue tests: real Redis + BullMQ. Each test uses its own key prefix, so tests
 * never pick up real jobs (and vice versa).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@whc/db';
import { SCAN_QUEUE_NAME } from '@whc/shared';
import { Queue, UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDomChecksBundle } from '../src/checks/dom';
import { runScan } from '../src/pipeline/run-scan';
import { createLocalStorage } from '../src/storage';
import { createScanWorker } from '../src/worker';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  createPublisher,
  createScanFor,
  createTestPrisma,
  resetDatabase,
  silentLogger,
  startTestProxy,
  testScannerConfig,
} from './helpers';

let prisma: PrismaClient;
let publisher: Redis;
let fixtures: FixtureServer;
let proxy: Awaited<ReturnType<typeof startTestProxy>>;

beforeAll(async () => {
  prisma = createTestPrisma();
  publisher = createPublisher();
  fixtures = await startFixtureServer();
  proxy = await startTestProxy();
  await resetDatabase(prisma);
});
afterAll(async () => {
  await fixtures.close();
  await proxy.close();
  await publisher.quit();
  await prisma.$disconnect();
});

function setup(runScanImpl?: typeof runScan) {
  const prefix = `whc-test-${randomUUID()}`;
  const config = testScannerConfig(proxy.url);
  const scanner = createScanWorker({
    config,
    prisma,
    storage: createLocalStorage(config.storageDir),
    logger: silentLogger,
    domBundle: loadDomChecksBundle(),
    queuePrefix: prefix,
    runScanImpl,
  });
  const queue = new Queue(SCAN_QUEUE_NAME, { connection: { url: config.redisUrl }, prefix });
  return {
    scanner,
    queue,
    enqueue: (scanId: string, attempts = 2) =>
      queue.add(
        'scan',
        { scanId },
        { jobId: scanId, attempts, backoff: { type: 'fixed', delay: 200 } },
      ),
    async close() {
      await scanner.close();
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    },
  };
}

async function waitForStatus(scanId: string, statuses: string[], timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    if (statuses.includes(row.status)) return row;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`scan ${scanId} did not reach ${statuses.join('/')}`);
}

describe('scan queue (BullMQ + Redis)', () => {
  it('runs a queued scan end to end: QUEUED → RUNNING → COMPLETED', async () => {
    const q = setup();
    try {
      const { scanId } = await createScanFor(prisma, fixtures.url('/clean/'), {
        maxPages: 1,
        responsivePageLimit: 0,
      });
      await q.enqueue(scanId);
      const row = await waitForStatus(scanId, ['COMPLETED', 'PARTIAL', 'FAILED']);
      expect(row.status).toBe('COMPLETED');
      expect(row.startedAt).not.toBeNull();
      expect(await prisma.scanPage.count({ where: { scanId } })).toBe(1);
    } finally {
      await q.close();
    }
  });

  it('retries a temporary failure and does not duplicate results', async () => {
    let calls = 0;
    const flaky: typeof runScan = async (scanId, deps, options) => {
      calls += 1;
      if (calls === 1) {
        // Simulate a crash after part of the work was saved.
        await deps.prisma.scanPage.create({
          data: { scanId, url: 'x', normalizedUrl: 'partial', status: 'DONE' },
        });
        throw new Error('browser crashed');
      }
      return runScan(scanId, deps, options);
    };
    const q = setup(flaky);
    try {
      const { scanId } = await createScanFor(prisma, fixtures.url('/clean/'), {
        maxPages: 1,
        responsivePageLimit: 0,
      });
      await q.enqueue(scanId, 2);
      const row = await waitForStatus(scanId, ['COMPLETED', 'PARTIAL', 'FAILED']);
      expect(calls).toBe(2);
      expect(row.status).toBe('COMPLETED');
      // The partial row from attempt 1 was cleared before attempt 2.
      expect(await prisma.scanPage.count({ where: { scanId, normalizedUrl: 'partial' } })).toBe(0);
    } finally {
      await q.close();
    }
  });

  it('does not retry a permanent failure and shows a safe message', async () => {
    let calls = 0;
    const broken: typeof runScan = async () => {
      calls += 1;
      throw new UnrecoverableError('secret internal detail: db password wrong');
    };
    const q = setup(broken);
    try {
      const { scanId } = await createScanFor(prisma, fixtures.url('/clean/'));
      await q.enqueue(scanId, 3);
      const row = await waitForStatus(scanId, ['FAILED']);
      await new Promise((r) => setTimeout(r, 500));
      expect(calls).toBe(1);
      expect(row.errorMessage).toBe(
        'The scan stopped because of an internal error. Please try again later.',
      );
    } finally {
      await q.close();
    }
  });

  it('skips a job whose scan was cancelled while it waited in the queue', async () => {
    let calls = 0;
    const q = setup(async () => {
      calls += 1;
      return 'COMPLETED';
    });
    try {
      const { scanId } = await createScanFor(prisma, fixtures.url('/clean/'));
      await prisma.scan.update({ where: { id: scanId }, data: { status: 'CANCELLING' } });
      await q.enqueue(scanId);
      const row = await waitForStatus(scanId, ['CANCELLED']);
      expect(row.finishedAt).not.toBeNull();
      expect(calls).toBe(0);
    } finally {
      await q.close();
    }
  });

  it('cancels a running scan when the API publishes a cancel message', async () => {
    const q = setup();
    try {
      const { scanId } = await createScanFor(prisma, fixtures.url('/slow/'), {
        maxPages: 1,
        responsivePageLimit: 0,
      });
      await q.enqueue(scanId);
      await waitForStatus(scanId, ['RUNNING']);
      await new Promise((r) => setTimeout(r, 1_500));
      // What POST /api/scans/:id/cancel does:
      await prisma.scan.update({ where: { id: scanId }, data: { status: 'CANCELLING' } });
      await publisher.publish('whc:scan-cancel', scanId);
      const row = await waitForStatus(scanId, ['CANCELLED'], 20_000);
      expect(row.status).toBe('CANCELLED');
      expect(q.scanner.activeScans.size).toBe(0);
    } finally {
      await q.close();
    }
  });
});
