import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a redis:// URL' }),
  CORS_ORIGINS: z.string().default(''),
  CLAUDE_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
  claudeModel: string;
  /** True when an Anthropic key is configured (the key itself never leaves this process). */
  aiConfigured: boolean;
}

/**
 * Loads the repository-root .env file when running on your PC.
 * npm runs workspace scripts inside apps/api, so the root is two folders up.
 * Existing environment variables always win (Docker sets them directly).
 */
function loadRootEnvFile(): void {
  for (const candidate of [path.resolve('.env'), path.resolve('../../.env')]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      return;
    }
  }
}

/** Reads and validates configuration. Throws a readable error listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (source === process.env) loadRootEnvFile();

  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    claudeModel: env.CLAUDE_MODEL,
    aiConfigured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
  };
}
