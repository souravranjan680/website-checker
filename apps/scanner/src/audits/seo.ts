import { randomUUID } from 'node:crypto';
import type { SeoSnapshot } from '@whc/dom-checks';
import { fingerprint, type IssueDraft, type Severity } from '../issues';

/**
 * On-page technical SEO. Every check reads facts the scanner already collected
 * (the page's <head>, headings, robots.txt, sitemap); nothing is guessed.
 * This is not ranking advice: content quality, backlinks etc. are out of scope.
 */

export type SeoCheck =
  | 'MISSING_TITLE'
  | 'DUPLICATE_TITLE'
  | 'TITLE_LENGTH'
  | 'MISSING_META_DESCRIPTION'
  | 'DUPLICATE_META_DESCRIPTION'
  | 'META_DESCRIPTION_LENGTH'
  | 'MISSING_H1'
  | 'MULTIPLE_H1'
  | 'SKIPPED_HEADING_LEVEL'
  | 'MISSING_CANONICAL'
  | 'INVALID_CANONICAL'
  | 'NOINDEX'
  | 'MISSING_OPEN_GRAPH'
  | 'MISSING_IMAGE_ALT'
  | 'MISSING_ROBOTS_TXT'
  | 'ROBOTS_BLOCKS_ALL'
  | 'MISSING_SITEMAP';

/** Recommended lengths (what search results usually show). */
export const TITLE_RANGE = { min: 10, max: 60 };
export const DESCRIPTION_RANGE = { min: 50, max: 160 };

const TEXT: Record<SeoCheck, { title: string; severity: Severity; fix: string }> = {
  MISSING_TITLE: {
    title: 'Page has no title',
    severity: 'HIGH',
    fix: 'Add a unique, descriptive <title> inside <head>, e.g. <title>Pricing | Example Shop</title>. Search engines show it as the clickable headline.',
  },
  DUPLICATE_TITLE: {
    title: 'Several pages share the same title',
    severity: 'MEDIUM',
    fix: 'Give every page its own title that describes that page. Identical titles make it hard for search engines (and people with many tabs open) to tell pages apart.',
  },
  TITLE_LENGTH: {
    title: 'Title is very short or long',
    severity: 'LOW',
    fix: `Aim for roughly ${TITLE_RANGE.min}–${TITLE_RANGE.max} characters. Longer titles are usually cut off in search results; very short ones say little about the page.`,
  },
  MISSING_META_DESCRIPTION: {
    title: 'Page has no meta description',
    severity: 'MEDIUM',
    fix: 'Add <meta name="description" content="..."> with a one or two sentence summary of the page. Search engines often show it under the title.',
  },
  DUPLICATE_META_DESCRIPTION: {
    title: 'Several pages share the same meta description',
    severity: 'LOW',
    fix: 'Write a description specific to each page, or leave it out on pages where you cannot (search engines then pick text from the page).',
  },
  META_DESCRIPTION_LENGTH: {
    title: 'Meta description is very short or long',
    severity: 'LOW',
    fix: `Aim for roughly ${DESCRIPTION_RANGE.min}–${DESCRIPTION_RANGE.max} characters so the summary is useful and not cut off.`,
  },
  MISSING_H1: {
    title: 'Page has no main heading (h1)',
    severity: 'MEDIUM',
    fix: 'Add one <h1> that states what the page is about. It helps search engines and screen-reader users understand the page.',
  },
  MULTIPLE_H1: {
    title: 'Page has more than one h1',
    severity: 'LOW',
    fix: 'Usually keep a single <h1> for the page topic and use <h2>–<h6> for sections.',
  },
  SKIPPED_HEADING_LEVEL: {
    title: 'Heading levels are skipped',
    severity: 'LOW',
    fix: 'Do not jump levels (e.g. h2 straight to h4). Nest headings in order so the page outline makes sense; change the look with CSS instead.',
  },
  MISSING_CANONICAL: {
    title: 'Page has no canonical URL',
    severity: 'LOW',
    fix: 'Add <link rel="canonical" href="https://..."> with the preferred address of this page, so versions with tracking parameters are treated as one page.',
  },
  INVALID_CANONICAL: {
    title: 'Canonical URL is invalid or points to another website',
    severity: 'MEDIUM',
    fix: 'Make the canonical link an absolute https:// address of this page (or of the page it duplicates on the same site). If pointing to another site is intended, mark this as ignored.',
  },
  NOINDEX: {
    title: 'Page asks search engines not to index it',
    severity: 'MEDIUM',
    fix: 'If this page should appear in search results, remove "noindex" from <meta name="robots"> or the X-Robots-Tag header. If hiding it is intended (e.g. a thank-you page), ignore this issue.',
  },
  MISSING_OPEN_GRAPH: {
    title: 'Open Graph tags are missing',
    severity: 'LOW',
    fix: 'Add og:title, og:description and og:image meta tags so links shared on social media show a proper preview.',
  },
  MISSING_IMAGE_ALT: {
    title: 'Images without alt text',
    severity: 'LOW',
    fix: 'Give every meaningful image an alt attribute that describes it (alt="" for decorative images). Search engines use alt text to understand images; see the accessibility report for each image.',
  },
  MISSING_ROBOTS_TXT: {
    title: 'No robots.txt file',
    severity: 'LOW',
    fix: 'Optional but recommended: add /robots.txt (even just "User-agent: *" and "Allow: /") with a "Sitemap:" line pointing to your sitemap.',
  },
  ROBOTS_BLOCKS_ALL: {
    title: 'robots.txt blocks the whole site',
    severity: 'HIGH',
    fix: 'robots.txt contains "Disallow: /" for all crawlers, so search engines will not crawl any page. Remove it unless the site must stay out of search engines.',
  },
  MISSING_SITEMAP: {
    title: 'No XML sitemap found',
    severity: 'LOW',
    fix: 'Publish a sitemap (e.g. /sitemap.xml) listing your pages, and reference it from robots.txt with "Sitemap: https://.../sitemap.xml".',
  },
};

