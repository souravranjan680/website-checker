/**
 * Shared pieces of the cross-browser comparison (Phase 9, Milestone 3, Checkpoint 2) that
 * need no DOM: element identity and CSS declaration shapes, and URL normalization. Used
 * in the page (compat-facts.ts) and by the scanner (compat-diff.ts).
 */

/**
 * How one element can be recognised in another browser's copy of the page. Each level is
 * set only if it identifies exactly one element in its own page.
 */
export interface ElementIdentity {
  /** A stable attribute: id, data-testid, name, aria-label, for, or a normalized href/src. */
  attribute: string | null;
  /** Tag + stable class names up to <body>, with the element's text. */
  path: string | null;
  /** The generated CSS selector. */
  selector: string | null;
}

export interface CssDeclaration {
  property: string;
  value: string;
  selector: string;
}

/**
 * Query parameters that only track visits (advertising and analytics). Everything else in
 * a query is kept: it may decide what the server sends.
 */
export const TRACKING_PARAMETERS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
]);

/** A URL without its fragment and without known tracking parameters (order kept). */
export function normalizeResourceUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = '';
  const kept = [...parsed.searchParams.entries()].filter(
    ([name]) => !TRACKING_PARAMETERS.has(name.toLowerCase()),
  );
  parsed.search = '';
  for (const [name, value] of kept) parsed.searchParams.append(name, value);
  return parsed.href;
}
