/**
 * Cross-browser stage (Phase 9, Milestone 3). Off unless the website turns it on. After
 * Chromium's own stages, each other engine (Firefox, then WebKit; never at the same time)
 * loads the first pages:
 *   - its own browser process, a new context per page (nothing shared between pages,
 *     engines or scans), and the egress proxy with every exception closed;
 *   - a security self-check before any site is loaded (fails → the engine is not used);
 *   - passive checks only: the same capture as Chromium's crawl (axe, DOM and layout,
 *     font and icon checks, console and failed requests). No clicks, keys or typing;
 *   - its own status (COMPLETED, PARTIAL, FAILED, UNAVAILABLE, TIMED_OUT, SKIPPED,
 *     CANCELLED). Nothing here changes the scan's outcome or scores.
 * Comparison (Checkpoint 2): for each page and size, Chromium (the scan's own browser, a new
 * context) captures the page at the same moment; what only the other engine has is
 * classified (compat-diff.ts). If anything differs, both load the page again (in the other
 * order) and only differences seen twice keep their classification; the rest become
 * INCONCLUSIVE. Differences are saved as COMPATIBILITY issues (never scored).
 */
import type { CssDeclaration, ElementIdentity } from '@whc/dom-checks';
import type { Prisma } from '@whc/db';
import type { Browser, Page } from 'playwright';
import { normalizeUrl } from '../crawler/urls';
import { egressSelfCheck, launchScanBrowser, newScanContext } from '../browser';
import { SCAN_VIEWPORTS, type ViewportSpec } from '../browser-types';
import { attachCollectors } from '../checks/collectors';
import { compatibilityDraft } from '../compat-issues';
import type { IssueDraft } from '../issues';
import type { Logger } from '../logger';
import { capturePage, type PageCapture } from './capture-page';
import {
  compareFacts,
  confirmDifferences,
  type ComparableFacts,
  type Difference,
  type LocatedFact,
} from './compat-diff';
import type { ScanDeps } from './run-scan';

type OtherEngine = 'firefox' | 'webkit';
const ENGINE_NAME: Record<OtherEngine, string> = { firefox: 'Firefox', webkit: 'WebKit' };
const DB_ENGINE = { firefox: 'FIREFOX', webkit: 'WEBKIT' } as const;
/** At most this many differences are saved per page, size and engine. */
const MAX_DIFFERENCES = 30;

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
  /** The comparison with Chromium (Checkpoint 2). */
  comparison?: {
    compared: boolean;
    reason: string | null;
    baselineVersion: string | null;
    differences: number;
    confirmed: number;
    /** Things only Chromium had (not reported: Chromium's own issues cover them). */
    chromiumOnly: number;
  };
}

type Identities = Map<string, ElementIdentity>;

