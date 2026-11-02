/**
 * Shared test helpers: a real app wired to the TEST database, plus fakes for the
 * things we don't want in tests (real email, real DNS, shared rate-limit counters).
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createPrismaClient, type PrismaClient } from '@whc/db';
import type { UserDto } from '@whc/shared';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config/env';
import type { ResolveHostname } from '../src/lib/hostname-guard';
import { createLogger } from '../src/lib/logger';
import type { MailMessage, Mailer } from '../src/lib/mailer';
import { createMemoryRateLimitStore } from '../src/lib/rate-limit';
import type { AiProvider } from '../src/lib/ai-provider';
import type { ExportJobs } from '../src/lib/export-jobs';
import type { ScanEventHub } from '../src/lib/scan-events';
import type { ScanQueue } from '../src/lib/scan-queue';
import type { ScanEvent } from '@whc/shared';
import { createHealthService } from '../src/modules/health/health.service';
import { testDatabaseUrl } from './test-env';

/** Every state-changing request from our web app sends this header (CSRF protection). */
export const CSRF = { 'X-Requested-With': 'whc-web' };

export const TEST_PASSWORD = 'correct horse battery staple';

/** Fake DNS: known names resolve to fixed addresses; anything else "doesn't exist". */
const FAKE_DNS: Record<string, string[]> = {
  'example.com': ['93.184.215.14'],
  'www.example.com': ['93.184.215.14'],
  'example.org': ['93.184.215.15', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'shop.example.net': ['93.184.215.16'],
  'sneaky.example.com': ['10.0.0.8'], // public-looking name, private address
  'mixed.example.com': ['93.184.215.14', '127.0.0.1'],
};

export const fakeResolveHostname: ResolveHostname = async (hostname) => {
  const addresses = FAKE_DNS[hostname];
  if (!addresses) throw new Error(`ENOTFOUND ${hostname}`);
  return addresses;
};

export interface FakeMailer extends Mailer {
  sent: MailMessage[];
}

export function createFakeMailer(): FakeMailer {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    JWT_ACCESS_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
    RATE_LIMIT_ENABLED: 'false',
    COOKIE_SECURE: 'false',
    APP_URL: 'http://localhost:5173',
    ...overrides,
  });
}

/** In-memory stand-in for the BullMQ queue: records what the API enqueued. */
export interface FakeScanQueue extends ScanQueue {
  enqueued: string[];
  removed: string[];
  failNext: boolean;
}

export function createFakeScanQueue(): FakeScanQueue {
  const queue: FakeScanQueue = {
    enqueued: [],
    removed: [],
    failNext: false,
    async enqueue(scanId) {
      if (queue.failNext) {
        queue.failNext = false;
        throw new Error('Redis unavailable');
      }
      queue.enqueued.push(scanId);
    },
    async remove(scanId) {
      queue.removed.push(scanId);
      return true;
    },
    async close() {},
  };
  return queue;
}

/** In-memory stand-in for the Redis pub/sub hub (same behaviour, no Redis). */
export interface FakeScanEvents extends ScanEventHub {
  cancelRequests: string[];
  emit(event: ScanEvent): void;
}

export function createFakeScanEvents(): FakeScanEvents {
  const listeners = new Map<string, Set<(event: ScanEvent) => void>>();
  const hub: FakeScanEvents = {
    cancelRequests: [],
    subscribe(scanId, listener) {
      const set = listeners.get(scanId) ?? new Set();
      set.add(listener);
      listeners.set(scanId, set);
      return () => set.delete(listener);
    },
    async latest() {
      return null;
    },
    async publish(event) {
      hub.emit(event);
    },
    async requestCancel(scanId) {
      hub.cancelRequests.push(scanId);
    },
    async close() {},
    emit(event) {
      for (const listener of listeners.get(event.scanId) ?? []) listener(event);
    },
  };
  return hub;
}

/**
 * Stand-in for the scanner's export worker: returns a tiny fixed PDF, and copies
 * baseline files inside the test storage folder (what the real worker does).
 */
export interface FakeExportJobs extends ExportJobs {
  calls: { scanId: string; category?: string }[];
  copies: { fromKey: string; toKey: string }[];
}

export function createFakeExportJobs(storageDir = testConfig().scans.storageDir): FakeExportJobs {
  const renderer: FakeExportJobs = {
    calls: [],
    copies: [],
    async render(scanId, category) {
      renderer.calls.push({ scanId, category });
      return Buffer.from('%PDF-1.4\n% fake test pdf\n%%EOF\n');
    },
    async copyBaseline(fromKey, toKey) {
      renderer.copies.push({ fromKey, toKey });
      const from = path.join(storageDir, fromKey);
      const to = path.join(storageDir, toKey);
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
      return { sizeBytes: (await stat(to)).size };
    },
    async close() {},
  };
  return renderer;
}

export interface TestContext {
  app: Express;
  prisma: PrismaClient;
  mailer: FakeMailer;
  config: AppConfig;
  queue: FakeScanQueue;
  events: FakeScanEvents;
  pdf: FakeExportJobs;
}

export function createTestContext(
  prisma: PrismaClient,
  configOverrides: Record<string, string> = {},
  options: { aiProvider?: AiProvider } = {},
): TestContext {
  const config = testConfig(configOverrides);
  const mailer = createFakeMailer();
  const queue = createFakeScanQueue();
  const events = createFakeScanEvents();
  const pdf = createFakeExportJobs(config.scans.storageDir);
  const app = createApp({
    config,
    logger: createLogger({ level: 'silent', pretty: false }),
    prisma,
    healthService: createHealthService({
      probes: { database: async () => 1, redis: async () => 'PONG' },
      version: 'test',
      environment: 'test',
      exposeErrors: true,
    }),
    rateLimitStore: createMemoryRateLimitStore(),
    mailer,
    resolveHostname: fakeResolveHostname,
    scanQueue: queue,
    scanEvents: events,
    exportJobs: pdf,
    aiProvider: options.aiProvider ?? null,
  });
  return { app, prisma, mailer, config, queue, events, pdf };
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

/** Empties every table except Prisma's migration history. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  // Table names come from Postgres itself, not from user input.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

export type Agent = ReturnType<typeof request.agent>;

/**
 * Registers a user and returns a supertest "agent": it remembers cookies like a
 * browser, so later requests made with it are signed in as that user.
 */
export async function signUp(
  app: Express,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<{ agent: Agent; user: UserDto }> {
  const agent = request.agent(app);
  const body = {
    name: overrides.name ?? 'Test User',
    email: overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: overrides.password ?? TEST_PASSWORD,
  };
  const res = await agent.post('/api/auth/register').set(CSRF).send(body);
  if (res.status !== 201)
    throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.data.user as UserDto };
}

export async function makeAdmin(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
}

/** Extracts "name=value" of a Set-Cookie header (or undefined). */
export function getCookie(res: request.Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${name}=`));
}
