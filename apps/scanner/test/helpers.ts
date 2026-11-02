import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createPrismaClient, type PrismaClient } from '@whc/db';
import { createEgressProxy } from '@whc/egress-proxy';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadDomChecksBundle } from '../src/checks/dom';
import type { ScannerConfig } from '../src/config';
import type { ScanDeps } from '../src/pipeline/run-scan';
import { createLocalStorage } from '../src/storage';
import { FIXTURE_HOST } from './fixture-server';

const ROOT = path.resolve(import.meta.dirname, '../../..');
loadDotenv({ path: path.join(ROOT, '.env'), quiet: true });

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || url === process.env.DATABASE_URL)
    throw new Error('DATABASE_URL_TEST must be set to a separate database');
  return url;
}

export function migrateTestDatabase(): void {
  execSync('npx prisma migrate deploy', {
    cwd: path.join(ROOT, 'packages/db'),
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} CASCADE`,
  );
}

export const silentLogger = pino({ level: 'silent' });

/**
 * A real egress proxy for tests. Only FIXTURE_HOST (plus any `extraHosts`, which
 * simulate third-party services) is mapped to 127.0.0.1.
 */
export async function startTestProxy(extraHosts: string[] = []) {
  const testHostMap = Object.fromEntries(
    [FIXTURE_HOST, ...extraHosts].map((host) => [host, '127.0.0.1']),
  );
  const server = createEgressProxy({
    policy: { allowedPorts: [80, 443], testHostMap },
    logger: silentLogger,
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export function testScannerConfig(
  proxyUrl: string,
  overrides: Partial<ScannerConfig> = {},
): ScannerConfig {
  return {
    nodeEnv: 'test',
    logLevel: 'silent',
    databaseUrl: testDatabaseUrl(),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    egressProxyUrl: proxyUrl,
    storageDir: path.join(ROOT, '.scanner-test-storage', randomUUID()),
    concurrency: 1,
    maxPages: 20,
    navTimeoutMs: 15_000,
    maxDurationMs: 120_000,
    maxLinkChecks: 50,
    maxIssueScreenshots: 20,
    // Lighthouse adds ~10-20 s per page; only the performance test turns it on.
    lighthouseEnabled: false,
    maxLighthousePages: 1,
    lighthouseTimeoutMs: 90_000,
    // Visual snapshots add a few seconds per page; tests that need them turn them on.
    visualPages: 0,
    retentionDays: 0,
    headless: true,
    ...overrides,
  };
}

export function createTestDeps(
  config: ScannerConfig,
  prisma: PrismaClient,
  publisher: Redis,
): ScanDeps {
  return {
    prisma,
    storage: createLocalStorage(config.storageDir),
    config,
    logger: silentLogger,
    publisher,
    domBundle: loadDomChecksBundle(),
  };
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

export function createPublisher(): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
}

/** Creates user → project → website → queued scan, like the API would. */
export async function createScanFor(
  prisma: PrismaClient,
  baseUrl: string,
  website: Partial<{
    maxPages: number;
    maxDepth: number;
    responsivePageLimit: number;
    respectRobotsTxt: boolean;
  }> = {},
  existingWebsiteId?: string,
): Promise<{ scanId: string; websiteId: string }> {
  let websiteId = existingWebsiteId;
  if (!websiteId) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, name: 'Scanner test', passwordHash: 'x' },
    });
    const project = await prisma.project.create({
      data: {
        name: 'Fixtures',
        createdById: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    const created = await prisma.website.create({
      data: {
        projectId: project.id,
        name: 'Fixture site',
        baseUrl,
        hostname: new URL(baseUrl).hostname,
        authorizationConfirmedAt: new Date(),
        maxPages: website.maxPages ?? 10,
        maxDepth: website.maxDepth ?? 2,
        responsivePageLimit: website.responsivePageLimit ?? 1,
        respectRobotsTxt: website.respectRobotsTxt ?? true,
      },
    });
    websiteId = created.id;
  }
  const scan = await prisma.scan.create({ data: { websiteId, config: {}, status: 'QUEUED' } });
  return { scanId: scan.id, websiteId };
}
