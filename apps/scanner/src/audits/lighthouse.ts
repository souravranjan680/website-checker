import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import lighthouse from 'lighthouse';
import { fingerprint, type IssueDraft, type Severity } from '../issues';

/**
 * Google Lighthouse (lab test, mobile preset with simulated throttling, which is
 * how PageSpeed Insights runs it). It drives a separate Chromium that the scanner
 * launched with the egress proxy, so every request is still SSRF-checked.
 *
 * INP needs real user interactions and cannot be measured in a lab navigation;
 * Lighthouse reports Total Blocking Time (TBT) as the lab stand-in.
 */

export const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

export interface LighthouseOpportunity {
  id: string;
  title: string;
  displayValue: string | null;
  savingsMs: number | null;
  savingsBytes: number | null;
}

export interface LighthouseRequest {
  url: string;
  resourceType: string | null;
  transferSize: number | null;
  durationMs: number | null;
}

export interface LighthousePageResult {
  /** false when Lighthouse could not produce metrics (runtime error, timeout, crash). */
  ok: boolean;
  /** Lighthouse's own error code / message when not ok. */
  error: string | null;
  scores: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  metrics: {
    fcpMs: number | null;
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    speedIndexMs: number | null;
    /** Always null: not measurable in a lab navigation. */
    inpMs: null;
  };
  opportunities: LighthouseOpportunity[];
  diagnostics: {
    totalByteWeight: number | null;
    domSize: number | null;
    mainThreadMs: number | null;
    slowestRequests: LighthouseRequest[];
    warnings: string[];
  };
  lighthouseVersion: string | null;
}

/** The parts of a Lighthouse result (LHR) we read. Typed loosely: the LHR is large. */
interface Lhr {
  lighthouseVersion?: string;
  runtimeError?: { code?: string; message?: string };
  runWarnings?: string[];
  categories?: Record<string, { score: number | null } | undefined>;
  audits?: Record<
    string,
    | {
        title?: string;
        score?: number | null;
        numericValue?: number;
        displayValue?: string;
        details?: {
          type?: string;
          overallSavingsMs?: number;
          overallSavingsBytes?: number;
          items?: Record<string, unknown>[];
        };
        metricSavings?: Record<string, number>;
      }
    | undefined
  >;
}

const score = (value: number | null | undefined) =>
  typeof value === 'number' ? Math.round(value * 100) : null;
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Largest estimated time saving of an audit (overall, or its effect on LCP / FCP). */
function estimatedSavingsMs(audit: NonNullable<NonNullable<Lhr['audits']>[string]>): number {
  return Math.max(
    num(audit.details?.overallSavingsMs) ?? 0,
    num(audit.metricSavings?.LCP) ?? 0,
    num(audit.metricSavings?.FCP) ?? 0,
  );
}

