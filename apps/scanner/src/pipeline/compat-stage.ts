/**
 * Cross-browser stage (Phase 9, Milestone 3, Checkpoint 1: foundation). Off unless the
 * website turns it on. After Chromium's own stages, each other engine (Firefox, then
 * WebKit; never at the same time) loads the first pages and records what it saw:
 *   - its own browser process, a new context per page (nothing shared between pages,
 *     engines or scans), and the egress proxy with every exception closed;
 *   - a security self-check before any site is loaded (fails → the engine is not used);
 *   - passive checks only: the same capture as Chromium's crawl (axe, DOM and layout,
 *     font and icon checks, console and failed requests). No clicks, keys or typing;
 *   - its own status (COMPLETED, PARTIAL, FAILED, UNAVAILABLE, TIMED_OUT, SKIPPED,
 *     CANCELLED). Nothing here changes the scan's outcome, issues or scores.
 * Comparing the results with Chromium (and findings) comes in Checkpoint 2.
 */
import type { Prisma } from '@whc/db';
import type { Browser } from 'playwright';
import { egressSelfCheck, launchScanBrowser, newScanContext } from '../browser';
import { SCAN_VIEWPORTS, type ViewportSpec } from '../browser-types';
import { attachCollectors } from '../checks/collectors';
import type { Logger } from '../logger';
import { capturePage, type PageCapture } from './capture-page';
import type { ScanDeps } from './run-scan';

type OtherEngine = 'firefox' | 'webkit';
const ENGINE_NAME: Record<OtherEngine, string> = { firefox: 'Firefox', webkit: 'WebKit' };
const DB_ENGINE = { firefox: 'FIREFOX', webkit: 'WEBKIT' } as const;

/** Checks that run only in Chromium, and why (recorded on every other engine's run). */
export const NOT_IN_OTHER_BROWSERS = [
  { check: 'explorer', reason: 'interactions run in Chromium only' },
  { check: 'keyboard-probe', reason: 'interactions run in Chromium only' },
  { check: 'form-probe', reason: 'interactions run in Chromium only' },
  { check: 'component-consistency', reason: 'a design check, not a browser check' },
  { check: 'lighthouse', reason: 'Chromium only' },
  { check: 'visual-regression', reason: 'baselines are Chromium images' },
] as const;

/** What one engine saw on one page at one size (stored in ScanPage.compatibility). */
export interface BrowserPageSummary {
  viewport: string;
  status: 'DONE' | 'FAILED' | 'SKIPPED';
  error: string | null;
  httpStatus: number | null;
  finalUrl: string | null;
  loadTimeMs: number | null;
  facts: ReturnType<typeof factsOf> | null;
}

/** The facts kept for the comparison (Checkpoint 2): compact, with element snippets for matching. */
export function factsOf(capture: PageCapture) {
  const short = (html: string | null | undefined) => (html ?? '').slice(0, 300);
  return {
    accessibility: (capture.axe?.violations ?? []).slice(0, 100).map((rule) => ({
      rule: rule.id,
      impact: rule.impact ?? null,
      nodes: rule.nodes.slice(0, 10).map((node) => ({
        target: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
        html: short(node.html),
      })),
    })),
    needsReview: capture.axe?.incomplete.length ?? 0,
    ui: (capture.dom?.findings ?? []).slice(0, 100).map((f) => ({
      check: f.check,
      selector: f.selector,
      html: short(f.html),
    })),
    layout: (capture.extra?.findings ?? []).slice(0, 100).map((f) => ({
      check: f.check,
      selector: f.selector,
      html: short(f.html),
    })),
    fonts: (capture.extra?.fonts ?? []).map((f) => ({
      family: f.family,
      weight: f.weight,
      style: f.style,
      status: f.status,
    })),
    console: capture.network.consoleErrors.slice(0, 50).map((c) => ({
      level: c.level,
      text: c.text.slice(0, 300),
      source: c.source ?? null,
    })),
    exceptions: capture.network.pageErrors.slice(0, 50).map((e) => ({
      message: e.message.slice(0, 300),
      source: e.source ?? null,
    })),
    failedRequests: capture.network.failedRequests.slice(0, 50).map((r) => ({
      url: r.url,
      resourceType: r.resourceType,
      status: r.status ?? null,
      error: r.error ?? null,
      blockedByPolicy: r.blockedByPolicy,
    })),
    document: capture.dom
      ? {
          width: capture.dom.snapshot.documentWidth,
          height: capture.dom.snapshot.documentHeight,
          viewportWidth: capture.dom.snapshot.viewportWidth,
        }
      : null,
  };
}

export interface CompatOptions {
  /** For tests: launch a browser for an engine (default: launchScanBrowser). */
  launch?: (engine: OtherEngine) => Promise<Browser>;
  /** For tests: called after each page (e.g. to simulate a crash). */
  afterPage?: (engine: OtherEngine, browser: Browser, pageIndex: number) => Promise<void>;
}

