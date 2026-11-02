import { createPrismaClient } from '@whc/db';
import { loadDomChecksBundle } from './checks/dom';
import { loadScannerConfig } from './config';
import { createPdfExportWorker } from './export/pdf-worker';
import { createLogger } from './logger';
import { startMaintenance } from './maintenance';
import { createLocalStorage } from './storage';
import { createScanWorker } from './worker';

// Entry point of the scanner service: connects to PostgreSQL and Redis and waits for jobs.
const config = loadScannerConfig();
const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
const prisma = createPrismaClient(config.databaseUrl);

const storage = createLocalStorage(config.storageDir);
const scanner = createScanWorker({
  config,
  prisma,
  storage,
  logger,
  domBundle: loadDomChecksBundle(),
});
// PDF reports for the API's export endpoint (same browser engine, separate queue).
const pdfExports = createPdfExportWorker({ config, prisma, storage, logger });
// Removes files of deleted scans, unused baseline images and (optionally) old artifacts.
const maintenance = startMaintenance({
  prisma,
  storage,
  logger,
  retentionDays: config.retentionDays,
});

logger.info(
  { concurrency: config.concurrency, proxy: config.egressProxyUrl, storage: config.storageDir },
  'Scanner worker ready, waiting for scan jobs',
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received: stopping (running scans are cancelled)`);
  const force = setTimeout(() => process.exit(1), 20_000);
  force.unref();
  maintenance.stop();
  await Promise.allSettled([scanner.close(), pdfExports.close()]);
  await prisma.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
