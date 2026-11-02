import type { PrismaClient } from '@whc/db';
import { FINISHED_SCAN_STATUSES, SCAN_QUEUE_NAME, scanChannels } from '@whc/shared';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { ScannerConfig } from './config';
import type { Logger } from './logger';
import { NOTIFICATION_QUEUE_NAME, notifyScanFinished } from './notifications';
import { resetScanResults } from './persistence';
import { runScan, type ScanDeps, type ScanOutcome } from './pipeline/run-scan';
import type { FileStorage } from './storage';

export interface ScanJobData {
  scanId: string;
}

export interface WorkerDeps {
  config: ScannerConfig;
  prisma: PrismaClient;
  storage: FileStorage;
  logger: Logger;
  domBundle: string;
  /** BullMQ key prefix (tests use their own so they never touch real jobs). */
  queuePrefix?: string;
  /** Replaceable in tests. */
  runScanImpl?: typeof runScan;
}

const publishFinished = async (publisher: Redis, scanId: string, status: string) => {
  await publisher
    .publish(
      scanChannels.events(scanId),
      JSON.stringify({ type: 'finished', scanId, status, at: new Date().toISOString() }),
    )
    .catch(() => {});
};

/**
 * The BullMQ worker. BullMQ stores jobs in Redis; the worker takes one job at a
 * time per concurrency slot, calls our processor, and records success/failure.
 * Retries (with backoff) happen when the processor throws a normal Error;
 * UnrecoverableError means "don't retry".
 */
export function createScanWorker(deps: WorkerDeps) {
  const { config, prisma, logger } = deps;
  const publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const active = new Map<string, AbortController>();
  const run = deps.runScanImpl ?? runScan;

  // Cancellation: the API publishes the scan ID on a Redis channel.
  void subscriber.subscribe(scanChannels.cancel);
  subscriber.on('message', (_channel, scanId: string) => {
    const controller = active.get(scanId);
    if (controller) {
      logger.info({ scanId }, 'cancel request received');
      controller.abort();
    }
  });

  // Notification e-mails are sent by the API (it can reach SMTP); we only queue them.
  const emailQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    prefix: deps.queuePrefix ?? 'whc',
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 7 * 86_400 },
    },
  });
  emailQueue.on('error', (err) => logger.warn({ err }, 'notification queue error'));

  const scanDeps: ScanDeps = {
    prisma,
    storage: deps.storage,
    config,
    logger,
    publisher,
    domBundle: deps.domBundle,
    emailQueue,
  };

  async function process(job: Job<ScanJobData>): Promise<ScanOutcome | 'SKIPPED'> {
    const { scanId } = job.data;
    const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { status: true } });
    if (!scan) return 'SKIPPED'; // deleted while queued
    if ((FINISHED_SCAN_STATUSES as readonly string[]).includes(scan.status)) return 'SKIPPED';
    if (scan.status === 'CANCELLING') {
      await prisma.scan.update({
        where: { id: scanId },
        data: { status: 'CANCELLED', finishedAt: new Date(), currentStep: 'Cancelled' },
      });
      await publishFinished(publisher, scanId, 'CANCELLED');
      return 'CANCELLED';
    }
    if (job.attemptsMade > 0) {
      logger.info(
        { scanId, attempt: job.attemptsMade + 1 },
        'retrying scan: clearing partial results',
      );
      await resetScanResults(prisma, deps.storage, scanId);
    }

    const controller = new AbortController();
    active.set(scanId, controller);
    // Backup for a missed pub/sub message: check the database every few seconds.
    const poll = setInterval(() => {
      void prisma.scan
        .findUnique({ where: { id: scanId }, select: { status: true } })
        .then((row) => {
          if (row?.status === 'CANCELLING') controller.abort();
        })
        .catch(() => {});
    }, 3_000);

    try {
      return await run(scanId, scanDeps, { signal: controller.signal });
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = error instanceof UnrecoverableError || job.attemptsMade + 1 >= attempts;
      logger.error(
        { scanId, err: error, attempt: job.attemptsMade + 1, finalAttempt },
        'scan attempt failed',
      );
      if (finalAttempt) {
        await prisma.scan
          .update({
            where: { id: scanId },
            data: {
              status: 'FAILED',
              // Never show internal details to users; they are in the scanner log.
              errorMessage:
                'The scan stopped because of an internal error. Please try again later.',
              finishedAt: new Date(),
              currentStep: 'Failed',
            },
          })
          .catch(() => {});
        await publishFinished(publisher, scanId, 'FAILED');
        await notifyScanFinished(
          { prisma, emailQueue, logger },
          { scanId, status: 'FAILED', regressions: null },
        ).catch((err: unknown) => logger.warn({ err, scanId }, 'could not create notifications'));
      } else {
        await prisma.scan
          .update({
            where: { id: scanId },
            data: { currentStep: 'Retrying after a temporary problem' },
          })
          .catch(() => {});
      }
      throw error;
    } finally {
      clearInterval(poll);
      active.delete(scanId);
    }
  }

  const worker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, process, {
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    prefix: deps.queuePrefix ?? 'whc',
    concurrency: config.concurrency,
    // A scan can take minutes; BullMQ renews this lock automatically while it runs.
    lockDuration: 120_000,
    maxStalledCount: 1,
  });
  worker.on('failed', (job, error) =>
    logger.warn({ scanId: job?.data.scanId, err: error.message }, 'job failed'),
  );
  worker.on('error', (error) => logger.error({ err: error }, 'worker error'));

  return {
    worker,
    activeScans: active,
    async close(): Promise<void> {
      for (const controller of active.values()) controller.abort();
      await worker.close();
      await Promise.allSettled([subscriber.quit(), publisher.quit(), emailQueue.close()]);
    },
  };
}