export function seoText(check: SeoCheck) {
  return TEXT[check];
}

/** The desktop viewport label: SEO facts are read in the desktop pass. */
const VIEWPORT = '1920x1080';

function seoDraft(
  check: SeoCheck,
  ctx: { websiteId: string; pageUrl: string },
  values: {
    description: string;
    expected?: string | null;
    actual?: string | null;
    target?: string;
    details?: Record<string, unknown>;
    severity?: Severity;
  },
): IssueDraft {
  const ruleId = `seo/${check.toLowerCase().replace(/_/g, '-')}`;
  const text = TEXT[check];
  return {
    id: randomUUID(),
    category: 'SEO',
    severity: values.severity ?? text.severity,
    ruleId,
    title: text.title,
    description: values.description,
    pageUrl: ctx.pageUrl,
    viewport: VIEWPORT,
    selector: null,
    htmlSnippet: null,
    boundingBox: null,
    suggestedFix: text.fix,
    details: values.details ?? null,
    fingerprint: fingerprint({
      websiteId: ctx.websiteId,
      category: 'SEO',
      ruleId,
      pageUrl: ctx.pageUrl,
      viewport: VIEWPORT,
      target: values.target ?? check,
    }),
    seo: { checkType: check, expected: values.expected ?? null, actual: values.actual ?? null },
  };
}

export interface SeoPageInput {
  scanPageId: string;
  url: string;
  title: string;
  metaDescription: string | null;
  canonical: string | null;
  h1Count: number;
  /** X-Robots-Tag response header, if any. */
  xRobotsTag: string | null;
  seo: SeoSnapshot;
}

const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** "h2 → h4" style: the first place the outline jumps more than one level down. */
export function firstSkippedHeading(
  headings: { level: number; text: string }[],
): { from: number; to: number; text: string } | null {
  let previous = 0;
  for (const heading of headings) {
    if (previous > 0 && heading.level > previous + 1) {
      return { from: previous, to: heading.level, text: heading.text };
    }
    previous = heading.level;
  }
  return null;
}

