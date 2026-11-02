import type { PrismaClient } from '@whc/db';
import { scanChannels, type ScanEvent, type ScanProgressEvent } from '@whc/shared';
import type { Redis } from 'ioredis';
import type { Logger } from './logger';

export type ProgressState = Omit<ScanProgressEvent, 'type' | 'scanId' | 'at'>;

/**
 * Reports live progress in two places:
 *   Redis (pub/sub + a "latest" key): instant, for the browser's live view
 *   PostgreSQL (the Scan row): durable, at most once per second
 * A Redis outage never breaks a scan: publishing errors are logged and ignored.
 */
export function createProgressReporter(deps: {
  prisma: PrismaClient;
  publisher: Redis;
  scanId: string;
  logger: Logger;
}) {
  const { prisma, publisher, scanId, logger } = deps;
  const state: ProgressState = {
    status: 'RUNNING',
    progress: 0,
    step: 'Starting',
    currentUrl: null,
    pagesDiscovered: 0,
    pagesScanned: 0,
    pagesFailed: 0,
    issuesFound: 0,
  };
  let lastDbWrite = 0;

  async function publish(event: ScanEvent): Promise<void> {
    try {
      const json = JSON.stringify(event);
      await publisher.publish(scanChannels.events(scanId), json);
      if (event.type === 'progress')
        await publisher.set(scanChannels.latest(scanId), json, 'EX', 3600);
    } catch (error) {
      logger.warn({ scanId, err: (error as Error).message }, 'could not publish progress');
    }
  }

  return {
    state,
    async update(patch: Partial<ProgressState>, options: { force?: boolean } = {}): Promise<void> {
      Object.assign(state, patch);
      state.progress = Math.max(0, Math.min(100, Math.round(state.progress)));
      await publish({ type: 'progress', scanId, ...state, at: new Date().toISOString() });
      if (options.force || Date.now() - lastDbWrite > 1000) {
        lastDbWrite = Date.now();
        await prisma.scan.update({
          where: { id: scanId },
          data: {
            progress: state.progress,
            currentStep: state.currentUrl ? `${state.step}: ${state.currentUrl}` : state.step,
            pagesDiscovered: state.pagesDiscovered,
            pagesScanned: state.pagesScanned,
            pagesFailed: state.pagesFailed,
            totalIssues: state.issuesFound,
          },
        });
      }
    },
    async finished(status: string): Promise<void> {
      await publish({ type: 'finished', scanId, status, at: new Date().toISOString() });
    },
  };
}

export type ProgressReporter = ReturnType<typeof createProgressReporter>;
