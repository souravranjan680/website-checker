import { createPrismaClient } from '@whc/db';
import packageJson from '../package.json' with { type: 'json' };
import { createApp } from './app';
import { loadConfig } from './config/env';
import { systemResolveHostname } from './lib/hostname-guard';
import { createLogger } from './lib/logger';
import { createSmtpMailer } from './lib/mailer';
import { createClaudeProvider } from './lib/ai-provider';
import { createBullExportJobs } from './lib/export-jobs';
import { startNotificationEmailWorker } from './lib/notification-email';
import { createRedisRateLimitStore } from './lib/rate-limit';
import { createRedisClient } from './lib/redis';
import { createRedisScanEventHub } from './lib/scan-events';
import { createBullScanQueue } from './lib/scan-queue';
import { createHealthService } from './modules/health/health.service';

// Entry point: wires real dependencies together and starts the HTTP server.

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, pretty: config.nodeEnv === 'development' });

const prisma = createPrismaClient(config.databaseUrl);
const redis = createRedisClient(config.redisUrl, logger);

const healthService = createHealthService({
  probes: {
    database: () => prisma.$queryRaw`SELECT 1`,
    redis: () => redis.ping(),
  },
  version: packageJson.version,
  environment: config.nodeEnv,
  exposeErrors: config.nodeEnv !== 'production',
});

const scanQueue = createBullScanQueue(config.redisUrl, config.scans.queuePrefix);
const scanEvents = createRedisScanEventHub(config.redisUrl, redis, logger);
// PDF reports are rendered by the scanner worker (it already has a browser).
const exportJobs = createBullExportJobs({
  redisUrl: config.redisUrl,
  prefix: config.scans.queuePrefix,
  storageDir: config.scans.storageDir,
  logger,
});

// The key is read here once and handed to the provider; it is not part of AppConfig,
// never logged and never sent to the browser.
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const aiProvider = anthropicKey
  ? createClaudeProvider({
      apiKey: anthropicKey,
      model: config.claudeModel,
      maxOutputTokens: config.ai.maxOutputTokens,
      logger,
    })
  : null;

const mailer = createSmtpMailer(config.mail);
// Sends the e-mails queued by the scanner for notifications (see lib/notification-email.ts).
const notificationWorker = startNotificationEmailWorker({
  redisUrl: config.redisUrl,
  prefix: config.scans.queuePrefix,
  prisma,
  mailer,
  appUrl: config.appUrl,
  logger,
});

const app = createApp({
  config,
  logger,
  prisma,
  healthService,
  rateLimitStore: createRedisRateLimitStore(redis),
  mailer,
  resolveHostname: systemResolveHostname,
  scanQueue,
  scanEvents,
  exportJobs,
  aiProvider,
});

if (config.nodeEnv === 'production' && !config.auth.cookieSecure) {
  logger.warn(
    'COOKIE_SECURE=false in production: only acceptable for local http://localhost testing',
  );
}

const server = app.listen(config.port, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, `Could not start API on port ${config.port}`);
    process.exit(1);
  }
  logger.info(
    {
      port: config.port,
      env: config.nodeEnv,
      ai: config.aiConfigured ? config.claudeModel : 'disabled',
    },
    `API listening on http://localhost:${config.port}`,
  );
});

/** Stop accepting requests, finish in-flight ones, then close DB/Redis connections. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  server.close();
  await Promise.allSettled([
    prisma.$disconnect(),
    scanQueue.close(),
    scanEvents.close(),
    exportJobs.close(),
    notificationWorker.close(),
  ]);
  await redis.quit().catch(() => {});
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
