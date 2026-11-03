import { readFile } from 'node:fs/promises';
import type { Prisma, PrismaClient } from '@whc/db';
import type { Redis } from 'ioredis';
import { request, type APIRequestContext, type Browser, type BrowserContext } from 'playwright';
import { launchScanBrowser, newScanContext, SCANNER_UA_SUFFIX } from '../browser';
import { BLOCKED_RESPONSE_HEADER, SCAN_VIEWPORTS, type ViewportSpec } from '../browser-types';
import { runDomChecksInPage } from '../checks/dom';
import type { ScannerConfig } from '../config';
import { duplicateSeoDrafts, pageSeoDrafts, siteSeoDrafts, type SeoPageInput } from '../audits/seo';
import {
  computeSecurityScore,
  cookieSecurityDrafts,
  headerSecurityDrafts,
  mixedContentDrafts,
  transportSecurityDrafts,
  type SecurityPageInput,
} from '../audits/security';
import {
  freePort,
  isTransientLighthouseError,
  performanceDrafts,
  runLighthouse,
} from '../audits/lighthouse';
import { captureVisual, compareImages, parseIgnoreSettings } from '../audits/visual';
import { collectSiteSecurityFacts, collectSiteSeoFacts, fetchSiteFile } from '../audits/site-files';
import { checkLink, probeUrl } from '../audits/resource-check';
import { crawlSite } from '../crawler/crawl';
import { ALLOW_ALL, parseRobotsTxt, type RobotsRules } from '../crawler/robots';
import { compilePatterns, isSameSite, normalizeUrl } from '../crawler/urls';
import { computeScore, trackIssues } from '../finalize';
import { notifyScanFinished, type EmailJobQueue } from '../notifications';
import { domToDrafts, uiDraft, type IssueDraft } from '../issues';
import type { Logger } from '../logger';
import { saveIssues, saveScreenshot } from '../persistence';
import { createProgressReporter, type ProgressReporter } from '../progress';
import { captureHighlightedIssue, captureViewport } from '../screenshots';
import { resolveKey, type FileStorage } from '../storage';
import { runExploration } from '../explore/run-exploration';
import { scanPage } from './scan-page';

export interface ScanDeps {
  prisma: PrismaClient;
  storage: FileStorage;
  config: ScannerConfig;
  logger: Logger;
  publisher: Redis;
  domBundle: string;
  /** Where e-mail jobs for notifications go (null = in-app notifications only). */
  emailQueue?: EmailJobQueue | null;
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
  let lighthouseBrowser: Browser | null = null;
  let api: APIRequestContext | null = null;
  // Cancelling closes the browser at once, which aborts any page load in progress.
  const onAbort = () => {
    void browser?.close().catch(() => {});
    void lighthouseBrowser?.close().catch(() => {});
  };
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
    // Recorded for bug reports ("Browser: Chromium 140.0...").
    await prisma.scan.update({
      where: { id: scanId },
      data: { browserVersion: `Chromium ${browser.version()}` },
    });
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
    // Always read for the SEO audit; its rules only limit crawling when the website says so.
    const robotsFile = await fetchSiteFile(api, new URL('/robots.txt', startUrl).toString(), log);
    let robots: RobotsRules = ALLOW_ALL;
    if (website.respectRobotsTxt && mode === 'CRAWL' && robotsFile.text) {
      robots = parseRobotsTxt(robotsFile.text);
    }
    const seoPages: SeoPageInput[] = [];
    const securityPages: SecurityPageInput[] = [];
    const include = compilePatterns(website.includePatterns);
    const exclude = compilePatterns(website.excludePatterns);

    // ---------------------------------------------------------- crawl (BFS)
    // The crawler keeps the queue and known addresses; each page is scanned here.
    const linkRefs = new Map<string, LinkRef[]>();
    const cropBudget = { remaining: config.maxIssueScreenshots };

