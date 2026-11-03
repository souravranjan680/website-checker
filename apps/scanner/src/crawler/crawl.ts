import type { RobotsRules } from './robots';
import { isSameSite, looksLikeHtml, normalizeUrl, pathAllowed, pathOf } from './urls';

export interface CrawlTarget {
  url: string;
  depth: number;
}

/** What the crawler knows so far; read by the visit callback (e.g. for progress). */
export interface CrawlState {
  /** Pages visited so far (any outcome). */
  visitedCount: number;
  /** Distinct addresses known: visited, queued and redirect targets. */
  discovered: number;
}

export interface CrawlVisit {
  /** Address after redirects (also marked as known, so it is not visited again). */
  finalUrl: string;
  /** Links found on the page, in page order; null when the page was not scanned. */
  links: string[] | null;
}

/**
 * Breadth-first crawl of one website: start URL first, then same-site links up to
 * `maxDepth`, until `maxPages` pages were visited or `shouldStop()` says so.
 *
 * Only the bookkeeping lives here (queue, known addresses, depth, limits, robots,
 * include/exclude). What happens on each page is the caller's `visit` callback:
 * the health scan scans it; page discovery for comparisons only reads its links.
 * The rules are exactly those of the original loop in runScan (Phase 4).
 */
export async function crawlSite(options: {
  startUrl: string;
  siteHostname: string;
  maxPages: number;
  maxDepth: number;
  include: RegExp[];
  exclude: RegExp[];
  robots: RobotsRules;
  /** Called before each page; may throw to cancel (the error propagates). */
  checkpoint: () => void;
  /** Time limit reached: finish with the pages visited so far. */
  shouldStop: () => boolean;
  visit: (target: CrawlTarget, state: CrawlState) => Promise<CrawlVisit>;
  /** Called after each page, once its links are queued. */
  afterVisit?: (state: CrawlState) => Promise<void>;
}): Promise<CrawlState> {
  const queue: CrawlTarget[] = [{ url: options.startUrl, depth: 0 }];
  const known = new Set<string>([options.startUrl]);
  let visitedCount = 0;
  const state = (): CrawlState => ({ visitedCount, discovered: known.size });

  while (queue.length > 0 && visitedCount < options.maxPages && !options.shouldStop()) {
    options.checkpoint();
    const target = queue.shift()!;
    const result = await options.visit(target, state());
    visitedCount += 1;
    const finalNormalized = normalizeUrl(result.finalUrl);
    if (finalNormalized) known.add(finalNormalized);

    for (const link of result.links ?? []) {
      const href = normalizeUrl(link);
      if (!href) continue;
      if (target.depth >= options.maxDepth || known.has(href)) continue;
      if (!isSameSite(href, options.siteHostname) || !looksLikeHtml(href)) continue;
      if (!pathAllowed(href, options.include, options.exclude)) continue;
      if (!options.robots.allows(pathOf(href))) continue;
      if (known.size >= options.maxPages * 3) continue; // keep the queue bounded
      known.add(href);
      queue.push({ url: href, depth: target.depth + 1 });
    }
    await options.afterVisit?.(state());
  }
  return state();
}
