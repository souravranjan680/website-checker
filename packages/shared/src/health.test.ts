import { describe, expect, it } from 'vitest';
import { healthReportSchema } from './health';

describe('healthReportSchema', () => {
  const valid = {
    status: 'ok',
    service: 'api',
    version: '0.1.0',
    environment: 'test',
    uptimeSeconds: 3,
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'up', latencyMs: 2 },
      redis: { status: 'down', latencyMs: 2000, error: 'timeout' },
    },
  };

  it('accepts a valid report', () => {
    expect(healthReportSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown status', () => {
    expect(healthReportSchema.safeParse({ ...valid, status: 'maybe' }).success).toBe(false);
  });
});
