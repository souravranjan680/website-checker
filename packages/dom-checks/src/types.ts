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

export interface PageSnapshot {
  title: string;
  lang: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1Count: number;
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
