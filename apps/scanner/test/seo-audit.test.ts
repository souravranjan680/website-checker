/** SEO rules as pure functions: no browser, no database. */
import type { SeoSnapshot } from '@whc/dom-checks';
import { describe, expect, it } from 'vitest';
import {
  analyzeRobotsTxt,
  duplicateSeoDrafts,
  firstSkippedHeading,
  looksLikeSitemap,
  pageSeoDrafts,
  siteSeoDrafts,
  type SeoPageInput,
  type SiteSeoFacts,
} from '../src/audits/seo';

const goodSeo: SeoSnapshot = {
  metaRobots: null,
  ogTitle: 'Shop',
  ogDescription: 'Things to buy',
  ogImage: 'https://shop.example/og.png',
  headings: [
    { level: 1, text: 'Shop' },
    { level: 2, text: 'Products' },
    { level: 3, text: 'Shoes' },
  ],
  imagesTotal: 2,
  imagesWithoutAlt: 0,
};

function page(overrides: Partial<SeoPageInput> = {}): SeoPageInput {
  return {
    scanPageId: 'p1',
    url: 'https://shop.example/',
    title: 'Example Shop: shoes and boots',
    metaDescription: 'Example Shop sells shoes and boots for every season, with free returns.',
    canonical: 'https://shop.example/',
    h1Count: 1,
    xRobotsTag: null,
    seo: goodSeo,
    ...overrides,
  };
}
const checks = (drafts: { seo?: { checkType: string } }[]) => drafts.map((d) => d.seo!.checkType);

describe('pageSeoDrafts', () => {
  it('reports nothing for a well-formed page', () => {
    expect(pageSeoDrafts('w1', page(), 'shop.example')).toEqual([]);
  });

  it('finds missing title, description, h1 and canonical', () => {
    const drafts = pageSeoDrafts(
      'w1',
      page({ title: '  ', metaDescription: null, h1Count: 0, canonical: null }),
      'shop.example',
    );
    expect(checks(drafts)).toEqual(
      expect.arrayContaining([
        'MISSING_TITLE',
        'MISSING_META_DESCRIPTION',
        'MISSING_H1',
        'MISSING_CANONICAL',
      ]),
    );
    const title = drafts.find((d) => d.seo!.checkType === 'MISSING_TITLE')!;
    expect(title).toMatchObject({ category: 'SEO', severity: 'HIGH', ruleId: 'seo/missing-title' });
    expect(title.suggestedFix).toContain('<title>');
  });

  it('flags lengths outside the recommended ranges', () => {
    const drafts = pageSeoDrafts(
      'w1',
      page({ title: 'Hi', metaDescription: 'x'.repeat(200) }),
      'shop.example',
    );
    expect(checks(drafts)).toEqual(['TITLE_LENGTH', 'META_DESCRIPTION_LENGTH']);
    expect(drafts[0]!.seo).toMatchObject({ actual: '2 characters' });
  });

  it('detects several h1, skipped heading levels, noindex (meta or header), missing OG and alt', () => {
    const drafts = pageSeoDrafts(
      'w1',
      page({
        h1Count: 2,
        xRobotsTag: 'noindex',
        seo: {
          ...goodSeo,
          ogImage: null,
          headings: [
            { level: 1, text: 'A' },
            { level: 2, text: 'B' },
            { level: 4, text: 'Deep' },
          ],
          imagesTotal: 5,
          imagesWithoutAlt: 3,
        },
      }),
      'shop.example',
    );
    expect(checks(drafts)).toEqual([
      'MULTIPLE_H1',
      'SKIPPED_HEADING_LEVEL',
      'NOINDEX',
      'MISSING_OPEN_GRAPH',
      'MISSING_IMAGE_ALT',
    ]);
    expect(drafts.find((d) => d.seo!.checkType === 'SKIPPED_HEADING_LEVEL')!.description).toContain(
      'h2 to h4',
    );
    expect(drafts.find((d) => d.seo!.checkType === 'MISSING_OPEN_GRAPH')!.description).toBe(
      'Missing: og:image.',
    );
    expect(
      checks(
        pageSeoDrafts(
          'w1',
          page({ seo: { ...goodSeo, metaRobots: 'NOINDEX, follow' } }),
          'shop.example',
        ),
      ),
    ).toEqual(['NOINDEX']);
  });

  it('checks the canonical URL: relative is fine, other site or bad scheme is not', () => {
    expect(pageSeoDrafts('w1', page({ canonical: '/' }), 'shop.example')).toEqual([]);
    expect(
      pageSeoDrafts('w1', page({ canonical: 'https://www.shop.example/' }), 'shop.example'),
    ).toEqual([]);
    const other = pageSeoDrafts(
      'w1',
      page({ canonical: 'https://elsewhere.example/' }),
      'shop.example',
    );
    expect(checks(other)).toEqual(['INVALID_CANONICAL']);
    expect(other[0]!.description).toContain('elsewhere.example');
    expect(
      checks(pageSeoDrafts('w1', page({ canonical: 'javascript:alert(1)' }), 'shop.example')),
    ).toEqual(['INVALID_CANONICAL']);
  });

  it('keeps the same fingerprint across scans for the same page and check', () => {
    const a = pageSeoDrafts('w1', page({ title: '' }), 'shop.example')[0]!;
    const b = pageSeoDrafts(
      'w1',
      page({ title: '', scanPageId: 'other-scan-page' }),
      'shop.example',
    )[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.id).not.toBe(b.id);
  });
});

