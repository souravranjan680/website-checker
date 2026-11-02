import { healthReportSchema } from '@whc/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createLogger } from '../../lib/logger';
import { createHealthService, type HealthProbe } from './health.service';

// Builds the app with fake probes: no database or Redis needed for these tests.
function buildApp(database: HealthProbe, redis: HealthProbe, exposeErrors = true) {
  const healthService = createHealthService({
    probes: { database, redis },
    version: '0.0.0-test',
    environment: 'test',
    exposeErrors,
    timeoutMs: 100,
  });
  return createApp({
    config: { corsOrigins: [] },
    logger: createLogger({ level: 'silent', pretty: false }),
    healthService,
  });
}

const up: HealthProbe = async () => 'ok';
const down: HealthProbe = async () => {
  throw new Error('connection refused');
};
const hangs: HealthProbe = () => new Promise(() => {});

describe('GET /api/health', () => {
  it('returns 200 and a valid report when everything is up', async () => {
    const res = await request(buildApp(up, up)).get('/api/health');

    expect(res.status).toBe(200);
    expect(healthReportSchema.parse(res.body).status).toBe('ok');
    expect(res.body.checks.database.status).toBe('up');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 and names the failing dependency', async () => {
    const res = await request(buildApp(up, down)).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks.redis).toMatchObject({ status: 'down', error: 'connection refused' });
  });

  it('times out a dependency that never answers', async () => {
    const res = await request(buildApp(hangs, up)).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.database.error).toMatch(/Timed out/);
  });

  it('hides internal error messages when exposeErrors is false (production)', async () => {
    const res = await request(buildApp(down, up, false)).get('/api/health');

    expect(res.body.checks.database.error).toBe('unreachable');
  });
});

describe('other routes', () => {
  it('GET /api/health/live answers without checking dependencies', async () => {
    const res = await request(buildApp(down, down)).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown routes return the standard JSON 404 with a request id', async () => {
    const res = await request(buildApp(up, up)).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('invalid JSON bodies return 400 INVALID_JSON', async () => {
    const res = await request(buildApp(up, up))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('sets security headers', async () => {
    const res = await request(buildApp(up, up)).get('/api/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