/** Checks that need only one page. */
export function pageSeoDrafts(
  websiteId: string,
  page: SeoPageInput,
  siteHostname: string,
): IssueDraft[] {
  const ctx = { websiteId, pageUrl: page.url };
  const drafts: IssueDraft[] = [];
  const title = clean(page.title);
  const description = clean(page.metaDescription);

  if (!title) {
    drafts.push(
      seoDraft('MISSING_TITLE', ctx, {
        description: 'The page has no <title>, or it is empty.',
        expected: 'A descriptive title',
        actual: '(none)',
      }),
    );
  } else if (title.length < TITLE_RANGE.min || title.length > TITLE_RANGE.max) {
    drafts.push(
      seoDraft('TITLE_LENGTH', ctx, {
        description: `The title is ${title.length} characters long: "${title.slice(0, 120)}".`,
        expected: `${TITLE_RANGE.min}–${TITLE_RANGE.max} characters`,
        actual: `${title.length} characters`,
      }),
    );
  }

  if (!description) {
    drafts.push(
      seoDraft('MISSING_META_DESCRIPTION', ctx, {
        description: 'The page has no meta description, or it is empty.',
        expected: 'A one or two sentence summary',
        actual: '(none)',
      }),
    );
  } else if (
    description.length < DESCRIPTION_RANGE.min ||
    description.length > DESCRIPTION_RANGE.max
  ) {
    drafts.push(
      seoDraft('META_DESCRIPTION_LENGTH', ctx, {
        description: `The meta description is ${description.length} characters long.`,
        expected: `${DESCRIPTION_RANGE.min}–${DESCRIPTION_RANGE.max} characters`,
        actual: `${description.length} characters`,
      }),
    );
  }

  if (page.h1Count === 0) {
    drafts.push(
      seoDraft('MISSING_H1', ctx, {
        description: 'The page has no <h1> heading.',
        expected: '1',
        actual: '0',
      }),
    );
  } else if (page.h1Count > 1) {
    drafts.push(
      seoDraft('MULTIPLE_H1', ctx, {
        description: `The page has ${page.h1Count} <h1> headings.`,
        expected: '1',
        actual: String(page.h1Count),
      }),
    );
  }

  const skipped = firstSkippedHeading(page.seo.headings);
  if (skipped) {
    drafts.push(
      seoDraft('SKIPPED_HEADING_LEVEL', ctx, {
        description: `The outline jumps from h${skipped.from} to h${skipped.to} at "${skipped.text || '(empty heading)'}".`,
        expected: `h${skipped.from + 1}`,
        actual: `h${skipped.to}`,
      }),
    );
  }

  const canonical = clean(page.canonical);
  if (!canonical) {
    drafts.push(
      seoDraft('MISSING_CANONICAL', ctx, {
        description: 'No <link rel="canonical"> was found.',
        expected: 'An absolute URL',
        actual: '(none)',
      }),
    );
  } else {
    const resolved = URL.canParse(canonical, page.url) ? new URL(canonical, page.url) : null;
    const sameSite = (host: string) =>
      host.replace(/^www\./, '') === siteHostname.replace(/^www\./, '');
    if (!resolved || !/^https?:$/.test(resolved.protocol)) {
      drafts.push(
        seoDraft('INVALID_CANONICAL', ctx, {
          description: `The canonical link "${canonical.slice(0, 200)}" is not a valid web address.`,
          expected: 'An absolute https:// URL',
          actual: canonical.slice(0, 200),
        }),
      );
    } else if (!sameSite(resolved.hostname)) {
      drafts.push(
        seoDraft('INVALID_CANONICAL', ctx, {
          description: `The canonical link points to another website (${resolved.hostname}).`,
          expected: `A page on ${siteHostname}`,
          actual: resolved.href.slice(0, 200),
        }),
      );
    }
  }

  const robotsDirectives = [page.seo.metaRobots, page.xRobotsTag]
    .filter(Boolean)
    .join(', ')
    .toLowerCase();
  if (/\bnoindex\b|\bnone\b/.test(robotsDirectives)) {
    drafts.push(
      seoDraft('NOINDEX', ctx, {
        description: `Robots directive: "${robotsDirectives.slice(0, 200)}" (${page.seo.metaRobots ? 'meta tag' : 'X-Robots-Tag header'}).`,
        expected: 'index (or no directive)',
        actual: robotsDirectives.slice(0, 200),
      }),
    );
  }

  const missingOg = [
    ['og:title', page.seo.ogTitle],
    ['og:description', page.seo.ogDescription],
    ['og:image', page.seo.ogImage],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);
  if (missingOg.length > 0) {
    drafts.push(
      seoDraft('MISSING_OPEN_GRAPH', ctx, {
        description: `Missing: ${missingOg.join(', ')}.`,
        expected: 'og:title, og:description, og:image',
        actual: `missing ${missingOg.join(', ')}`,
      }),
    );
  }

  if (page.seo.imagesWithoutAlt > 0) {
    drafts.push(
      seoDraft('MISSING_IMAGE_ALT', ctx, {
        description: `${page.seo.imagesWithoutAlt} of ${page.seo.imagesTotal} images have no alt attribute.`,
        expected: '0 images without alt',
        actual: String(page.seo.imagesWithoutAlt),
        details: { imagesWithoutAlt: page.seo.imagesWithoutAlt, imagesTotal: page.seo.imagesTotal },
      }),
    );
  }
  return drafts;
}

