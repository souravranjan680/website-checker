import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Queue, QueueEvents } from 'bullmq';
import { AppError } from './errors';
import type { Logger } from './logger';

export const EXPORT_QUEUE_NAME = 'exports';

/** Produces a PDF report for a scan. Tests use a fake. */
export interface PdfRenderer {
  render(scanId: string, category?: string): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * PDFs are made by the scanner worker, which already has a headless Chromium.
 * The API adds an "exports" job, waits for the worker to finish (max 90 s),
 * reads the PDF from shared storage and returns the bytes. The API's storage mount is
 * read-only, so the scanner deletes old export files itself (see pdf-worker.ts).
 */
export function createBullPdfRenderer(options: {
  redisUrl: string;
  prefix: string;
  storageDir: string;
  logger: Logger;
}): PdfRenderer {
  const { logger } = options;
  const connection = { url: options.redisUrl, maxRetriesPerRequest: null };
  const queue = new Queue(EXPORT_QUEUE_NAME, { connection, prefix: options.prefix });
  const events = new QueueEvents(EXPORT_QUEUE_NAME, { connection, prefix: options.prefix });
  queue.on('error', (err) => logger.warn({ err }, 'export queue connection error'));
  events.on('error', (err) => logger.warn({ err }, 'export queue events error'));

  return {
    async render(scanId, category) {
      const unavailable = new AppError(
        503,
        'PDF_UNAVAILABLE',
        'PDF export needs the scanner service, which is not running. CSV and JSON exports still work.',
      );
      let workers: number;
      try {
        workers = (await queue.getWorkers()).length;
      } catch (err) {
        logger.warn({ err }, 'could not reach the export queue');
        throw unavailable;
      }
      if (workers === 0) throw unavailable;

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
    async close() {
      await Promise.allSettled([queue.close(), events.close()]);
    },
  };
}