class BudgetExceeded extends Error {}

/** Time a page may take beyond its navigation timeout (checks, fonts, axe). */
const PAGE_EXTRA_MS = 45_000;

/** Runs the stage. Never throws, except to cancel the scan. */
export async function runCompatibility(args: {
  deps: ScanDeps;
  scanId: string;
  website: {
    crossBrowserTargets: ('FIREFOX' | 'WEBKIT' | 'CHROMIUM')[];
    crossBrowserPageLimit: number;
    crossBrowserMobile: boolean;
  };
  siteHostname: string;
  targets: { id: string; url: string }[];
  checkpoint: () => void;
  shouldStop: () => boolean;
  onPage: (engine: string, index: number, total: number, url: string) => Promise<void>;
  /** Called with the browser while it runs (and null after), so cancelling can close it at once. */
  onBrowser?: (browser: Browser | null) => void;
  log: Logger;
  options?: CompatOptions;
}): Promise<void> {
  const { deps, scanId } = args;
  const { prisma, config } = deps;
  const wanted = (['firefox', 'webkit'] as const).filter((engine) =>
    args.website.crossBrowserTargets.includes(DB_ENGINE[engine]),
  );
  const pages = args.targets.slice(
    0,
    Math.min(args.website.crossBrowserPageLimit, config.maxCompatPages),
  );
  const desktop = SCAN_VIEWPORTS[0]!;
  const mobile = SCAN_VIEWPORTS.find((v) => v.label === '390x844')!;

  for (const engine of wanted) {
    const skippedChecks: { check: string; reason: string; viewport?: string }[] = [
      ...NOT_IN_OTHER_BROWSERS,
    ];
    const viewports: ViewportSpec[] = [desktop];
    if (args.website.crossBrowserMobile) {
      if (engine === 'webkit') viewports.push(mobile);
      else {
        skippedChecks.push({
          check: 'mobile-size',
          viewport: mobile.label,
          reason: 'Firefox cannot emulate mobile devices',
        });
      }
    }
    const run = await prisma.scanBrowserRun.create({
      data: {
        scanId,
        browser: DB_ENGINE[engine],
        status: 'RUNNING',
        pagesPlanned: pages.length * viewports.length,
        skippedChecks,
      },
    });
    const finish = (data: Prisma.ScanBrowserRunUpdateInput) =>
      prisma.scanBrowserRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), skippedChecks, ...data },
      });

    if (!config.compatBrowsers.includes(engine)) {
      await finish({
        status: 'SKIPPED',
        errorMessage: 'Not allowed on this server (SCAN_COMPAT_BROWSERS).',
      });
      continue;
    }
    if (args.shouldStop()) {
      await finish({ status: 'SKIPPED', errorMessage: 'The scan reached its time limit.' });
      continue;
    }

    // ------------------------------------------------------------ start safely
    let browser: Browser;
    try {
      browser = await (args.options?.launch ?? ((e) => launchScanBrowser(config, { engine: e })))(
        engine,
      );
    } catch (error) {
      const message = (error as Error).message;
      const missing = /Executable doesn't exist|ENOENT/i.test(message);
      args.log.info({ engine, err: message.split('\n')[0] }, 'browser unavailable');
      await finish({
        status: 'UNAVAILABLE',
        errorMessage: missing
          ? `${ENGINE_NAME[engine]} is not installed on this server.`
          : `${ENGINE_NAME[engine]} could not start: ${message.split('\n')[0]!.slice(0, 200)}`,
      });
      continue;
    }
    args.onBrowser?.(browser);
    let crashed = false;
    // A crash ends whatever this browser is doing at once (a page load on a closing
    // browser could otherwise wait for the time budget).
    const disconnected = new Promise<never>((_, reject) => {
      browser.on('disconnected', () => {
        crashed = true;
        reject(new Error('browser disconnected'));
      });
    });
    disconnected.catch(() => {});
    const version = `${ENGINE_NAME[engine]} ${browser.version()}`;

    let status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE' = 'COMPLETED';
    let errorMessage: string | null = null;
    let checked = 0;
    let failed = 0;
    const deadline = Date.now() + config.compatBrowserTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BudgetExceeded()), config.compatBrowserTimeoutMs);
    });
    budget.catch(() => {});
    try {
      const check = await Promise.race([egressSelfCheck(browser), budget, disconnected]);
      args.log.debug({ engine, version, selfCheck: check.ok }, 'other browser started');
      if (!check.ok) {
        status = 'UNAVAILABLE';
        errorMessage = `${ENGINE_NAME[engine]} failed its network security self-check, so it was not used: ${check.failures
          .map((f) => `${f.url} ${f.reason}`)
          .join('; ')
          .slice(0, 400)}`;
        args.log.warn({ engine, failures: check.failures }, 'browser failed egress self-check');
      } else {
        let index = 0;
        for (const target of pages) {
          for (const viewport of viewports) {
            args.checkpoint();
            if (crashed || !browser.isConnected()) {
              crashed = true;
              throw new Error('browser disconnected');
            }
            if (Date.now() > deadline || args.shouldStop()) throw new BudgetExceeded();
            await args.onPage(
              ENGINE_NAME[engine],
              index,
              pages.length * viewports.length,
              target.url,
            );
            args.log.debug(
              { engine, url: target.url, viewport: viewport.label },
              'other browser: page',
            );
            const summary = await Promise.race([
              checkPage(browser, target.url, viewport),
              budget,
              disconnected,
            ]);
            args.log.debug(
              { engine, url: target.url, status: summary.status },
              'other browser: page done',
            );
            if (summary.status === 'DONE') checked += 1;
            else failed += 1;
            await saveSummary(target.id, engine, summary);
            await args.options?.afterPage?.(engine, browser, index);
            index += 1;
          }
        }
        if (failed > 0) {
          status = checked > 0 ? 'PARTIAL' : 'FAILED';
          errorMessage = `${failed} page(s) could not be checked in ${ENGINE_NAME[engine]}.`;
        }
      }
    } catch (error) {
      try {
        args.checkpoint();
      } catch (cancelled) {
        await browser.close().catch(() => {});
        await finish({ status: 'CANCELLED', version, pagesChecked: checked });
        throw cancelled;
      }
      if (error instanceof BudgetExceeded) {
        status = 'TIMED_OUT';
        errorMessage = args.shouldStop()
          ? 'Stopped: the scan reached its time limit.'
          : `${ENGINE_NAME[engine]} used up its time budget (${Math.round(config.compatBrowserTimeoutMs / 1000)} s).`;
      } else {
        status = 'FAILED';
        errorMessage = crashed
          ? `${ENGINE_NAME[engine]} stopped unexpectedly (crashed or disconnected).`
          : `${ENGINE_NAME[engine]} failed: ${(error as Error).message.split('\n')[0]!.slice(0, 200)}`;
      }
      args.log.info({ engine, status, err: (error as Error).message }, 'browser run ended early');
    } finally {
      clearTimeout(timer);
      args.onBrowser?.(null);
      await browser.close().catch(() => {});
    }
    await finish({ status, version, pagesChecked: checked, errorMessage });
  }

  /** One page at one size, in a new context (closed afterwards). */
  async function checkPage(
    browser: Browser,
    url: string,
    viewport: ViewportSpec,
  ): Promise<BrowserPageSummary> {
    const context = await newScanContext(browser, viewport);
    try {
      const page = await context.newPage();
      const { log, detach } = attachCollectors(page);
      // A page that hangs (e.g. a script evaluation that never returns) fails on its own,
      // without using up the browser's whole budget; closing the context stops it.
      const pageLimitMs = config.navTimeoutMs + PAGE_EXTRA_MS;
      let pageTimer: NodeJS.Timeout | undefined;
      try {
        const capture = await Promise.race([
          capturePage({
            page,
            url,
            log,
            siteHostname: args.siteHostname,
            navTimeoutMs: config.navTimeoutMs,
            domBundle: deps.domBundle,
            alreadyScanned: () => false,
            probe: null,
            consistency: false,
            logger: args.log,
          }),
          new Promise<never>((_, reject) => {
            pageTimer = setTimeout(
              () =>
                reject(
                  new Error(`The page did not finish within ${Math.round(pageLimitMs / 1000)} s.`),
                ),
              pageLimitMs,
            );
          }),
        ]);
        return {
          viewport: viewport.label,
          status: capture.outcome === 'DONE' ? 'DONE' : 'FAILED',
          error: capture.errorMessage,
          httpStatus: capture.httpStatus,
          finalUrl: capture.finalUrl,
          loadTimeMs: capture.loadTimeMs,
          facts: capture.outcome === 'DONE' ? factsOf(capture) : null,
        };
      } finally {
        clearTimeout(pageTimer);
        detach();
      }
    } catch (error) {
      return {
        viewport: viewport.label,
        status: 'FAILED',
        error: (error as Error).message.split('\n')[0]!.slice(0, 200),
        httpStatus: null,
        finalUrl: null,
        loadTimeMs: null,
        facts: null,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /** Adds one engine's result for one size to the page's per-browser record. */
  async function saveSummary(scanPageId: string, engine: OtherEngine, summary: BrowserPageSummary) {
    const row = await prisma.scanPage.findUnique({
      where: { id: scanPageId },
      select: { compatibility: true },
    });
    const current = (row?.compatibility ?? {}) as unknown as Record<string, BrowserPageSummary[]>;
    const next = { ...current, [engine]: [...(current[engine] ?? []), summary] };
    await prisma.scanPage.update({
      where: { id: scanPageId },
      data: { compatibility: next as unknown as Prisma.InputJsonObject },
    });
  }
}