/** Titles and descriptions used by more than one scanned page. Returns drafts per scanPageId. */
export function duplicateSeoDrafts(
  websiteId: string,
  pages: SeoPageInput[],
): Map<string, IssueDraft[]> {
  const result = new Map<string, IssueDraft[]>();
  const add = (pageId: string, draft: IssueDraft) =>
    result.set(pageId, [...(result.get(pageId) ?? []), draft]);

  for (const [check, pick] of [
    ['DUPLICATE_TITLE', (p: SeoPageInput) => clean(p.title)],
    ['DUPLICATE_META_DESCRIPTION', (p: SeoPageInput) => clean(p.metaDescription)],
  ] as const) {
    const groups = new Map<string, SeoPageInput[]>();
    for (const page of pages) {
      const value = pick(page);
      if (!value) continue;
      const key = value.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), page]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const page of group) {
        const others = group.filter((p) => p !== page).map((p) => p.url);
        const value = pick(page);
        add(
          page.scanPageId,
          seoDraft(
            check,
            { websiteId, pageUrl: page.url },
            {
              description: `"${value.slice(0, 120)}" is also used by ${others.length} other page${others.length === 1 ? '' : 's'}: ${others.slice(0, 3).join(', ')}${others.length > 3 ? ', …' : ''}.`,
              expected: 'Unique per page',
              actual: `Shared with ${others.length} page${others.length === 1 ? '' : 's'}`,
              target: value.toLowerCase(),
              details: { sharedWith: others.slice(0, 20) },
            },
          ),
        );
      }
    }
  }
  return result;
}

// ------------------------------------------------------------- site files

export interface SiteFileResult {
  url: string;
  /** HTTP status, or null when the request failed (blocked, timeout, DNS). */
  status: number | null;
  found: boolean;
  error?: string;
}

export interface RobotsFacts extends SiteFileResult {
  blocksAll: boolean;
  sitemaps: string[];
}

export interface SitemapFacts extends SiteFileResult {
  /** Where the address came from: a "Sitemap:" line in robots.txt or the default /sitemap.xml. */
  source: 'robots.txt' | 'default';
  validXml: boolean;
}

export interface SiteSeoFacts {
  robotsTxt: RobotsFacts;
  sitemap: SitemapFacts;
}

/** Reads the "User-agent: *" group: does it disallow everything? Plus all Sitemap: lines. */
export function analyzeRobotsTxt(text: string): { blocksAll: boolean; sitemaps: string[] } {
  const sitemaps: string[] = [];
  let groupApplies = false;
  let lastWasAgent = false;
  let disallowAll = false;
  let allowSomething = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      groupApplies = lastWasAgent ? groupApplies || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!groupApplies) continue;
    if (key === 'disallow' && value === '/') disallowAll = true;
    if (key === 'allow' && value !== '') allowSomething = true;
  }
  return { blocksAll: disallowAll && !allowSomething, sitemaps };
}

/** A sitemap must be XML with <urlset> or <sitemapindex> (plain-text sitemaps are rare). */
export function looksLikeSitemap(text: string): boolean {
  return /<(urlset|sitemapindex)[\s>]/i.test(text.slice(0, 5000));
}

/** Site-level issues (attached to the start page URL, no page row). */
export function siteSeoDrafts(
  websiteId: string,
  startUrl: string,
  facts: SiteSeoFacts,
): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  const ctx = { websiteId, pageUrl: startUrl };
  const { robotsTxt, sitemap } = facts;
  // A failed request (blocked, timeout) is not evidence that the file is missing.
  if (robotsTxt.status !== null && !robotsTxt.found) {
    drafts.push(
      seoDraft('MISSING_ROBOTS_TXT', ctx, {
        description: `${robotsTxt.url} returned HTTP ${robotsTxt.status}.`,
        expected: 'HTTP 200',
        actual: `HTTP ${robotsTxt.status}`,
        target: 'site',
      }),
    );
  }
  if (robotsTxt.found && robotsTxt.blocksAll) {
    drafts.push(
      seoDraft('ROBOTS_BLOCKS_ALL', ctx, {
        description: `${robotsTxt.url} contains "Disallow: /" for all crawlers.`,
        expected: 'Crawling allowed',
        actual: 'Disallow: /',
        target: 'site',
      }),
    );
  }
  if (sitemap.status !== null && (!sitemap.found || !sitemap.validXml)) {
    drafts.push(
      seoDraft('MISSING_SITEMAP', ctx, {
        description: sitemap.found
          ? `${sitemap.url} was found but is not an XML sitemap (no <urlset> or <sitemapindex>).`
          : `No sitemap: ${sitemap.url} returned HTTP ${sitemap.status}${sitemap.source === 'default' ? ' and robots.txt lists none' : ''}.`,
        expected: 'An XML sitemap (HTTP 200)',
        actual: sitemap.found ? 'Not XML' : `HTTP ${sitemap.status}`,
        target: 'site',
      }),
    );
  }
  return drafts;
}
