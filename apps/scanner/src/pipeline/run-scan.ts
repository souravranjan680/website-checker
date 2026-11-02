import type { PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { request, type APIRequestContext, type Browser, type BrowserContext } from 'playwright';
import { launchScanBrowser, newScanContext, SCANNER_UA_SUFFIX } from '../browser';
import { BLOCKED_RESPONSE_HEADER, SCAN_VIEWPORTS, type ViewportSpec } from '../browser-types';
import { runDomChecksInPage } from '../checks/dom';
import type { ScannerConfig } from '../config';
import { ALLOW_ALL, parseRobotsTxt, type RobotsRules } from '../crawler/robots';
import {
  compilePatterns,
  isSameSite,
  looksLikeHtml,
  normalizeUrl,
  pathAllowed,
  pathOf,
} from '../crawler/urls';
import { computeScore, trackIssues } from '../finalize';
import { domToDrafts, uiDraft, type IssueDraft } from '../issues';
import type { Logger } from '../logger';
import { saveIssues, saveScreenshot } from '../persistence';
import { createProgressReporter, type ProgressReporter } from '../progress';
import { captureHighlightedIssue, captureViewport } from '../screenshots';
import type { FileStorage } from '../storage';
import { scanPage } from './scan-page';

export interface ScanDeps {
  prisma: PrismaClient;
  storage: FileStorage;
  config: ScannerConfig;
  logger: Logger;
  publisher: Redis;
  domBundle: string;
}

export type ScanOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

/** Thrown inside the pipeline when the user cancelled; caught by runScan. */
class ScanCancelled extends Error {}

interface ScannedPage {
  id: string;
  url: string; // final URL after redirects
  normalizedUrl: string;
  status: 'DONE' | 'FAILED' | 'SKIPPED';
  httpStatus: number | null;
}

interface LinkRef {
  scanPageId: string;
  pageUrl: string;
  selector: string;
  html: string;
}

/**
 * Runs one complete scan. Returns the final status; throws only for
 * infrastructure problems worth retrying (browser could not start, database down).
 */
export async function runScan(
  scanId: string,
  deps: ScanDeps,
  options: { signal: AbortSignal },
): Promise<ScanOutcome> {
  const { prisma, config, logger } = deps;
  const log = logger.child({ scanId });

  const scan = await prisma.scan.findUnique({ where: { id: scanId }, include: { website: true } });
  if (!scan) throw new Error(`Scan ${scanId} not found`);
  const website = scan.website;
  const startUrl = normalizeUrl(website.baseUrl);
  if (!startUrl) throw new Error('Website URL is invalid');
  const siteHostname = new URL(startUrl).hostname;

  const startedAt = scan.startedAt ?? new Date();
  // Conditional update: if a user cancelled at this exact moment, don't overwrite it.
  const claimed = await prisma.scan.updateMany({
    where: { id: scanId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: {
      status: 'RUNNING',
      startedAt,
      errorMessage: null,
      progress: 0,
      currentStep: 'Starting browser',
    },
  });
  if (claimed.count === 0) {
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'CANCELLED', finishedAt: new Date(), currentStep: 'Cancelled' },
    });
    return 'CANCELLED';
  }

  const progress = createProgressReporter({
    prisma,
    publisher: deps.publisher,
    scanId,
    logger: log,
  });
  const mode = scan.mode === 'SINGLE_PAGE' ? 'SINGLE_PAGE' : 'CRAWL';
  const maxPages = mode === 'SINGLE_PAGE' ? 1 : Math.min(website.maxPages, config.maxPages);
  const maxDepth = mode === 'SINGLE_PAGE' ? 0 : website.maxDepth;

  let timeLimitReached = false;
  const timeLimit = setTimeout(() => {
    timeLimitReached = true;
    log.warn('scan time limit reached; finishing with the pages scanned so far');
  }, config.maxDurationMs);

  let browser: Browser | null = null;
  let api: APIRequestContext | null = null;
  // Cancelling closes the browser at once, which aborts any page load in progress.
  const onAbort = () => void browser?.close().catch(() => {});
  options.signal.addEventListener('abort', onAbort);
  const checkpoint = () => {
    if (options.signal.aborted) throw new ScanCancelled();
  };

  const pages: ScannedPage[] = [];
  const fingerprints = new Set<string>();
  const responsiveChecked = new Set<string>();
  let issuesFound = 0;

  /** Saves new issues (skipping any fingerprint already saved in this scan). */
  async function storeIssues(scanPageId: string | null, drafts: IssueDraft[]): Promise<void> {
    const fresh = drafts.filter((d) => !fingerprints.has(d.fingerprint));
    fresh.forEach((d) => fingerprints.add(d.fingerprint));
    await saveIssues(prisma, scanId, scanPageId, fresh);
    issuesFound += fresh.length;
  }

  try {
    browser = await launchScanBrowser(config); // may throw → retried by BullMQ
    checkpoint();
    const desktop = SCAN_VIEWPORTS[0]!;
    const context = await newScanContext(browser, desktop);
    // A separate HTTP client for robots.txt and link checks: explicitly via the egress proxy.
    api = await request.newContext({
      proxy: { server: config.egressProxyUrl },
      userAgent: `Mozilla/5.0 ${SCANNER_UA_SUFFIX}`,
      timeout: 10_000,
      ignoreHTTPSErrors: false,
    });

    // ------------------------------------------------------------ robots.txt
    let robots: RobotsRules = ALLOW_ALL;
    if (website.respectRobotsTxt && mode === 'CRAWL') {
      robots = await loadRobots(api, startUrl, log);
    }
    const include = compilePatterns(website.includePatterns);
    const exclude = compilePatterns(website.excludePatterns);

    // ---------------------------------------------------------- crawl (BFS)
    const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
    const visited = new Set<string>([startUrl]);
    const linkRefs = new Map<string, LinkRef[]>();
    const cropBudget = { remaining: config.maxIssueScreenshots };

    while (queue.length > 0 && pages.length < maxPages && !timeLimitReached) {
      checkpoint();
      const target = queue.shift()!;
      await progress.update({
        step: `Scanning page ${pages.length + 1} of up to ${Math.min(maxPages, visited.size)}`,
        currentUrl: target.url,
        pagesDiscovered: visited.size,
        progress: (pages.length / Math.max(1, Math.min(maxPages, visited.size))) * 60,
        issuesFound,
      });

      const page = await context.newPage();
      let result;
      try {
        result = await scanPage({
          page,
          url: target.url,
          viewport: desktop,
          websiteId: website.id,
          siteHostname,
          navTimeoutMs: config.navTimeoutMs,
          domBundle: deps.domBundle,
          cropBudget,
          alreadyScanned: (u) =>
            pages.some((p) => p.status === 'DONE' && normalizeUrl(p.url) === u),
          logger: log,
        });
      } finally {
        await page.close().catch(() => {});
      }
      checkpoint();

      const scanPageRow = await prisma.scanPage.create({
        data: {
          scanId,
          url: result.finalUrl,
          normalizedUrl: target.url,
          depth: target.depth,
          status: result.outcome,
          httpStatus: result.httpStatus,
          contentType: result.contentType,
          title: result.meta?.title || null,
          metaDescription: result.meta?.metaDescription ?? null,
          canonicalUrl: result.meta?.canonical ?? null,
          language: result.meta?.lang ?? null,
          h1Count: result.meta?.h1Count ?? null,
          loadTimeMs: result.loadTimeMs,
          responseHeaders: result.responseHeaders ?? undefined,
          consoleErrors: result.network.consoleErrors,
          failedRequests: result.network.failedRequests as unknown as object[],
          pageErrors: result.network.pageErrors,
          errorMessage: result.errorMessage,
        },
      });
      pages.push({
        id: scanPageRow.id,
        url: result.finalUrl,
        normalizedUrl: target.url,
        status: result.outcome,
        httpStatus: result.httpStatus,
      });
      const finalNormalized = normalizeUrl(result.finalUrl);
      if (finalNormalized) visited.add(finalNormalized);

      if (result.fullPage) {
        await saveScreenshot(prisma, deps.storage, {
          scanId,
          scanPageId: scanPageRow.id,
          kind: 'PAGE_FULL',
          viewport: desktop.label,
          key: `scans/${scanId}/pages/${scanPageRow.id}-${desktop.label}-full.jpg`,
          ...result.fullPage,
        });
      }
      for (const draft of result.drafts) {
        const crop = result.crops.get(draft.id);
        if (!crop) continue;
        draft.screenshotId = await saveScreenshot(prisma, deps.storage, {
          scanId,
          scanPageId: scanPageRow.id,
          kind: 'ISSUE_CROP',
          viewport: desktop.label,
          key: `scans/${scanId}/issues/${draft.id}.jpg`,
          ...crop,
        });
      }
      await storeIssues(scanPageRow.id, result.drafts);

      // Queue new links from this page (same website, within depth/limits/rules).
      if (result.outcome === 'DONE') {
        for (const link of result.links) {
          const href = normalizeUrl(link.href);
          if (!href) continue;
          const refs = linkRefs.get(href) ?? [];
          if (refs.length < 5) {
            refs.push({
              scanPageId: scanPageRow.id,
              pageUrl: result.finalUrl,
              selector: link.selector,
              html: link.html,
            });
          }
          linkRefs.set(href, refs);

          if (target.depth >= maxDepth || visited.has(href)) continue;
          if (!isSameSite(href, siteHostname) || !looksLikeHtml(href)) continue;
          if (!pathAllowed(href, include, exclude) || !robots.allows(pathOf(href))) continue;
          if (visited.size >= maxPages * 3) continue; // keep the queue bounded
          visited.add(href);
          queue.push({ url: href, depth: target.depth + 1 });
        }
      }

      await progress.update({
        pagesScanned: pages.filter((p) => p.status !== 'FAILED').length,
        pagesFailed: pages.filter((p) => p.status === 'FAILED').length,
        pagesDiscovered: Math.min(visited.size, maxPages),
        progress: (pages.length / Math.max(1, Math.min(maxPages, visited.size))) * 60,
        issuesFound,
      });
    }

    const scannedPages = pages.filter((p) => p.status === 'DONE');

    // ------------------------------------------------- other screen sizes
    if (scannedPages.length > 0 && website.responsivePageLimit > 0 && !timeLimitReached) {
      const targets = scannedPages.slice(0, website.responsivePageLimit);
      const others = SCAN_VIEWPORTS.slice(1);
      let done = 0;
      for (const viewport of others) {
        checkpoint();
        const viewportContext = await newScanContext(browser, viewport);
        try {
          for (const target of targets) {
            checkpoint();
            if (timeLimitReached) break;
            await progress.update({
              step: `Testing ${viewport.name} (${viewport.label})`,
              currentUrl: target.url,
              progress: 60 + (done / (targets.length * others.length)) * 20,
              issuesFound,
            });
            await scanViewport({
              deps,
              scanId,
              websiteId: website.id,
              target,
              viewport,
              context: viewportContext,
              cropBudget,
              storeIssues,
              log,
            });
            responsiveChecked.add(target.normalizedUrl);
            const finalNormalized = normalizeUrl(target.url);
            if (finalNormalized) responsiveChecked.add(finalNormalized);
            done += 1;
          }
        } finally {
          await viewportContext.close().catch(() => {});
        }
      }
    }

    // -------------------------------------------------------- broken links
    checkpoint();
    if (scannedPages.length > 0 && !timeLimitReached) {
      await progress.update({
        step: 'Checking links',
        currentUrl: null,
        progress: 80,
        issuesFound,
      });
      await checkLinks({
        api,
        scanId,
        websiteId: website.id,
        siteHostname,
        linkRefs,
        pages,
        deps,
        storeIssues,
        checkpoint,
        log,
      });
    }
    checkpoint();

    // -------------------------------------------------------------- finalize
    await progress.update(
      { step: 'Saving results', currentUrl: null, progress: 92, issuesFound },
      { force: true },
    );
    const failedPages = pages.filter((p) => p.status === 'FAILED');
    let outcome: ScanOutcome;
    let errorMessage: string | null = null;
    if (scannedPages.length === 0) {
      outcome = 'FAILED';
      const first = await prisma.scanPage.findFirst({
        where: { scanId },
        orderBy: { createdAt: 'asc' },
      });
      errorMessage = first?.errorMessage ?? 'No page could be scanned.';
    } else if (timeLimitReached || failedPages.length > 0) {
      outcome = 'PARTIAL';
      errorMessage = timeLimitReached
        ? 'Stopped at the scan time limit; results cover the pages scanned so far.'
        : `${failedPages.length} page(s) could not be loaded; see the Pages list.`;
    } else {
      outcome = 'COMPLETED';
    }

    if (outcome !== 'FAILED') {
      await trackIssues(
        prisma,
        { id: scanId, websiteId: website.id },
        {
          pages: new Set(
            scannedPages.flatMap((p) => [p.normalizedUrl, normalizeUrl(p.url) ?? p.normalizedUrl]),
          ),
          responsivePages: responsiveChecked,
        },
      );
    }
    await finishScan(
      prisma,
      scanId,
      website.id,
      outcome,
      errorMessage,
      startedAt,
      scannedPages.length,
      pages,
    );
    await progress.update(
      { status: outcome, step: 'Finished', progress: 100, currentUrl: null, issuesFound },
      { force: true },
    );
    await progress.finished(outcome);
    log.info({ outcome, pages: pages.length, issues: issuesFound }, 'scan finished');
    return outcome;
  } catch (error) {
    if (error instanceof ScanCancelled || options.signal.aborted) {
      await finishScan(
        prisma,
        scanId,
        website.id,
        'CANCELLED',
        'Cancelled by a user.',
        startedAt,
        pages.filter((p) => p.status === 'DONE').length,
        pages,
      );
      await progress
        .update(
          { status: 'CANCELLED', step: 'Cancelled', currentUrl: null, issuesFound },
          { force: true },
        )
        .catch(() => {});
      await progress.finished('CANCELLED');
      log.info({ pages: pages.length }, 'scan cancelled');
      return 'CANCELLED';
    }
    throw error;
  } finally {
    clearTimeout(timeLimit);
    options.signal.removeEventListener('abort', onAbort);
    await api?.dispose().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

/** Final counts, scores and timing on the Scan row. */
async function finishScan(
  prisma: PrismaClient,
  scanId: string,
  websiteId: string,
  status: ScanOutcome,
  errorMessage: string | null,
  startedAt: Date,
  scannedPageCount: number,
  pages: ScannedPage[],
): Promise<void> {
  const issues = await prisma.issue.findMany({
    where: { scanId },
    select: {
      severity: true,
      category: true,
      ruleId: true,
      pageUrl: true,
      viewport: true,
      accessibility: { select: { detection: true } },
    },
  });
  const count = (severity: string) => issues.filter((i) => i.severity === severity).length;
  const a11y = issues.filter(
    (i) => i.category === 'ACCESSIBILITY' && i.accessibility?.detection !== 'NEEDS_REVIEW',
  );
  const ui = issues.filter((i) => i.category === 'UI_HEALTH' || i.category === 'RESPONSIVE');
  const previous = await prisma.scan.findFirst({
    where: {
      websiteId,
      id: { not: scanId },
      status: { in: ['COMPLETED', 'PARTIAL'] },
      createdAt: { lt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const finishedAt = new Date();
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status,
      errorMessage,
      progress: status === 'CANCELLED' ? undefined : 100,
      currentStep: status === 'CANCELLED' ? 'Cancelled' : 'Finished',
      pagesScanned: pages.filter((p) => p.status !== 'FAILED').length,
      pagesFailed: pages.filter((p) => p.status === 'FAILED').length,
      totalIssues: issues.length,
      criticalCount: count('CRITICAL'),
      highCount: count('HIGH'),
      mediumCount: count('MEDIUM'),
      lowCount: count('LOW'),
      infoCount: count('INFO'),
      accessibilityScore: status === 'CANCELLED' ? null : computeScore(a11y, scannedPageCount),
      uiHealthScore: status === 'CANCELLED' ? null : computeScore(ui, scannedPageCount),
      previousScanId: previous?.id ?? null,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
  });
}

async function loadRobots(
  api: APIRequestContext,
  startUrl: string,
  log: Logger,
): Promise<RobotsRules> {
  try {
    const response = await api.get(new URL('/robots.txt', startUrl).toString(), {
      maxRedirects: 3,
      timeout: 10_000,
    });
    const text = response.ok() ? await response.text() : '';
    await response.dispose();
    return text ? parseRobotsTxt(text.slice(0, 500_000)) : ALLOW_ALL;
  } catch (error) {
    log.info({ err: (error as Error).message }, 'robots.txt not available; crawling without it');
    return ALLOW_ALL;
  }
}

/** One page at one extra screen size: layout checks + a screenshot. */
async function scanViewport(args: {
  deps: ScanDeps;
  scanId: string;
  websiteId: string;
  target: ScannedPage;
  viewport: ViewportSpec;
  context: BrowserContext;
  cropBudget: { remaining: number };
  storeIssues: (scanPageId: string | null, drafts: IssueDraft[]) => Promise<void>;
  log: Logger;
}): Promise<void> {
  const { deps, target, viewport } = args;
  const page = await args.context.newPage();
  try {
    const response = await page.goto(target.url, {
      waitUntil: 'load',
      timeout: deps.config.navTimeoutMs,
    });
    if (
      !response ||
      response.status() >= 400 ||
      response.headers()[BLOCKED_RESPONSE_HEADER] === '1'
    )
      return;
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
    const dom = await runDomChecksInPage(page, deps.domBundle, { mode: 'layout' });
    const drafts = domToDrafts(
      dom.findings,
      { websiteId: args.websiteId, pageUrl: target.url, viewport: viewport.label },
      'RESPONSIVE',
    );
    const image = await captureViewport(page).catch(() => null);
    if (image) {
      await saveScreenshot(deps.prisma, deps.storage, {
        scanId: args.scanId,
        scanPageId: target.id,
        kind: 'VIEWPORT',
        viewport: viewport.label,
        key: `scans/${args.scanId}/pages/${target.id}-${viewport.label}.jpg`,
        ...image,
      });
    }
    const worst = drafts.find(
      (d) =>
        d.boundingBox && d.severity !== 'INFO' && d.uiHealth?.checkType !== 'HORIZONTAL_SCROLL',
    );
    if (worst && args.cropBudget.remaining > 0) {
      try {
        const crop = await captureHighlightedIssue(
          page,
          worst.boundingBox!,
          `${worst.severity} · ${worst.title}`,
        );
        args.cropBudget.remaining -= 1;
        worst.screenshotId = await saveScreenshot(deps.prisma, deps.storage, {
          scanId: args.scanId,
          scanPageId: target.id,
          kind: 'ISSUE_CROP',
          viewport: viewport.label,
          key: `scans/${args.scanId}/issues/${worst.id}.jpg`,
          ...crop,
        });
      } catch {
        // a missing crop is not worth failing the page for
      }
    }
    await args.storeIssues(target.id, drafts);
  } catch (error) {
    args.log.info(
      { url: target.url, viewport: viewport.label, err: (error as Error).message },
      'viewport check failed',
    );
  } finally {
    await page.close().catch(() => {});
  }
}

type LinkProblem = 'ok' | 'broken' | 'server-error' | 'unreachable' | 'blocked' | 'unknown';

async function probeLink(
  api: APIRequestContext,
  url: string,
): Promise<{ problem: LinkProblem; status: number | null }> {
  try {
    const response = await api.head(url, {
      maxRedirects: 5,
      timeout: 10_000,
      failOnStatusCode: false,
    });
    const status = response.status();
    const blocked = response.headers()[BLOCKED_RESPONSE_HEADER] === '1';
    await response.dispose();
    if (blocked) return { problem: status === 403 ? 'blocked' : 'unreachable', status: null };
    if (status === 404 || status === 410) return { problem: 'broken', status };
    if (status >= 500) return { problem: 'server-error', status };
    // 2xx/3xx, and 401/403/405/429 (servers that reject HEAD or bots) are not reported.
    return { problem: 'ok', status };
  } catch (error) {
    const message = (error as Error).message;
    if (/statusCode=403|status code 403/i.test(message))
      return { problem: 'blocked', status: null };
    if (/statusCode=502|ENOTFOUND|ECONNREFUSED|tunnel/i.test(message))
      return { problem: 'unreachable', status: null };
    return { problem: 'unknown', status: null }; // timeouts etc.: not reported to avoid false positives
  }
}

/** Finds broken links: internal pages we visited + a capped number of HEAD checks. */
async function checkLinks(args: {
  api: APIRequestContext;
  scanId: string;
  websiteId: string;
  siteHostname: string;
  linkRefs: Map<string, LinkRef[]>;
  pages: ScannedPage[];
  deps: ScanDeps;
  storeIssues: (scanPageId: string | null, drafts: IssueDraft[]) => Promise<void>;
  checkpoint: () => void;
  log: Logger;
}): Promise<void> {
  const { linkRefs, pages, deps } = args;
  const visitedStatus = new Map(pages.map((p) => [p.normalizedUrl, p]));
  const toProbe: string[] = [];
  const results = new Map<string, { problem: LinkProblem; status: number | null }>();

  for (const href of linkRefs.keys()) {
    const visited = visitedStatus.get(href);
    if (visited) {
      if (visited.httpStatus === 404 || visited.httpStatus === 410)
        results.set(href, { problem: 'broken', status: visited.httpStatus });
      else if (visited.httpStatus && visited.httpStatus >= 500)
        results.set(href, { problem: 'server-error', status: visited.httpStatus });
      continue; // FAILED (incl. blocked) pages are reported on the Pages list, not as broken links
    }
    if (toProbe.length < deps.config.maxLinkChecks) toProbe.push(href);
  }

  // Check a few links at a time (polite to servers, bounded run time).
  for (let i = 0; i < toProbe.length; i += 4) {
    args.checkpoint();
    const batch = toProbe.slice(i, i + 4);
    const outcomes = await Promise.all(batch.map((href) => probeLink(args.api, href)));
    batch.forEach((href, index) => results.set(href, outcomes[index]!));
  }

  for (const [href, result] of results) {
    if (result.problem === 'ok' || result.problem === 'unknown') continue;
    if (result.problem === 'blocked') {
      args.log.info({ href }, 'link points to a private/internal address; not checked');
      continue;
    }
    const internal = isSameSite(href, args.siteHostname);
    for (const ref of linkRefs.get(href) ?? []) {
      const description =
        result.problem === 'broken'
          ? `This link points to ${href}, which returns HTTP ${result.status} (not found).`
          : result.problem === 'server-error'
            ? `This link points to ${href}, which returns a server error (HTTP ${result.status}).`
            : `This link points to ${href}, which could not be reached (the domain may not exist).`;
      await args.storeIssues(ref.scanPageId, [
        uiDraft(
          'BROKEN_LINK',
          { websiteId: args.websiteId, pageUrl: ref.pageUrl, viewport: SCAN_VIEWPORTS[0]!.label },
          'UI_HEALTH',
          {
            severity: result.problem === 'server-error' ? 'LOW' : internal ? 'HIGH' : 'MEDIUM',
            description,
            selector: ref.selector,
            html: ref.html,
            resourceUrl: href,
            statusCode: result.status,
            measurements: { href, internal, problem: result.problem },
            target: href,
          },
        ),
      ]);
    }
  }
}

export type { ProgressReporter };
