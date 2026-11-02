import { VIEWPORTS } from '@whc/shared';

export interface ViewportSpec {
  label: string; // "390x844"
  name: string; // "Mobile"
  width: number;
  height: number;
  mobile: boolean;
}

/** The five screen sizes from Module 7. The first (desktop) is used for the main crawl. */
export const SCAN_VIEWPORTS: ViewportSpec[] = VIEWPORTS.map((v) => ({
  label: `${v.width}x${v.height}`,
  name: v.name,
  width: v.width,
  height: v.height,
  mobile: v.width < 800,
}));

/** Set by the egress proxy on responses it produced itself (blocked or unreachable). */
export const BLOCKED_RESPONSE_HEADER = 'x-whc-egress-blocked';
