import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadReportData, type PrismaClient } from '@whc/db';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { chromium, type Browser } from 'playwright';
import type { ScannerConfig } from '../config';
import type { Logger } from '../logger';
import { resolveKey, type FileStorage } from '../storage';
import { buildReportHtml, type EmbeddedImages } from './report-html';

/** Must match EXPORT_QUEUE_NAME in apps/api/src/lib/pdf-renderer.ts. */
export const EXPORT_QUEUE_NAME = 'exports';

export interface PdfJobData {
  scanId: string;
  category?: 'ACCESSIBILITY' | 'UI_HEALTH' | 'RESPONSIVE';
}

/** Issues loaded into a PDF, and how many of them get an embedded screenshot. */
const MAX_PDF_ISSUES = 500;
const MAX_EMBEDDED_IMAGES = 15;
/** The API downloads a PDF within seconds; anything older is left over and removed. */
const EXPORT_MAX_AGE_MS = 10 * 60_000;

/** HTML → PDF with a locked-down browser: no JavaScript, no network at all. */
export async function renderPdf(browser: Browser, html: string): Promise<Buffer> {
  const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: false });
  try {
    // Only inline data: URLs may load; anything else (a URL hidden in scanned HTML) is aborted.
    await context.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await context.close();
  }
}

/** Deletes PDF files older than EXPORT_MAX_AGE_MS (the API can only read storage). */
export async function removeOldExports(storage: FileStorage, now = Date.now()): Promise<number> {
  const root = path.join(storage.root, 'exports');
  let removed = 0;
  const scanDirs = await readdir(root).catch(() => [] as string[]);
  for (const dir of scanDirs) {
    const full = path.join(root, dir);
    for (const file of await readdir(full).catch(() => [] as string[])) {
      const info = await stat(path.join(full, file)).catch(() => null);
      if (info && now - info.mtimeMs > EXPORT_MAX_AGE_MS) {
        await rm(path.join(full, file), { force: true });
        removed += 1;
      }
    }
    if ((await readdir(full).catch(() => ['?'])).length === 0)
      await rm(full, { recursive: true, force: true });
  }
  return removed;
}

/** Reads the element screenshots of the worst issues so they can be embedded. */
async function loadImages(
  storage: FileStorage,
  issues: Awaited<ReturnType<typeof loadReportData>>['issues'],
  logger: Logger,
): Promise<EmbeddedImages> {
  const images: EmbeddedImages = new Map();
  for (const issue of issues) {
    if (images.size >= MAX_EMBEDDED_IMAGES) break;
    if (!issue.screenshot) continue;
    try {
      const data = await readFile(resolveKey(storage.root, issue.screenshot.storageKey));
      images.set(issue.id, { mimeType: issue.screenshot.mimeType, data });
    } catch (err) {
      // A missing file must not break the whole report; the issue is printed without it.
      logger.warn({ err, issueId: issue.id }, 'screenshot missing for PDF export');
    }
  }
  return images;
}

/**
 * Worker for the "exports" queue. The API adds a job, this worker writes the PDF
 * to shared storage and returns its key; the API reads it, sends it, and deletes it.
 */
export function createPdfExportWorker(deps: {
  config: ScannerConfig;
  prisma: PrismaClient;
  storage: FileStorage;
  logger: Logger;
  queuePrefix?: string;
}) {
  const { config, prisma, storage, logger } = deps;
  let browserPromise: Promise<Browser> | null = null;

  // One browser is reused for every PDF; relaunched if it crashed.
  async function getBrowser(): Promise<Browser> {
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      if (browser?.isConnected()) return browser;
    }
    browserPromise = chromium.launch({
      headless: config.headless,
      channel: config.browserChannel,
      timeout: 60_000,
      args: ['--disable-background-networking', '--no-first-run'],
    });
    return browserPromise;
  }

  async function process(job: Job<PdfJobData>): Promise<{ key: string }> {
    const { scanId, category } = job.data;
    const exists = await prisma.scan.findUnique({ where: { id: scanId }, select: { id: true } });
    if (!exists) throw new UnrecoverableError('Scan not found');

    const data = await loadReportData(prisma, scanId, { category, maxIssues: MAX_PDF_ISSUES });
    const images = await loadImages(storage, data.issues, logger);
    const pdf = await renderPdf(await getBrowser(), buildReportHtml(data, images));
    await removeOldExports(storage).catch((err: unknown) =>
      logger.warn({ err }, 'could not clean up old PDF exports'),
    );
    const key = `exports/${scanId}/${job.id ?? Date.now()}.pdf`;
    await storage.put(key, pdf);
    logger.info({ scanId, category, bytes: pdf.length }, 'PDF export rendered');
    return { key };
  }

  const worker = new Worker<PdfJobData, { key: string }>(EXPORT_QUEUE_NAME, process, {
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    prefix: deps.queuePrefix ?? 'whc',
    concurrency: 2,
  });
  worker.on('failed', (job, error) =>
    logger.warn({ scanId: job?.data.scanId, err: error.message }, 'PDF export failed'),
  );
  worker.on('error', (error) => logger.error({ err: error }, 'export worker error'));

  // Also clean up when nobody exports anything for a while.
  const cleanup = setInterval(() => {
    removeOldExports(storage)
      .then((removed) => removed && logger.info({ removed }, 'old PDF exports removed'))
      .catch((err: unknown) => logger.warn({ err }, 'could not clean up old PDF exports'));
  }, 5 * 60_000);
  cleanup.unref();

  return {
    worker,
    async close(): Promise<void> {
      clearInterval(cleanup);
      await worker.close();
      const browser = await browserPromise?.catch(() => null);
      await browser
        ?.close()
        .catch((err: unknown) => logger.warn({ err }, 'closing PDF browser failed'));
    },
  };
}
