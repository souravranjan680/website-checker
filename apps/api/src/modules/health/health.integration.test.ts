/**
 * Integration test: uses the REAL PostgreSQL and Redis.
 * Start them first:  npm run services:up
 */
import { once } from 'node:events';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createFakeMailer,
  createFakeScanEvents,
  createFakeScanQueue,
  createTestPrisma,
  fakeResolveHostname,
  testConfig,
} from '../../../test/helpers';
import { createApp } from '../../app';
import { createLogger } from '../../lib/logger';
import { createMemoryRateLimitStore } from '../../lib/rate-limit';
import { createRedisClient } from '../../lib/redis';
import { createHealthService } from './health.service';

const config = testConfig();
const logger = createLogger({ level: 'silent', pretty: false });
const prisma = createTestPrisma();
const redis = createRedisClient(config.redisUrl, logger);

afterAll(async () => {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
});

describe('health check against real services', () => {
  it('reports PostgreSQL and Redis as up', async () => {
    // The client fails fast while disconnected, so wait until the first connection is ready.
    if (redis.status !== 'ready') await once(redis, 'ready');
    const app = createApp({
      config,
      logger,
      prisma,
      healthService: createHealthService({
        probes: { database: () => prisma.$queryRaw`SELECT 1`, redis: () => redis.ping() },
        version: 'test',
        environment: 'test',
        exposeErrors: true,
      }),
      rateLimitStore: createMemoryRateLimitStore(),
      mailer: createFakeMailer(),
      resolveHostname: fakeResolveHostname,
      scanQueue: createFakeScanQueue(),
      scanEvents: createFakeScanEvents(),
    });

    const res = await request(app).get('/api/health');

    expect(res.body.checks).toMatchObject({ database: { status: 'up' }, redis: { status: 'up' } });
    expect(res.status).toBe(200);
  });
});