    await crawlSite({
      startUrl,
      siteHostname,
      maxPages,
      maxDepth,
      include,
      exclude,
      robots,
      checkpoint,
      shouldStop: () => timeLimitReached,
      afterVisit: async (crawl) => {
        await progress.update({
          pagesScanned: pages.filter((p) => p.status !== 'FAILED').length,
          pagesFailed: pages.filter((p) => p.status === 'FAILED').length,
          pagesDiscovered: Math.min(crawl.discovered, maxPages),
          progress: (pages.length / Math.max(1, Math.min(maxPages, crawl.discovered))) * 60,
          issuesFound,
        });
      },
      visit: async (target, crawl) => {
        await progress.update({
          step: `Scanning page ${pages.length + 1} of up to ${Math.min(maxPages, crawl.discovered)}`,
          currentUrl: target.url,
          pagesDiscovered: crawl.discovered,
          progress: (pages.length / Math.max(1, Math.min(maxPages, crawl.discovered))) * 60,
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
            // Same proxy-only client as the link checks: the egress policy applies to re-checks too.
            probe: (resourceUrl) => probeUrl(api!, resourceUrl, 'GET', 8_000),
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
            consoleErrors: result.network.consoleErrors as unknown as object[],
            failedRequests: result.network.failedRequests as unknown as object[],
            pageErrors: result.network.pageErrors as unknown as object[],
            seoData: result.meta ? (result.meta.seo as unknown as object) : undefined,
            errorMessage: result.errorMessage,
          },
        });
        if (result.outcome === 'DONE' && result.meta) {
          seoPages.push({
            scanPageId: scanPageRow.id,
            url: result.finalUrl,
            title: result.meta.title,
            metaDescription: result.meta.metaDescription,
            canonical: result.meta.canonical,
            h1Count: result.meta.h1Count,
            xRobotsTag: result.responseHeaders?.['x-robots-tag'] ?? null,
            seo: result.meta.seo,
          });
          securityPages.push({
            scanPageId: scanPageRow.id,
            url: result.finalUrl,
            headers: result.responseHeaders ?? {},
            cookies: result.cookies,
            insecureReferences: result.insecureReferences,
          });
        }
        pages.push({
          id: scanPageRow.id,
          url: result.finalUrl,
          normalizedUrl: target.url,
          status: result.outcome,
          httpStatus: result.httpStatus,
        });
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

        // Remember where each link appears (for broken-link issues); the crawler queues them.
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
          }
        }
        return {
          finalUrl: result.finalUrl,
          links: result.outcome === 'DONE' ? result.links.map((link) => link.href) : null,
        };
      },
    });

    const scannedPages = pages.filter((p) => p.status === 'DONE');

    // ------------------------------------------------------- safe explorer
    // Opens menus, tabs and expandable sections on the first pages (Phase 9). Its own
    // browser context, with writes, navigation, pop-ups, downloads and WebSockets blocked.
    let exploredPages = new Set<string>();
    const explorationPages = website.explorationEnabled
      ? Math.min(website.explorationPageLimit, config.maxExplorationPages)
      : 0;
    if (scannedPages.length > 0 && explorationPages > 0 && !timeLimitReached) {
      const targets = scannedPages.slice(0, explorationPages);
      exploredPages = await runExploration({
        browser,
        deps,
        scanId,
        websiteId: website.id,
        siteHostname,
        viewport: desktop,
        targets,
        controlLimit: Math.min(website.explorationControlLimit, config.maxExplorationControls),
        cropBudget,
        storeIssues,
        onPage: (index, url) =>
          progress.update({
            step: `Exploring menus, tabs and expandable sections (page ${index + 1} of ${targets.length})`,
            currentUrl: url,
            issuesFound,
          }),
        checkpoint,
        shouldStop: () => timeLimitReached,
        log,
      });
    }

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

    // ------------------------------------------------ visual regression
    // Stable PNG snapshots (desktop + mobile) of the first pages and of every page
    // that has a baseline. Baselines only change by explicit user action (API), never here.
    const baselines = await prisma.visualBaseline.findMany({
      where: { websiteId: website.id },
      include: { screenshot: { select: { storageKey: true } } },
    });
    const visualTargets = scannedPages.filter(
      (p, index) =>
        index < config.visualPages || baselines.some((b) => b.pageUrl === p.normalizedUrl),
    );
    if (visualTargets.length > 0 && !timeLimitReached) {
      await progress.update({
        step: 'Capturing visual snapshots',
        currentUrl: null,
        progress: 79,
        issuesFound,
      });
      for (const viewport of VISUAL_VIEWPORTS) {
        checkpoint();
        const visualContext = await newScanContext(browser, viewport);
        try {
          for (const target of visualTargets) {
            checkpoint();
            if (timeLimitReached) break;
            await captureAndCompare({
              context: visualContext,
              target,
              viewport,
              baseline: baselines.find(
                (b) => b.pageUrl === target.normalizedUrl && b.viewport === viewport.label,
              ),
              scanId,
              deps,
              log,
            });
          }
        } finally {
          await visualContext.close().catch(() => {});
        }
      }
    }

    // -------------------------------------------------------- broken links
    checkpoint();
    let linkSummary: LinkCheckSummary | null = null;
    if (scannedPages.length > 0 && !timeLimitReached) {
      await progress.update({
        step: 'Checking links',
        currentUrl: null,
        progress: 80,
        issuesFound,
      });
      linkSummary = await checkLinks({
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

    // ---------------------------------------------------------- Lighthouse
    const lighthousePages = config.lighthouseEnabled
      ? scannedPages.slice(0, Math.min(website.lighthousePageLimit, config.maxLighthousePages))
      : [];
    if (lighthousePages.length > 0 && !timeLimitReached) {
      // A separate Chromium (same proxy and lockdown flags) that Lighthouse controls
      // through a local DevTools port. One page at a time: parallel runs skew timings.
      const port = await freePort();
      lighthouseBrowser = await launchScanBrowser(config, {
        extraArgs: [`--remote-debugging-port=${port}`],
      });
      try {
        for (const [index, target] of lighthousePages.entries()) {
          checkpoint();
          if (timeLimitReached) break;
          await progress.update({
            step: `Measuring performance (Lighthouse) ${index + 1} of ${lighthousePages.length}`,
            currentUrl: target.url,
            progress: 82 + (index / lighthousePages.length) * 4,
            issuesFound,
          });
          let { result, rawJson } = await runLighthouse(target.url, port, {
            timeoutMs: config.lighthouseTimeoutMs,
          });
          // A dropped connection (common on busy public sites) gets one more try.
          if (isTransientLighthouseError(result.error)) {
            log.info(
              { url: target.url, error: result.error },
              'Lighthouse network error, retrying once',
            );
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            checkpoint();
            ({ result, rawJson } = await runLighthouse(target.url, port, {
              timeoutMs: config.lighthouseTimeoutMs,
            }));
          }
          checkpoint();
          let rawReportKey: string | null = null;
          if (rawJson) {
            rawReportKey = `scans/${scanId}/lighthouse/${target.id}-mobile.json`;
            await deps.storage.put(rawReportKey, Buffer.from(rawJson));
          }
          if (!result.ok) log.warn({ url: target.url, error: result.error }, 'Lighthouse failed');
          await prisma.performanceResult.create({
            data: {
              scanId,
              scanPageId: target.id,
              formFactor: 'MOBILE',
              performanceScore: result.scores.performance,
              accessibilityScore: result.scores.accessibility,
              bestPracticesScore: result.scores.bestPractices,
              seoScore: result.scores.seo,
              fcpMs: result.metrics.fcpMs,
              lcpMs: result.metrics.lcpMs,
              cls: result.metrics.cls,
              inpMs: null,
              tbtMs: result.metrics.tbtMs,
              speedIndexMs: result.metrics.speedIndexMs,
              opportunities: result.opportunities as unknown as object[],
              diagnostics: { ...result.diagnostics, error: result.error } as unknown as object,
              lighthouseVersion: result.lighthouseVersion,
              rawReportKey,
            },
          });
          await storeIssues(target.id, performanceDrafts(website.id, target.url, result));
        }
      } finally {
        await lighthouseBrowser.close().catch(() => {});
        lighthouseBrowser = null;
      }
    }

    // ----------------------------------------------------------------- SEO
    // Runs on facts already collected; only robots.txt and the sitemap are fetched.
    const siteChecks: Record<string, unknown> = {};
    if (linkSummary) siteChecks.links = linkSummary;
    if (scannedPages.length > 0) {
      await progress.update({ step: 'Checking SEO', currentUrl: null, progress: 86, issuesFound });
      const duplicates = duplicateSeoDrafts(website.id, seoPages);
      for (const page of seoPages) {
        await storeIssues(page.scanPageId, [
          ...pageSeoDrafts(website.id, page, siteHostname),
          ...(duplicates.get(page.scanPageId) ?? []),
        ]);
      }
      const seoFacts = await collectSiteSeoFacts(api, startUrl, robotsFile, log);
      siteChecks.seo = seoFacts;
      await storeIssues(null, siteSeoDrafts(website.id, startUrl, seoFacts));
      checkpoint();

      // ------------------------------------------------------------ security
      // Passive only: headers and cookie flags we already received, the page's own
      // HTML, one TLS handshake and one http:// request, both through the egress proxy.
      await progress.update({ step: 'Checking security configuration', progress: 89, issuesFound });
      const securityFacts = await collectSiteSecurityFacts({
        api,
        proxyUrl: config.egressProxyUrl,
        firstPageUrl: securityPages[0]?.url ?? startUrl,
        log,
      });
      siteChecks.security = securityFacts;
      const securityDrafts = [
        ...transportSecurityDrafts(website.id, startUrl, securityFacts),
        ...headerSecurityDrafts(website.id, startUrl, securityPages, securityFacts.servedOverHttps),
        ...cookieSecurityDrafts(website.id, startUrl, securityPages, securityFacts.servedOverHttps),
        ...mixedContentDrafts(website.id, securityPages),
      ];
      for (const { scanPageId, draft } of securityDrafts) await storeIssues(scanPageId, [draft]);
      checkpoint();
    }
    await prisma.scan.update({
      where: { id: scanId },
      data: { siteChecks: siteChecks as object },
    });

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

    let tracking: Awaited<ReturnType<typeof trackIssues>> | null = null;
    if (outcome !== 'FAILED') {
      tracking = await trackIssues(
        prisma,
        { id: scanId, websiteId: website.id },
        {
          pages: new Set(
            scannedPages.flatMap((p) => [p.normalizedUrl, normalizeUrl(p.url) ?? p.normalizedUrl]),
          ),
          responsivePages: responsiveChecked,
          exploredPages,
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
    // After finishScan, so previousScanId and the counts are final.
    await notifyScanFinished(
      { prisma, emailQueue: deps.emailQueue ?? null, logger: log },
      {
        scanId,
        status: outcome,
        regressions: tracking
          ? { newIssues: tracking.newCount, reopenedIssues: tracking.reopenedCount }
          : null,
      },
    ).catch((err: unknown) => log.warn({ err }, 'could not create notifications'));
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
    await lighthouseBrowser?.close().catch(() => {});
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
      security: { select: { checkType: true } },
      details: true,
    },
  });
  const count = (severity: string) => issues.filter((i) => i.severity === severity).length;
  // Problems found only inside opened menus/panels (Phase 9 explorer) are reported but do
  // not change the accessibility score, so scores stay comparable with earlier scans.
  const a11y = issues.filter(
    (i) =>
      i.category === 'ACCESSIBILITY' &&
      i.accessibility?.detection !== 'NEEDS_REVIEW' &&
      !(i.details as { interactionState?: unknown } | null)?.interactionState,
  );
  const ui = issues.filter((i) => i.category === 'UI_HEALTH' || i.category === 'RESPONSIVE');
  const seo = issues.filter((i) => i.category === 'SEO');
  const security = issues.filter((i) => i.security).map((i) => i.security!);
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
  // Lighthouse performance: average over pages where it produced a score.
  const perf = await prisma.performanceResult.aggregate({
    where: { scanId, performanceScore: { not: null } },
    _avg: { performanceScore: true },
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
      seoScore: status === 'CANCELLED' ? null : computeScore(seo, scannedPageCount),
      performanceScore:
        status === 'CANCELLED' || perf._avg.performanceScore === null
          ? null
          : Math.round(perf._avg.performanceScore),
      // Null when the audit did not run (no page could be scanned), never a made-up 100.
      securityScore:
        status === 'CANCELLED' || scannedPageCount === 0 ? null : computeSecurityScore(security),
      previousScanId: previous?.id ?? null,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
  });
}

const VISUAL_VIEWPORTS = SCAN_VIEWPORTS.filter(
  (v) => v.label === '1920x1080' || v.label === '390x844',
);

/** Takes one visual snapshot and, when a baseline exists, compares and stores the result. */
async function captureAndCompare(args: {
  context: BrowserContext;
  target: ScannedPage;
  viewport: ViewportSpec;
  baseline:
    | {
        id: string;
        failPercent: number;
        ignoreRegions: unknown;
        screenshot: { storageKey: string };
      }
    | undefined;
  scanId: string;
  deps: ScanDeps;
  log: Logger;
}): Promise<void> {
  const { context, target, viewport, baseline, scanId, deps, log } = args;
  const page = await context.newPage();
  try {
    await page.goto(target.url, { waitUntil: 'load', timeout: deps.config.navTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    const ignore = parseIgnoreSettings(baseline?.ignoreRegions);
    const capture = await captureVisual(page, ignore.selectors);
    const currentId = await saveScreenshot(deps.prisma, deps.storage, {
      scanId,
      scanPageId: target.id,
      kind: 'VISUAL_CURRENT',
      viewport: viewport.label,
      key: `scans/${scanId}/visual/${target.id}-${viewport.label}.png`,
      buffer: capture.buffer,
      width: capture.width,
      height: capture.height,
    });
    if (!baseline) return;

    const baselinePng = await readFile(
      resolveKey(deps.storage.root, baseline.screenshot.storageKey),
    );
    const result = compareImages(baselinePng, capture.buffer, {
      failPercent: baseline.failPercent,
      ignoreRegions: [...ignore.rects, ...capture.ignoredRegions],
    });
    const diffId = await saveScreenshot(deps.prisma, deps.storage, {
      scanId,
      scanPageId: target.id,
      kind: 'VISUAL_DIFF',
      viewport: viewport.label,
      key: `scans/${scanId}/visual/${target.id}-${viewport.label}-diff.png`,
      buffer: result.diffPng,
      width: Math.max(result.size.baseline.width, result.size.current.width),
      height: Math.max(result.size.baseline.height, result.size.current.height),
    });
    await deps.prisma.visualComparison.create({
      data: {
        baselineId: baseline.id,
        scanId,
        currentScreenshotId: currentId,
        diffScreenshotId: diffId,
        diffPixels: result.diffPixels,
        totalPixels: result.totalPixels,
        diffPercent: result.diffPercent,
        passed: result.passed,
        status: result.status,
        details: {
          rawDiffPixels: result.rawDiffPixels,
          regions: result.regions,
          size: result.size,
          failPercent: baseline.failPercent,
          truncated: capture.truncated,
          ignoredRegions: ignore.rects.length + capture.ignoredRegions.length,
          ignoredSelectors: ignore.selectors,
        } as unknown as Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    // A failed snapshot must not fail the scan; it is simply missing from the report.
    log.warn(
      { url: target.url, viewport: viewport.label, err: (error as Error).message },
      'visual snapshot failed',
    );
  } finally {
    await page.close().catch(() => {});
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

export interface LinkCheckSummary {
  checked: number;
  confirmedBroken: number;
  /** Not reported as issues: could not be verified (timeouts, refused connections...). */
  inconclusive: { href: string; reason: string; status: number | null }[];
  /** Not checked: private/internal addresses refused by the egress policy. */
  blockedByPolicy: { href: string; reason: string }[];
}

/**
 * Finds broken links: internal pages we visited + a capped number of checks
 * (HEAD, then GET to confirm). Only CONFIRMED broken links become issues; the
 * rest are returned so the report can list them.
 */
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
}): Promise<LinkCheckSummary> {
  const { linkRefs, pages, deps } = args;
  const visitedStatus = new Map(pages.map((p) => [p.normalizedUrl, p]));
  const toProbe: string[] = [];
  const results = new Map<string, Awaited<ReturnType<typeof checkLink>>>();

  for (const href of linkRefs.keys()) {
    const visited = visitedStatus.get(href);
    if (visited) {
      // The browser loaded it as a page: a 404/410 is the site's own answer.
      if (visited.httpStatus === 404 || visited.httpStatus === 410) {
        results.set(href, {
          verdict: 'CONFIRMED',
          reason: `The page does not exist (HTTP ${visited.httpStatus}).`,
          status: visited.httpStatus,
        });
        continue;
      }
      // A server error may be temporary: re-checked below like any other link.
      if (!(visited.httpStatus && visited.httpStatus >= 500)) continue; // FAILED pages are on the Pages list
    }
    if (toProbe.length < deps.config.maxLinkChecks) toProbe.push(href);
  }

  // Check a few links at a time (polite to servers, bounded run time).
  for (let i = 0; i < toProbe.length; i += 4) {
    args.checkpoint();
    const batch = toProbe.slice(i, i + 4);
    const outcomes = await Promise.all(batch.map((href) => checkLink(args.api, href)));
    batch.forEach((href, index) => results.set(href, outcomes[index]!));
  }

  const summary: LinkCheckSummary = {
    checked: results.size,
    confirmedBroken: 0,
    inconclusive: [],
    blockedByPolicy: [],
  };
  for (const [href, result] of results) {
    if (result.verdict === 'OK') continue;
    if (result.verdict === 'BLOCKED_BY_POLICY') {
      args.log.info({ href }, 'link points to a private/internal address; not checked');
      if (summary.blockedByPolicy.length < 50)
        summary.blockedByPolicy.push({ href, reason: result.reason });
      continue;
    }
    if (result.verdict === 'INCONCLUSIVE') {
      if (summary.inconclusive.length < 50) {
        summary.inconclusive.push({ href, reason: result.reason, status: result.status });
      }
      continue;
    }
    summary.confirmedBroken += 1;
    const internal = isSameSite(href, args.siteHostname);
    const serverError = result.status !== null && result.status >= 500;
    for (const ref of linkRefs.get(href) ?? []) {
      const description = `This link points to ${href}. ${result.reason}`;
      await args.storeIssues(ref.scanPageId, [
        uiDraft(
          'BROKEN_LINK',
          { websiteId: args.websiteId, pageUrl: ref.pageUrl, viewport: SCAN_VIEWPORTS[0]!.label },
          'UI_HEALTH',
          {
            severity: serverError ? 'LOW' : internal ? 'HIGH' : 'MEDIUM',
            description,
            selector: ref.selector,
            html: ref.html,
            resourceUrl: href,
            statusCode: result.status,
            measurements: { href, internal, verdict: result.verdict, verdictReason: result.reason },
            target: href,
          },
        ),
      ]);
    }
  }
  return summary;
}

export type { ProgressReporter };
