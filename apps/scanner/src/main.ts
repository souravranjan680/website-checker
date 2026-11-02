import { createPrismaClient } from '@whc/db';
import { loadDomChecksBundle } from './checks/dom';
import { loadScannerConfig } from './config';
import { createLogger } from './logger';
import { createLocalStorage } from './storage';
import { createScanWorker } from './worker';

// Entry point of the scanner service: connects to PostgreSQL and Redis and waits for jobs.
const config = loadScannerConfig();
const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
const prisma = createPrismaClient(config.databaseUrl);

const scanner = createScanWorker({
  config,
  prisma,
  storage: createLocalStorage(config.storageDir),
  logger,
  domBundle: loadDomChecksBundle(),
});

logger.info(
  { concurrency: config.concurrency, proxy: config.egressProxyUrl, storage: config.storageDir },
  'Scanner worker ready, waiting for scan jobs',
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received: stopping (running scans are cancelled)`);
  const force = setTimeout(() => process.exit(1), 20_000);
  force.unref();
  await scanner.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
