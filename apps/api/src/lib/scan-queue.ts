import { SCAN_QUEUE_NAME } from '@whc/shared';
import { Queue } from 'bullmq';

/** What the API needs from the job queue. Tests use an in-memory fake. */
export interface ScanQueue {
  enqueue(scanId: string): Promise<void>;
  /** Removes a job that hasn't started yet. false if it is already running or gone. */
  remove(scanId: string): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * The API is the BullMQ "producer": it only adds { scanId } jobs to Redis.
 * The scanner worker (a separate process) picks them up.
 */
export function createBullScanQueue(redisUrl: string, prefix: string): ScanQueue {
  const queue = new Queue(SCAN_QUEUE_NAME, {
    // Fail fast instead of hanging an HTTP request while Redis is down.
    connection: { url: redisUrl, enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    prefix,
    defaultJobOptions: {
      attempts: 2, // one retry for temporary failures (e.g. the browser crashed)
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  queue.on('error', () => {
    // Connection errors surface as failed enqueue() calls; avoid unhandled 'error' events.
  });

  return {
    async enqueue(scanId) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('queue timeout')), 5_000);
      });
      try {
        // jobId = scanId: adding the same scan twice is a no-op.
        await Promise.race([queue.add('scan', { scanId }, { jobId: scanId }), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    async remove(scanId) {
      try {
        const job = await queue.getJob(scanId);
        if (!job || (await job.isActive())) return false;
        await job.remove();
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await queue.close();
    },
  };
}
