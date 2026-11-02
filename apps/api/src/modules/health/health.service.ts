import type { DependencyCheck, HealthReport } from '@whc/shared';

/** A function that resolves when a dependency is reachable and throws when it isn't. */
export type HealthProbe = () => Promise<unknown>;

export interface HealthServiceOptions {
  probes: { database: HealthProbe; redis: HealthProbe };
  version: string;
  environment: string;
  /** In production, hide raw error messages (they can reveal internal host names). */
  exposeErrors: boolean;
  timeoutMs?: number;
}

export interface HealthService {
  getReport(): Promise<HealthReport>;
}

export function createHealthService(options: HealthServiceOptions): HealthService {
  const timeoutMs = options.timeoutMs ?? 2_000;

  async function runProbe(probe: HealthProbe): Promise<DependencyCheck> {
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    try {
      await withTimeout(probe(), timeoutMs);
      return { status: 'up', latencyMs: elapsed() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        status: 'down',
        latencyMs: elapsed(),
        error: options.exposeErrors ? reason : 'unreachable',
      };
    }
  }

  return {
    async getReport() {
      // Both checks run at the same time, so the endpoint is as fast as the slowest one.
      const [database, redis] = await Promise.all([
        runProbe(options.probes.database),
        runProbe(options.probes.redis),
      ]);
      return {
        status: database.status === 'up' && redis.status === 'up' ? 'ok' : 'error',
        service: 'whc-api',
        version: options.version,
        environment: options.environment,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: { database, redis },
      };
    },
  };
}

/** Rejects if `promise` takes longer than `ms`, so a hung dependency can't hang the endpoint. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
