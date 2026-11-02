import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  EGRESS_PROXY_URL: z.url().default('http://127.0.0.1:3128'),
  STORAGE_DIR: z.string().default('./storage'),
  SCANNER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  SCAN_MAX_PAGES: z.coerce.number().int().min(1).max(500).default(100),
  SCAN_NAV_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  SCAN_MAX_DURATION_MS: z.coerce
    .number()
    .int()
    .min(30_000)
    .default(15 * 60_000),
  SCAN_MAX_LINK_CHECKS: z.coerce.number().int().min(0).max(1000).default(150),
  SCAN_MAX_ISSUE_SCREENSHOTS: z.coerce.number().int().min(0).max(200).default(40),
  /** Lighthouse performance audit: on/off, at most this many pages per scan, time per page. */
  SCAN_LIGHTHOUSE_ENABLED: z.stringbool().default(true),
  SCAN_MAX_LIGHTHOUSE_PAGES: z.coerce.number().int().min(0).max(10).default(3),
  SCAN_LIGHTHOUSE_TIMEOUT_MS: z.coerce.number().int().min(20_000).max(300_000).default(90_000),
  /** Visual regression: PNG snapshots of this many pages (desktop + mobile). 0 = off. */
  SCAN_VISUAL_PAGES: z.coerce.number().int().min(0).max(10).default(3),
  /** Days to keep page screenshots and raw Lighthouse files of old scans. 0 = keep forever. */
  SCAN_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
  SCANNER_HEADLESS: z.stringbool().default(true),
  SCANNER_BROWSER_CHANNEL: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
});

export interface ScannerConfig {
  nodeEnv: string;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  egressProxyUrl: string;
  storageDir: string;
  concurrency: number;
  maxPages: number;
  navTimeoutMs: number;
  maxDurationMs: number;
  maxLinkChecks: number;
  maxIssueScreenshots: number;
  lighthouseEnabled: boolean;
  maxLighthousePages: number;
  lighthouseTimeoutMs: number;
  visualPages: number;
  retentionDays: number;
  headless: boolean;
  browserChannel?: string;
}

/** The folder that contains the root package.json with "workspaces" (the repository root). */
export function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && readFileSync(pkg, 'utf8').includes('"workspaces"')) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function loadScannerConfig(source: NodeJS.ProcessEnv = process.env): ScannerConfig {
  const root = findRepoRoot();
  if (source === process.env && existsSync(path.join(root, '.env'))) {
    loadDotenv({ path: path.join(root, '.env'), quiet: true });
  }
  const env = schema.parse(source);
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    egressProxyUrl: env.EGRESS_PROXY_URL,
    // Relative paths are relative to the repository root, so API and scanner agree.
    storageDir: path.resolve(root, env.STORAGE_DIR),
    concurrency: env.SCANNER_CONCURRENCY,
    maxPages: env.SCAN_MAX_PAGES,
    navTimeoutMs: env.SCAN_NAV_TIMEOUT_MS,
    maxDurationMs: env.SCAN_MAX_DURATION_MS,
    maxLinkChecks: env.SCAN_MAX_LINK_CHECKS,
    maxIssueScreenshots: env.SCAN_MAX_ISSUE_SCREENSHOTS,
    lighthouseEnabled: env.SCAN_LIGHTHOUSE_ENABLED,
    maxLighthousePages: env.SCAN_MAX_LIGHTHOUSE_PAGES,
    lighthouseTimeoutMs: env.SCAN_LIGHTHOUSE_TIMEOUT_MS,
    visualPages: env.SCAN_VISUAL_PAGES,
    retentionDays: env.SCAN_RETENTION_DAYS,
    headless: env.SCANNER_HEADLESS,
    browserChannel: env.SCANNER_BROWSER_CHANNEL,
  };
}