describe('firstSkippedHeading', () => {
  it('allows going back up any number of levels, but not jumping down', () => {
    expect(
      firstSkippedHeading([
        { level: 1, text: '' },
        { level: 2, text: '' },
        { level: 3, text: '' },
        { level: 2, text: '' },
      ]),
    ).toBeNull();
    expect(
      firstSkippedHeading([
        { level: 2, text: 'x' },
        { level: 3, text: '' },
      ]),
    ).toBeNull();
    expect(
      firstSkippedHeading([
        { level: 1, text: '' },
        { level: 3, text: 'Jump' },
      ]),
    ).toEqual({ from: 1, to: 3, text: 'Jump' });
  });
});

describe('duplicateSeoDrafts', () => {
  it('reports each page that shares a title or description (case and spacing ignored)', () => {
    const pages = [
      page({
        scanPageId: 'a',
        url: 'https://shop.example/a',
        title: 'Shoes',
        metaDescription: 'Same text here',
      }),
      page({
        scanPageId: 'b',
        url: 'https://shop.example/b',
        title: ' shoes ',
        metaDescription: 'Same  text here',
      }),
      page({
        scanPageId: 'c',
        url: 'https://shop.example/c',
        title: 'Boots',
        metaDescription: null,
      }),
    ];
    const result = duplicateSeoDrafts('w1', pages);
    expect(checks(result.get('a')!)).toEqual(['DUPLICATE_TITLE', 'DUPLICATE_META_DESCRIPTION']);
    expect(checks(result.get('b')!)).toEqual(['DUPLICATE_TITLE', 'DUPLICATE_META_DESCRIPTION']);
    expect(result.get('c')).toBeUndefined();
    expect(result.get('a')![0]!.description).toContain('https://shop.example/b');
  });
});

describe('robots.txt and sitemap', () => {
  it('parses Disallow: / for all crawlers and Sitemap lines', () => {
    expect(
      analyzeRobotsTxt('User-agent: *\nDisallow: /\nSitemap: https://shop.example/s.xml'),
    ).toEqual({
      blocksAll: true,
      sitemaps: ['https://shop.example/s.xml'],
    });
    expect(
      analyzeRobotsTxt('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/')
        .blocksAll,
    ).toBe(false);
    expect(analyzeRobotsTxt('User-agent: *\nDisallow: /\nAllow: /public/').blocksAll).toBe(false);
    expect(analyzeRobotsTxt('User-agent: *\nDisallow:').blocksAll).toBe(false);
  });

  it('recognises XML sitemaps', () => {
    expect(looksLikeSitemap('<?xml version="1.0"?><urlset xmlns="...">')).toBe(true);
    expect(looksLikeSitemap('<sitemapindex>')).toBe(true);
    expect(looksLikeSitemap('<!doctype html><html>Not found</html>')).toBe(false);
  });

  const facts = (overrides: {
    robots?: Partial<SiteSeoFacts['robotsTxt']>;
    sitemap?: Partial<SiteSeoFacts['sitemap']>;
  }): SiteSeoFacts => ({
    robotsTxt: {
      url: 'https://shop.example/robots.txt',
      status: 200,
      found: true,
      blocksAll: false,
      sitemaps: [],
      ...overrides.robots,
    },
    sitemap: {
      url: 'https://shop.example/sitemap.xml',
      status: 200,
      found: true,
      validXml: true,
      source: 'default',
      ...overrides.sitemap,
    },
  });

  it('creates site-level issues only from real evidence', () => {
    expect(siteSeoDrafts('w1', 'https://shop.example/', facts({}))).toEqual([]);
    expect(
      checks(
        siteSeoDrafts(
          'w1',
          'https://shop.example/',
          facts({
            robots: { status: 404, found: false },
            sitemap: { status: 404, found: false, validXml: false },
          }),
        ),
      ),
    ).toEqual(['MISSING_ROBOTS_TXT', 'MISSING_SITEMAP']);
    expect(
      checks(siteSeoDrafts('w1', 'https://shop.example/', facts({ robots: { blocksAll: true } }))),
    ).toEqual(['ROBOTS_BLOCKS_ALL']);
    expect(
      checks(siteSeoDrafts('w1', 'https://shop.example/', facts({ sitemap: { validXml: false } }))),
    ).toEqual(['MISSING_SITEMAP']);
  });

  it('does not claim a file is missing when the request failed or was blocked', () => {
    expect(
      siteSeoDrafts(
        'w1',
        'https://shop.example/',
        facts({
          robots: { status: null, found: false },
          sitemap: { status: null, found: false, validXml: false },
        }),
      ),
    ).toEqual([]);
  });
});
