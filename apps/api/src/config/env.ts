import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { findRepoRoot } from '../lib/storage';

/** "15m" → 900 seconds. Supports s (seconds), m (minutes), h (hours). */
const durationSchema = z
  .string()
  .regex(/^\d+[smh]$/, 'use a number followed by s, m or h, e.g. 15m')
  .transform((value) => {
    const amount = Number(value.slice(0, -1));
    const unit = value.slice(-1);
    return amount * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
  });

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgresql:// URL' }),
    REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a redis:// URL' }),
    CORS_ORIGINS: z.string().default(''),

    // Authentication
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL: durationSchema.default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    COOKIE_SECURE: z.stringbool().optional(),
    APP_URL: z.url().default('http://localhost:5173'),
    RATE_LIMIT_ENABLED: z.stringbool().default(true),

    // Email
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    MAIL_FROM: z.string().default('Website Health Checker <no-reply@whc.local>'),

    // Scanning
    STORAGE_DIR: z.string().default('./storage'),
    REQUIRE_DOMAIN_VERIFICATION: z.stringbool().default(false),
    SCAN_QUEUE_PREFIX: z.string().default('whc'),
    MAX_ACTIVE_SCANS_PER_USER: z.coerce.number().int().min(1).max(20).default(3),

    // AI (Phase 6)
    CLAUDE_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
    ANTHROPIC_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'still has the example value; generate a real secret (see README)',
      });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
  auth: {
    jwtSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlDays: number;
    cookieSecure: boolean;
  };
  appUrl: string;
  rateLimitEnabled: boolean;
  mail: { host: string; port: number; user?: string; password?: string; from: string };
  scans: {
    storageDir: string;
    requireDomainVerification: boolean;
    queuePrefix: string;
    maxActivePerUser: number;
  };
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
    auth: {
      jwtSecret: env.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      // Secure cookies are only sent over HTTPS. Default: on in production, off locally.
      cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    },
    appUrl: env.APP_URL.replace(/\/$/, ''),
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    mail: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.MAIL_FROM,
    },
    scans: {
      // Relative paths are relative to the repository root, so API and scanner agree.
      storageDir: path.resolve(findRepoRoot(), env.STORAGE_DIR),
      requireDomainVerification: env.REQUIRE_DOMAIN_VERIFICATION,
      queuePrefix: env.SCAN_QUEUE_PREFIX,
      maxActivePerUser: env.MAX_ACTIVE_SCANS_PER_USER,
    },
    claudeModel: env.CLAUDE_MODEL,
    aiConfigured: Boolean(env.ANTHROPIC_API_KEY),
  };
}
