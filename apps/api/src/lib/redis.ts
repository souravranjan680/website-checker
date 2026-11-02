import { Redis } from 'ioredis';
import type { Logger } from './logger';

/**
 * Creates the Redis connection. ioredis reconnects automatically in the background;
 * `enableOfflineQueue: false` makes commands fail fast while Redis is down instead
 * of waiting forever, which is what a health check needs.
 */
export function createRedisClient(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  // Log the first error of an outage only, not every reconnect attempt.
  let reportedOutage = false;
  redis.on('error', (error: Error) => {
    if (!reportedOutage) {
      logger.warn({ err: error.message }, 'Redis connection error (retrying in background)');
      reportedOutage = true;
    }
  });
  redis.on('ready', () => {
    reportedOutage = false;
    logger.info('Redis connected');
  });

  return redis;
}