/** The facts kept per page: compact, with each element's identity for matching. */
export function factsOf(capture: PageCapture, ids: Identities = new Map()) {
  const short = (html: string | null | undefined) => (html ?? '').slice(0, 300);
  const id = (selector: string) => ids.get(selector) ?? null;
  return {
    accessibility: (capture.axe?.violations ?? []).slice(0, 100).map((rule) => ({
      rule: rule.id,
      impact: rule.impact ?? null,
      nodes: rule.nodes.slice(0, 10).map((node) => {
        const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
        return { target, html: short(node.html), identity: id(target) };
      }),
    })),
    needsReview: capture.axe?.incomplete.length ?? 0,
    ui: (capture.dom?.findings ?? []).slice(0, 100).map((f) => ({
      check: f.check,
      selector: f.selector,
      html: short(f.html),
      identity: id(f.selector),
    })),
    layout: (capture.extra?.findings ?? []).slice(0, 100).map((f) => ({
      check: f.check,
      selector: f.selector,
      html: short(f.html),
      identity: id(f.selector),
    })),
    fonts: (capture.extra?.fonts ?? []).map((f) => ({
      family: f.family,
      weight: f.weight,
      style: f.style,
      status: f.status,
      sources: f.sources,
    })),
    console: capture.network.consoleErrors.slice(0, 50).map((c) => ({
      level: c.level,
      text: c.text.slice(0, 300),
      source: c.source ?? null,
    })),
    exceptions: capture.network.pageErrors.slice(0, 50).map((e) => ({
      message: e.message.slice(0, 300),
      source: e.source ?? null,
      line: e.line ?? null,
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

/** The shape the comparison needs (compat-diff.ts). */
function comparable(
  facts: ReturnType<typeof factsOf>,
  cssSupport?: (CssDeclaration & { supported: boolean })[],
): ComparableFacts {
  return {
    exceptions: facts.exceptions,
    failedRequests: facts.failedRequests,
    fonts: facts.fonts,
    ui: facts.ui,
    layout: facts.layout,
    accessibility: facts.accessibility.flatMap((rule) =>
      rule.nodes.map((node): LocatedFact => ({
        check: rule.rule,
        selector: node.target,
        html: node.html,
        identity: node.identity,
      })),
    ),
    cssSupport,
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

/** Pages each engine compared completely (for issue tracking), by engine. */
export type CompatCoverage = Record<'FIREFOX' | 'WEBKIT', Set<string>>;

/** One capture of one page at one size in one browser. */
interface Capture {
  summary: BrowserPageSummary;
  facts: ReturnType<typeof factsOf> | null;
  /** Declarations the page applies (Chromium captures only). */
  cssInUse: CssDeclaration[];
  /** This engine's verdict on Chromium's declarations (other engine only). */
  cssSupport: (CssDeclaration & { supported: boolean })[] | undefined;
}

/** Runs the stage. Never throws, except to cancel the scan. */
export async function runCompatibility(args: {
  deps: ScanDeps;
  scanId: string;
  websiteId: string;
  website: {
    crossBrowserTargets: ('FIREFOX' | 'WEBKIT' | 'CHROMIUM')[];
    crossBrowserPageLimit: number;
    crossBrowserMobile: boolean;
  };
  siteHostname: string;
  targets: { id: string; url: string; normalizedUrl: string }[];
  /** The scan's own Chromium: the baseline every other engine is compared with. */
  baseline: Browser;
  storeIssues: (scanPageId: string | null, drafts: IssueDraft[]) => Promise<void>;
  checkpoint: () => void;
  shouldStop: () => boolean;
  onPage: (engine: string, index: number, total: number, url: string) => Promise<void>;
  /** Called with the browser while it runs (and null after), so cancelling can close it at once. */
  onBrowser?: (browser: Browser | null) => void;
  log: Logger;
  options?: CompatOptions;
}): Promise<CompatCoverage> {
  const { deps, scanId } = args;
  const { prisma, config } = deps;
  const coverage: CompatCoverage = { FIREFOX: new Set(), WEBKIT: new Set() };
  const baselineVersion = `Chromium ${args.baseline.version()}`;
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
    const bounded = <T>(work: Promise<T>) => Promise.race([work, budget, disconnected]);
    try {
      const check = await bounded(egressSelfCheck(browser));
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
          let comparedSizes = 0;
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
            const ctx = {
              websiteId: args.websiteId,
              pageUrl: target.url,
              viewport: viewport.label,
            };

            // First load: Chromium, then this engine (with Chromium's CSS to check).
            const base1 = await bounded(
              capture(args.baseline, target.url, viewport, { inUse: true }),
            );
            const other1 = await bounded(
              capture(browser, target.url, viewport, { check: base1.cssInUse }),
            );
            const summary = other1.summary;
            if (summary.status === 'DONE') checked += 1;
            else failed += 1;

            if (!base1.facts || !other1.facts) {
              summary.comparison = {
                compared: false,
                reason: !base1.facts
                  ? `Chromium could not load the page for the comparison: ${base1.summary.error ?? 'failed'}`
                  : `The page could not be checked in ${ENGINE_NAME[engine]}.`,
                baselineVersion,
                differences: 0,
                confirmed: 0,
                chromiumOnly: 0,
              };
            } else {
              const baseFacts = comparable(base1.facts);
              const otherFacts = comparable(other1.facts, other1.cssSupport);
              const first = compareFacts(baseFacts, otherFacts, args.siteHostname);
              let second: Difference[] | null = null;
              if (first.length > 0) {
                // Confirmation: both again, in the other order.
                const other2 = await bounded(
                  capture(browser, target.url, viewport, { check: base1.cssInUse }),
                );
                const base2 = await bounded(capture(args.baseline, target.url, viewport, {}));
                if (other2.facts && base2.facts) {
                  second = compareFacts(
                    comparable(base2.facts),
                    comparable(other2.facts, other2.cssSupport),
                    args.siteHostname,
                  );
                }
              }
              const final = confirmDifferences(first, second).slice(0, MAX_DIFFERENCES);
              summary.comparison = {
                compared: true,
                reason: null,
                baselineVersion,
                differences: final.length,
                confirmed: final.filter((d) => d.evidence.confirmed === true).length,
                chromiumOnly: compareFacts(otherFacts, baseFacts, args.siteHostname).length,
              };
              await args.storeIssues(
                target.id,
                final.map((d) =>
                  compatibilityDraft(d, ctx, {
                    engine: DB_ENGINE[engine],
                    version,
                    baselineVersion,
                  }),
                ),
              );
              comparedSizes += 1;
            }
            args.log.debug(
              { engine, url: target.url, status: summary.status, comparison: summary.comparison },
              'other browser: page done',
            );
            await saveSummary(target.id, engine, summary);
            await args.options?.afterPage?.(engine, browser, index);
            index += 1;
          }
          // Only a page compared at every size can resolve this browser's earlier findings.
          if (comparedSizes === viewports.length) {
            coverage[DB_ENGINE[engine]].add(target.normalizedUrl);
            const normalized = normalizeUrl(target.url);
            if (normalized) coverage[DB_ENGINE[engine]].add(normalized);
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
  return coverage;

  /**
   * One page at one size in one browser, in a new context (closed afterwards). Chromium
   * captures also list the CSS the page applies; the other engine's captures check it.
   */
  async function capture(
    browser: Browser,
    url: string,
    viewport: ViewportSpec,
    css: { inUse?: boolean; check?: CssDeclaration[] },
  ): Promise<Capture> {
    const failed = (error: string): Capture => ({
      summary: {
        viewport: viewport.label,
        status: 'FAILED',
        error,
        httpStatus: null,
        finalUrl: null,
        loadTimeMs: null,
        facts: null,
      },
      facts: null,
      cssInUse: [],
      cssSupport: undefined,
    });
    const context = await newScanContext(browser, viewport);
    try {
      const page = await context.newPage();
      const { log, detach } = attachCollectors(page);
      // A page that hangs (e.g. a script evaluation that never returns) fails on its own,
      // without using up the browser's whole budget; closing the context stops it.
      const pageLimitMs = config.navTimeoutMs + PAGE_EXTRA_MS;
      let pageTimer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          (async (): Promise<Capture> => {
            const result = await capturePage({
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
            });
            if (result.outcome !== 'DONE') {
              return {
                ...failed(result.errorMessage ?? 'failed'),
                summary: {
                  ...failed('').summary,
                  error: result.errorMessage,
                  httpStatus: result.httpStatus,
                  finalUrl: result.finalUrl,
                },
              };
            }
            const ids = await identitiesFor(page, result);
            const facts = factsOf(result, ids);
            const cssInUse = css.inUse
              ? ((await page.evaluate(
                  'window.__whcDomChecks.compat.cssInUse()',
                )) as CssDeclaration[])
              : [];
            const cssSupport = css.check?.length
              ? ((await page.evaluate(
                  `window.__whcDomChecks.compat.cssSupport(${JSON.stringify(css.check)})`,
                )) as (CssDeclaration & { supported: boolean })[])
              : undefined;
            return {
              summary: {
                viewport: viewport.label,
                status: 'DONE',
                error: null,
                httpStatus: result.httpStatus,
                finalUrl: result.finalUrl,
                loadTimeMs: result.loadTimeMs,
                facts,
              },
              facts,
              cssInUse,
              cssSupport,
            };
          })(),
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
      } finally {
        clearTimeout(pageTimer);
        detach();
      }
    } catch (error) {
      return failed((error as Error).message.split('\n')[0]!.slice(0, 200));
    } finally {
      await context.close().catch(() => {});
    }
  }

  /** Each reported element's identity in this page (for matching between browsers). */
  async function identitiesFor(page: Page, result: PageCapture): Promise<Identities> {
    const selectors = [
      ...new Set([
        ...(result.dom?.findings ?? []).map((f) => f.selector),
        ...(result.extra?.findings ?? []).map((f) => f.selector),
        ...(result.axe?.violations ?? []).flatMap((rule) =>
          rule.nodes
            .slice(0, 10)
            .map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target))),
        ),
      ]),
    ].slice(0, 400);
    if (selectors.length === 0) return new Map();
    const list = (await page.evaluate(
      `window.__whcDomChecks.compat.identities(${JSON.stringify(selectors)})`,
    )) as ElementIdentity[];
    return new Map(selectors.map((s, i) => [s, list[i]!]));
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