/** Turns a Lighthouse result into what we store. Pure: unit-tested with small LHR samples. */
export function extractLighthouseResult(lhr: Lhr): LighthousePageResult {
  const audits = lhr.audits ?? {};
  const metric = (id: string) => num(audits[id]?.numericValue);
  const failed = Boolean(lhr.runtimeError?.code);

  const opportunities: LighthouseOpportunity[] = Object.entries(audits)
    // Classic "opportunity" audits, plus Lighthouse 13 "insight" audits that estimate savings.
    .filter(
      ([id, audit]) =>
        audit !== undefined &&
        (audit.details?.type === 'opportunity' || id.endsWith('-insight')) &&
        (audit.score ?? 0) < 0.9 &&
        estimatedSavingsMs(audit) + (num(audit.details?.overallSavingsBytes) ?? 0) > 0,
    )
    .map(([id, audit]) => ({
      id,
      title: audit!.title ?? id,
      displayValue: audit!.displayValue ?? null,
      savingsMs: estimatedSavingsMs(audit!) || null,
      savingsBytes: num(audit!.details?.overallSavingsBytes),
    }))
    .sort(
      (a, b) =>
        (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || (b.savingsBytes ?? 0) - (a.savingsBytes ?? 0),
    )
    .slice(0, 15);

  const requests = (audits['network-requests']?.details?.items ?? []).map((item) => {
    const start = num(item.networkRequestTime) ?? num(item.startTime);
    const end = num(item.networkEndTime) ?? num(item.endTime);
    return {
      // Query strings can carry tokens; keep only scheme, host and path.
      url: String(item.url ?? '')
        .split(/[?#]/)[0]!
        .slice(0, 300),
      resourceType: typeof item.resourceType === 'string' ? item.resourceType : null,
      transferSize: num(item.transferSize),
      durationMs: start !== null && end !== null ? Math.round(end - start) : null,
    };
  });

  return {
    ok: !failed,
    error: failed
      ? `${lhr.runtimeError!.code}: ${lhr.runtimeError!.message ?? ''}`.slice(0, 500)
      : null,
    scores: {
      performance: failed ? null : score(lhr.categories?.performance?.score),
      accessibility: failed ? null : score(lhr.categories?.accessibility?.score),
      bestPractices: failed ? null : score(lhr.categories?.['best-practices']?.score),
      seo: failed ? null : score(lhr.categories?.seo?.score),
    },
    metrics: {
      fcpMs: failed ? null : metric('first-contentful-paint'),
      lcpMs: failed ? null : metric('largest-contentful-paint'),
      cls: failed ? null : metric('cumulative-layout-shift'),
      tbtMs: failed ? null : metric('total-blocking-time'),
      speedIndexMs: failed ? null : metric('speed-index'),
      inpMs: null,
    },
    opportunities: failed ? [] : opportunities,
    diagnostics: {
      totalByteWeight: metric('total-byte-weight'),
      domSize: metric('dom-size'),
      mainThreadMs: metric('mainthread-work-breakdown'),
      slowestRequests: requests
        .filter((r) => r.durationMs !== null)
        .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
        .slice(0, 10),
      warnings: (lhr.runWarnings ?? []).map((w) => String(w).slice(0, 300)).slice(0, 10),
    },
    lighthouseVersion: lhr.lighthouseVersion ?? null,
  };
}

/**
 * Network-level failures worth one retry (connection dropped or refused, tunnel
 * failed, DNS hiccup). Problems with the page itself (no paint, HTTP errors) are not.
 */
export function isTransientLighthouseError(error: string | null): boolean {
  if (!error) return false;
  return (
    /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|PROTOCOL_TIMEOUT/.test(error) &&
    /ERR_(TUNNEL_CONNECTION_FAILED|CONNECTION_(RESET|CLOSED|REFUSED|TIMED_OUT)|TIMED_OUT|NAME_NOT_RESOLVED|EMPTY_RESPONSE)|PROTOCOL_TIMEOUT/.test(
      error,
    )
  );
}

/** A free local TCP port for Chromium's DevTools endpoint (Lighthouse connects to it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

/**
 * Runs Lighthouse against `url` in the Chromium listening on `port`.
 * Returns the extracted result and the raw JSON (stored for download).
 * Never throws for page problems; a crash/timeout becomes ok=false with a reason.
 */
export async function runLighthouse(
  url: string,
  port: number,
  options: { timeoutMs: number },
): Promise<{ result: LighthousePageResult; rawJson: string | null }> {
  const failure = (error: string) => ({
    result: extractLighthouseResult({ runtimeError: { code: 'SCANNER_ERROR', message: error } }),
    rawJson: null,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const run = lighthouse(url, {
      port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: LIGHTHOUSE_CATEGORIES,
      maxWaitForLoad: Math.min(45_000, options.timeoutMs),
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Lighthouse did not finish within ${Math.round(options.timeoutMs / 1000)} s`),
          ),
        options.timeoutMs,
      );
    });
    const runnerResult = await Promise.race([run, timeout]);
    if (!runnerResult) return failure('Lighthouse returned no result');
    const lhr = runnerResult.lhr as unknown as Lhr & Record<string, unknown>;
    // Drop the embedded screenshots: they make the file several MB and we store our own.
    const audits = { ...(lhr.audits ?? {}) } as Record<string, unknown>;
    delete audits['screenshot-thumbnails'];
    delete audits['final-screenshot'];
    delete audits['full-page-screenshot'];
    const slim = { ...lhr, audits, fullPageScreenshot: undefined };
    return { result: extractLighthouseResult(lhr), rawJson: JSON.stringify(slim) };
  } catch (error) {
    return failure((error as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------- issues

/** Lab thresholds (web.dev Core Web Vitals, and Lighthouse's own TBT scoring). */
export const METRIC_THRESHOLDS = {
  lcpMs: { good: 2500, poor: 4000, label: 'Largest Contentful Paint', unit: 'ms' },
  cls: { good: 0.1, poor: 0.25, label: 'Cumulative Layout Shift', unit: '' },
  tbtMs: { good: 200, poor: 600, label: 'Total Blocking Time', unit: 'ms' },
  fcpMs: { good: 1800, poor: 3000, label: 'First Contentful Paint', unit: 'ms' },
  speedIndexMs: { good: 3400, poor: 5800, label: 'Speed Index', unit: 'ms' },
} as const;

const METRIC_FIX: Record<keyof typeof METRIC_THRESHOLDS, string> = {
  lcpMs:
    'Make the largest image or text block appear sooner: optimise and preload the hero image, reduce render-blocking CSS/JS, and speed up the server response.',
  cls: 'Reserve space for images, ads and embeds (width/height or aspect-ratio), and avoid inserting content above what is already shown.',
  tbtMs:
    'Reduce long JavaScript tasks: split bundles, defer non-critical scripts, and remove unused JavaScript.',
  fcpMs:
    'Show something sooner: remove render-blocking resources, inline critical CSS and reduce server response time.',
  speedIndexMs:
    'Load visible content first: defer below-the-fold work and reduce render-blocking resources.',
};

const format = (key: keyof typeof METRIC_THRESHOLDS, value: number) =>
  key === 'cls' ? value.toFixed(3) : `${(value / 1000).toFixed(1)} s`;

function performanceDraft(
  ctx: { websiteId: string; pageUrl: string },
  values: {
    ruleId: string;
    title: string;
    severity: Severity;
    description: string;
    fix: string;
    details: Record<string, unknown>;
  },
): IssueDraft {
  return {
    id: randomUUID(),
    category: 'PERFORMANCE',
    severity: values.severity,
    ruleId: values.ruleId,
    title: values.title,
    description: values.description,
    pageUrl: ctx.pageUrl,
    viewport: 'mobile (Lighthouse)',
    selector: null,
    htmlSnippet: null,
    boundingBox: null,
    suggestedFix: values.fix,
    details: values.details,
    fingerprint: fingerprint({
      websiteId: ctx.websiteId,
      category: 'PERFORMANCE',
      ruleId: values.ruleId,
      pageUrl: ctx.pageUrl,
      viewport: 'lighthouse-mobile',
      target: values.ruleId,
    }),
  };
}

/** Issues for metrics outside the "good" range and for large savings opportunities. */
export function performanceDrafts(
  websiteId: string,
  pageUrl: string,
  result: LighthousePageResult,
): IssueDraft[] {
  if (!result.ok) return [];
  const ctx = { websiteId, pageUrl };
  const drafts: IssueDraft[] = [];
  for (const key of Object.keys(METRIC_THRESHOLDS) as (keyof typeof METRIC_THRESHOLDS)[]) {
    const value = result.metrics[key];
    const t = METRIC_THRESHOLDS[key];
    if (value === null || value <= t.good) continue;
    const poor = value > t.poor;
    drafts.push(
      performanceDraft(ctx, {
        ruleId: `perf/${key.replace(/Ms$/, '').toLowerCase()}`,
        title: `${poor ? 'Poor' : 'Slow'} ${t.label}`,
        severity: poor ? 'HIGH' : 'MEDIUM',
        description: `${t.label} is ${format(key, value)} (mobile lab test). Good is at most ${format(key, t.good)}${poor ? `; above ${format(key, t.poor)} is poor` : ''}.`,
        fix: METRIC_FIX[key],
        details: { metric: key, value, good: t.good, poor: t.poor },
      }),
    );
  }
  for (const opportunity of result.opportunities) {
    if ((opportunity.savingsMs ?? 0) < 500) continue;
    drafts.push(
      performanceDraft(ctx, {
        ruleId: `perf/${opportunity.id}`,
        title: opportunity.title,
        severity: (opportunity.savingsMs ?? 0) >= 2000 ? 'MEDIUM' : 'LOW',
        description: `Lighthouse estimates ${opportunity.displayValue ?? `${Math.round(opportunity.savingsMs ?? 0)} ms`} of potential savings on this page.`,
        fix: `See the Lighthouse "${opportunity.title}" audit in the performance report for the exact resources.`,
        details: { opportunity },
      }),
    );
  }
  return drafts;
}
