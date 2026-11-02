/** Lighthouse result extraction and performance issue thresholds (pure functions). */
import { describe, expect, it } from 'vitest';
import {
  extractLighthouseResult,
  isTransientLighthouseError,
  performanceDrafts,
  type LighthousePageResult,
} from '../src/audits/lighthouse';

const lhr = {
  lighthouseVersion: '13.5.0',
  runWarnings: ['The page loaded too slowly'],
  categories: {
    performance: { score: 0.68 },
    accessibility: { score: 1 },
    'best-practices': { score: 0.783 },
    seo: { score: 0.91 },
  },
  audits: {
    'first-contentful-paint': { numericValue: 5067.9 },
    'largest-contentful-paint': { numericValue: 5067.9 },
    'cumulative-layout-shift': { numericValue: 0.02 },
    'total-blocking-time': { numericValue: 750 },
    'speed-index': { numericValue: 5100 },
    'total-byte-weight': { numericValue: 300_000 },
    'dom-size': { numericValue: 12 },
    'mainthread-work-breakdown': { numericValue: 900 },
    'unminified-javascript': {
      title: 'Minify JavaScript',
      score: 0,
      displayValue: 'Est savings of 293 KiB',
      details: { type: 'opportunity', overallSavingsMs: 1500, overallSavingsBytes: 300_018 },
    },
    'render-blocking-insight': {
      title: 'Render blocking requests',
      score: 0,
      displayValue: 'Est savings of 4,460 ms',
      details: { type: 'table' },
      metricSavings: { FCP: 4450, LCP: 4460 },
    },
    // Passing audits and insights without savings are not opportunities.
    'uses-text-compression': {
      title: 'Enable text compression',
      score: 1,
      details: { type: 'opportunity', overallSavingsMs: 0 },
    },
    'cache-insight': { title: 'Cache', score: 0, details: { type: 'table' }, metricSavings: {} },
    'network-requests': {
      details: {
        type: 'table',
        items: [
          {
            url: 'https://shop.example/app.js?token=SECRET',
            resourceType: 'Script',
            transferSize: 300279,
            networkRequestTime: 100,
            networkEndTime: 900,
          },
          {
            url: 'https://shop.example/',
            resourceType: 'Document',
            transferSize: 398,
            networkRequestTime: 0,
            networkEndTime: 25,
          },
        ],
      },
    },
  },
};

describe('extractLighthouseResult', () => {
  it('reads scores (0-100), metrics, opportunities, insights and slow requests', () => {
    const r = extractLighthouseResult(lhr);
    expect(r.ok).toBe(true);
    expect(r.scores).toEqual({ performance: 68, accessibility: 100, bestPractices: 78, seo: 91 });
    expect(r.metrics).toEqual({
      fcpMs: 5067.9,
      lcpMs: 5067.9,
      cls: 0.02,
      tbtMs: 750,
      speedIndexMs: 5100,
      inpMs: null, // never measured in a lab navigation
    });
    expect(r.opportunities.map((o) => [o.id, o.savingsMs])).toEqual([
      ['render-blocking-insight', 4460],
      ['unminified-javascript', 1500],
    ]);
    expect(r.diagnostics.slowestRequests[0]).toEqual({
      url: 'https://shop.example/app.js', // query string (possible tokens) removed
      resourceType: 'Script',
      transferSize: 300279,
      durationMs: 800,
    });
    expect(r.diagnostics.warnings).toEqual(['The page loaded too slowly']);
    expect(r.lighthouseVersion).toBe('13.5.0');
  });

  it('turns a Lighthouse runtime error into "not measured", never into numbers', () => {
    const r = extractLighthouseResult({
      ...lhr,
      runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('NO_FCP: The page did not paint any content.');
    expect(r.scores).toEqual({
      performance: null,
      accessibility: null,
      bestPractices: null,
      seo: null,
    });
    expect(r.metrics.lcpMs).toBeNull();
    expect(r.opportunities).toEqual([]);
  });
});

describe('performanceDrafts', () => {
  const result = (overrides: Partial<LighthousePageResult['metrics']>): LighthousePageResult => ({
    ...extractLighthouseResult(lhr),
    metrics: {
      fcpMs: 1000,
      lcpMs: 2000,
      cls: 0.05,
      tbtMs: 100,
      speedIndexMs: 2000,
      inpMs: null,
      ...overrides,
    },
    opportunities: [],
  });

  it('reports only metrics outside the "good" range, with poor ones as HIGH', () => {
    expect(performanceDrafts('w1', 'https://shop.example/', result({}))).toEqual([]);
    const drafts = performanceDrafts(
      'w1',
      'https://shop.example/',
      result({ lcpMs: 5000, cls: 0.15, tbtMs: 700 }),
    );
    expect(drafts.map((d) => [d.ruleId, d.severity])).toEqual([
      ['perf/lcp', 'HIGH'],
      ['perf/cls', 'MEDIUM'],
      ['perf/tbt', 'HIGH'],
    ]);
    expect(drafts[0]!.description).toBe(
      'Largest Contentful Paint is 5.0 s (mobile lab test). Good is at most 2.5 s; above 4.0 s is poor.',
    );
    expect(drafts.every((d) => d.category === 'PERFORMANCE' && d.suggestedFix)).toBe(true);
  });

  it('turns big savings opportunities into issues and skips small ones', () => {
    const r = { ...result({}), opportunities: extractLighthouseResult(lhr).opportunities };
    r.opportunities.push({
      id: 'tiny',
      title: 'Tiny',
      displayValue: null,
      savingsMs: 100,
      savingsBytes: null,
    });
    expect(
      performanceDrafts('w1', 'https://shop.example/', r).map((d) => [d.ruleId, d.severity]),
    ).toEqual([
      ['perf/render-blocking-insight', 'MEDIUM'],
      ['perf/unminified-javascript', 'LOW'],
    ]);
  });

  it('creates no issues when Lighthouse failed', () => {
    expect(
      performanceDrafts(
        'w1',
        'https://shop.example/',
        extractLighthouseResult({ runtimeError: { code: 'X' } }),
      ),
    ).toEqual([]);
  });
});

describe('isTransientLighthouseError', () => {
  it('retries dropped connections only, never page problems', () => {
    expect(
      isTransientLighthouseError(
        'FAILED_DOCUMENT_REQUEST: Lighthouse was unable to reliably load the page you requested. (Details: net::ERR_TUNNEL_CONNECTION_FAILED)',
      ),
    ).toBe(true);
    expect(
      isTransientLighthouseError(
        'FAILED_DOCUMENT_REQUEST: ... (Details: net::ERR_CONNECTION_RESET)',
      ),
    ).toBe(true);
    expect(isTransientLighthouseError('NO_FCP: The page did not paint any content.')).toBe(false);
    expect(isTransientLighthouseError('ERRORED_DOCUMENT_REQUEST: ... (Status code: 404)')).toBe(
      false,
    );
    expect(isTransientLighthouseError(null)).toBe(false);
  });
});
