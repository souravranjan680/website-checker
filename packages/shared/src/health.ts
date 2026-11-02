import { z } from 'zod';

/**
 * Shape of GET /api/health.
 * The API builds this object; the web app validates it with the same schema,
 * so both sides always agree on the contract.
 */
export const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
});

export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;
