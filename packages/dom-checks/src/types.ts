export type DomCheckName =
  | 'BROKEN_IMAGE'
  | 'HORIZONTAL_SCROLL'
  | 'CONTENT_OVERFLOW'
  | 'OUT_OF_VIEWPORT'
  | 'TEXT_CLIPPING'
  | 'OVERLAPPING_ELEMENTS'
  | 'EMPTY_BUTTON'
  | 'EMPTY_LINK'
  | 'IMAGE_SIZING';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomFinding {
  check: DomCheckName;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  message: string;
  selector: string;
  html: string;
  box: Box | null;
  measurements?: Record<string, number | string | boolean>;
}

export interface LinkInfo {
  href: string;
  text: string;
  selector: string;
  html: string;
}

export interface SeoSnapshot {
  /** <meta name="robots"> content, e.g. "noindex, nofollow". */
  metaRobots: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  /** Headings in document order (max 100), for the outline check. */
  headings: { level: number; text: string }[];
  imagesTotal: number;
  /** <img> without an alt attribute that are not hidden from assistive tech. */
  imagesWithoutAlt: number;
}

export interface InsecureReference {
  /** "active" can change the page (scripts, styles, frames, forms); "passive" is media. */
  kind: 'active' | 'passive' | 'form';
  tag: string;
  url: string;
  selector: string;
}

export interface PageSnapshot {
  title: string;
  lang: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1Count: number;
  /** On-page SEO facts (desktop pass only; empty defaults in layout mode). */
  seo: SeoSnapshot;
  /** Plain-http references on an https page (mixed content). Empty on http pages. */
  insecureReferences: InsecureReference[];
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  links: LinkInfo[];
}

export interface DomCheckOptions {
  /** "all" on the desktop pass; "layout" for the extra screen sizes. */
  mode: 'all' | 'layout';
  /** Elements already reported by axe-core (e.g. button-name), to avoid duplicate issues. */
  skipSelectors?: string[];
  /** Maximum findings per check (keeps reports readable on huge pages). */
  maxPerCheck?: number;
  /** Maximum links collected for crawling/link checking. */
  maxLinks?: number;
}

export interface DomCheckResult {
  findings: DomFinding[];
  snapshot: PageSnapshot;
}
