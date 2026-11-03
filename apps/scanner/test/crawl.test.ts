/** crawlSite(): the crawl rules, with a fake site instead of a browser. */
import { describe, expect, it } from 'vitest';
import { crawlSite, type CrawlTarget } from '../src/crawler/crawl';
import { ALLOW_ALL, parseRobotsTxt } from '../src/crawler/robots';
import { compilePatterns } from '../src/crawler/urls';

const SITE = 'https://site.test';
/** page path → links on it (redirects: "/old" → finalUrl "/new"). */
const PAGES: Record<string, string[]> = {
  '/': ['/a', '/b', '/a#top', 'https://other.test/x', '/file.pdf', '/private/p', '/old'],
  '/a': ['/a/1', '/b', '/'],
  '/b': ['/b/1'],
  '/a/1': ['/a/1/deep'],
  '/b/1': [],
  '/new': ['/new/child'],
};

async function crawl(overrides: Partial<Parameters<typeof crawlSite>[0]> = {}) {
  const visits: CrawlTarget[] = [];
  const state = await crawlSite({
    startUrl: `${SITE}/`,
    siteHostname: 'site.test',
    maxPages: 20,
    maxDepth: 2,
    include: [],
    exclude: [],
    robots: ALLOW_ALL,
    checkpoint: () => {},
    shouldStop: () => false,
    visit: async (target) => {
      visits.push(target);
      const path = new URL(target.url).pathname;
      const finalPath = path === '/old' ? '/new' : path;
      const links = PAGES[finalPath];
      return {
        finalUrl: `${SITE}${finalPath}`,
        links: links ? links.map((l) => new URL(l, SITE).toString()) : null,
      };
    },
    ...overrides,
  });
  return { state, paths: visits.map((v) => `${new URL(v.url).pathname}@${v.depth}`) };
}

describe('crawlSite', () => {
  it('visits breadth-first, once per address, same site and HTML only, within depth', async () => {
    const { paths } = await crawl();
    // /old redirects to /new: the links of the final page are followed.
    expect(paths).toEqual([
      '/@0',
      '/a@1',
      '/b@1',
      '/private/p@1',
      '/old@1',
      '/a/1@2',
      '/b/1@2',
      '/new/child@2',
    ]);
  });

  it('treats a redirect target as known (not visited again)', async () => {
    const { paths } = await crawl({ maxDepth: 3 });
    expect(paths.filter((p) => p.startsWith('/new@'))).toEqual([]); // reached via /old only
    expect(paths).toContain('/a/1/deep@3');
  });

  it('respects include/exclude patterns and robots.txt', async () => {
    const excluded = await crawl({ exclude: compilePatterns(['/private/*']) });
    expect(excluded.paths).not.toContain('/private/p@1');
    const robots = await crawl({ robots: parseRobotsTxt('User-agent: *\nDisallow: /b') });
    expect(robots.paths.some((p) => p.startsWith('/b'))).toBe(false);
  });

  it('stops at maxPages, at the time limit, and on cancel', async () => {
    expect((await crawl({ maxPages: 2 })).paths).toEqual(['/@0', '/a@1']);
    let calls = 0;
    expect((await crawl({ shouldStop: () => ++calls > 3 })).paths).toHaveLength(3);
    await expect(
      crawl({
        checkpoint: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('does not follow links of pages that were not scanned', async () => {
    const seen: string[] = [];
    await crawl({
      visit: async (target) => {
        seen.push(new URL(target.url).pathname);
        return { finalUrl: target.url, links: null };
      },
    });
    expect(seen).toEqual(['/']);
  });

  it('keeps the queue bounded at 3 × maxPages known addresses', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `${SITE}/p${i}`);
    const { state } = await crawl({
      maxPages: 4,
      visit: async (target) => ({ finalUrl: target.url, links: many }),
    });
    expect(state.discovered).toBe(12);
    expect(state.visitedCount).toBe(4);
  });
});
