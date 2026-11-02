import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Queue, QueueEvents } from 'bullmq';
import { AppError } from './errors';
import type { Logger } from './logger';

export const EXPORT_QUEUE_NAME = 'exports';

/**
 * Work the API hands to the scanner worker (it has the browser and write access
 * to storage). Tests use a fake.
 */
export interface ExportJobs {
  /** A PDF report for a scan. */
  render(scanId: string, category?: string): Promise<Buffer>;
  /** Copies a scan's visual snapshot to a baseline file (the API's storage is read-only). */
  copyBaseline(fromKey: string, toKey: string): Promise<{ sizeBytes: number }>;
  close(): Promise<void>;
}

/**
 * PDFs are made by the scanner worker, which already has a headless Chromium.
 * The API adds an "exports" job, waits for the worker to finish (max 90 s),
 * reads the PDF from shared storage and returns the bytes. The API's storage mount is
 * read-only, so the scanner deletes old export files itself (see pdf-worker.ts).
 */
export function createBullExportJobs(options: {
  redisUrl: string;
  prefix: string;
  storageDir: string;
  logger: Logger;
}): ExportJobs {
  const { logger } = options;
  const connection = { url: options.redisUrl, maxRetriesPerRequest: null };
  const queue = new Queue(EXPORT_QUEUE_NAME, { connection, prefix: options.prefix });
  const events = new QueueEvents(EXPORT_QUEUE_NAME, { connection, prefix: options.prefix });
  queue.on('error', (err) => logger.warn({ err }, 'export queue connection error'));
  events.on('error', (err) => logger.warn({ err }, 'export queue events error'));

  /** Throws a clear 503 when no scanner worker is listening. */
  async function requireWorker(unavailable: AppError): Promise<void> {
    let workers: number;
    try {
      workers = (await queue.getWorkers()).length;
    } catch (err) {
      logger.warn({ err }, 'could not reach the export queue');
      throw unavailable;
    }
    if (workers === 0) throw unavailable;
  }

  return {
    async render(scanId, category) {
      await requireWorker(
        new AppError(
          503,
          'PDF_UNAVAILABLE',
          'PDF export needs the scanner service, which is not running. CSV and JSON exports still work.',
        ),
      );

      const job = await queue.add(
        'pdf',
        { scanId, category },
        { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86_400 } },
      );
      let result: { key: string };
      try {
        result = (await job.waitUntilFinished(events, 90_000)) as { key: string };
      } catch (err) {
        logger.error({ err, scanId, jobId: job.id }, 'PDF export job failed');
        throw new AppError(503, 'PDF_FAILED', 'The PDF could not be generated. Please try again.');
      }
      const file = path.resolve(options.storageDir, result.key);
      if (!file.startsWith(path.resolve(options.storageDir) + path.sep))
        throw new AppError(500, 'INTERNAL_ERROR', 'Invalid export path.');
      return readFile(file);
    },
    async copyBaseline(fromKey, toKey) {
      await requireWorker(
        new AppError(
          503,
          'SCANNER_UNAVAILABLE',
          'Saving a baseline needs the scanner service, which is not running. Please try again later.',
        ),
      );
      const job = await queue.add(
        'copy-baseline',
        { fromKey, toKey },
        { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86_400 } },
      );
      try {
        return (await job.waitUntilFinished(events, 30_000)) as { sizeBytes: number };
      } catch (err) {
        logger.error({ err, jobId: job.id }, 'baseline copy job failed');
        throw new AppError(
          503,
          'BASELINE_COPY_FAILED',
          'The baseline could not be saved. Please try again.',
        );
      }
    },
    async close() {
      await Promise.allSettled([queue.close(), events.close()]);
    },
  };
}
