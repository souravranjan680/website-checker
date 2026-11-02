import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { EgressPolicy } from './policy';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  PROXY_HOST: z.string().default('127.0.0.1'),
  PROXY_PORT: z.coerce.number().int().min(1).max(65535).default(3128),
  PROXY_ALLOWED_PORTS: z.string().default('80,443'),
  PROXY_TEST_HOST_MAP: z.string().default(''),
});

export interface ProxyConfig {
  nodeEnv: string;
  logLevel: string;
  host: string;
  port: number;
  policy: EgressPolicy;
}

export function loadProxyConfig(source: NodeJS.ProcessEnv = process.env): ProxyConfig {
  if (source === process.env) {
    for (const candidate of [path.resolve('.env'), path.resolve('../../.env')]) {
      if (existsSync(candidate)) {
        loadDotenv({ path: candidate, quiet: true });
        break;
      }
    }
  }
  const env = schema.parse(source);
  const testHostMap = Object.fromEntries(
    env.PROXY_TEST_HOST_MAP.split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => pair.split('=').map((part) => part.trim().toLowerCase()) as [string, string]),
  );
  if (env.NODE_ENV === 'production' && Object.keys(testHostMap).length > 0) {
    // A test exception must never reach production.
    throw new Error('PROXY_TEST_HOST_MAP is not allowed when NODE_ENV=production');
  }
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.PROXY_HOST,
    port: env.PROXY_PORT,
    policy: {
      allowedPorts: env.PROXY_ALLOWED_PORTS.split(',')
        .map((p) => Number(p.trim()))
        .filter(Boolean),
      testHostMap,
    },
  };
}
