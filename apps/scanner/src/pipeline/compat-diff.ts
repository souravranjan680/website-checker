/**
 * The cross-browser comparison (Phase 9, Milestone 3, Checkpoint 2). Pure: compares what
 * Chromium saw on a page with what another engine saw on the same page, at the same size
 * and at the same moment, and classifies what only the other engine has.
 *
 * Rules (approved):
 *   - Elements are matched by identity levels (stable attribute, DOM path + text, generated
 *     selector), each set only when unique in its own page. One match = the same element;
 *     several matches, or an element with no unique identity = ambiguous → INCONCLUSIVE.
 *   - Never compared: pixels, sizes, text widths, line breaks, console wording.
 *   - Exceptions are matched by script and line (wording differs between engines).
 *   - Failed requests: proxy blocks, aborted requests and network errors are not browser
 *     defects (left out); 5xx, 408 and 429 are temporary → INCONCLUSIVE.
 *   - CSS: only what the engine itself reports as unsupported (CSS.supports), for
 *     declarations the page applies → OBSERVATION, never a defect.
 *   - A difference is claimed only if a second load of both browsers shows it again
 *     (confirmDifferences); otherwise INCONCLUSIVE.
 */
import { normalizeResourceUrl, type CssDeclaration, type ElementIdentity } from '@whc/dom-checks';

export type CompatCheck =
  | 'BROWSER_ONLY_ERROR'
  | 'BROWSER_ONLY_RESOURCE_FAILURE'
  | 'BROWSER_ONLY_FONT_FAILURE'
  | 'BROWSER_ONLY_LAYOUT'
  | 'BROWSER_ONLY_ACCESSIBILITY'
  | 'UNSUPPORTED_CSS';

export type Strength = 'DETECTED' | 'POTENTIAL_DEFECT' | 'OBSERVATION' | 'INCONCLUSIVE';
export type MatchMethod = 'attribute' | 'path' | 'selector';

/** A located finding (UI, layout or accessibility) with its identity in its own page. */
export interface LocatedFact {
  check: string;
  selector: string;
  html: string;
  identity: ElementIdentity | null;
}

/** The facts the comparison needs from one engine's capture of one page. */
export interface ComparableFacts {
  exceptions: { message: string; source: string | null; line: number | null }[];
  failedRequests: {
    url: string;
    resourceType: string;
    status: number | null;
    error: string | null;
    blockedByPolicy: boolean;
  }[];
  fonts: { family: string; weight: string; style: string; status: string; sources: string[] }[];
  ui: LocatedFact[];
  layout: LocatedFact[];
  accessibility: LocatedFact[];
  /** Declarations Chromium applies, with this engine's own support verdict (other engine only). */
  cssSupport?: (CssDeclaration & { supported: boolean })[];
}

export interface Difference {
  check: CompatCheck;
  /** Stable across loads and scans: what the difference is about. */
  key: string;
  classification: Strength;
  /** The check or rule underneath (e.g. "HORIZONTAL_SCROLL", "color-contrast"). */
  underlying: string | null;
  summary: string;
  selector: string | null;
  html: string | null;
  matchMethod: MatchMethod | null;
  evidence: Record<string, unknown>;
}

const LEVELS: MatchMethod[] = ['attribute', 'path', 'selector'];
const identified = (id: ElementIdentity | null) =>
  Boolean(id && (id.attribute || id.path || id.selector));

/**
 * Is this finding (seen in the other engine) also in Chromium's list for the same check?
 * "matched" (exactly one counterpart), "absent" (the element is identifiable and no
 * counterpart has the finding) or "ambiguous" (cannot tell reliably).
 */
export function matchElement(
  fact: LocatedFact,
  baseline: LocatedFact[],
): { status: 'matched' | 'absent' | 'ambiguous'; method: MatchMethod | null } {
  if (!identified(fact.identity)) return { status: 'ambiguous', method: null };
  const sameCheck = baseline.filter((b) => b.check === fact.check);
  const hits = new Set<LocatedFact>();
  let method: MatchMethod | null = null;
  for (const level of LEVELS) {
    const value = fact.identity![level];
    if (!value) continue;
    for (const b of sameCheck) {
      if (b.identity?.[level] === value) {
        hits.add(b);
        method ??= level;
      }
    }
  }
  if (hits.size === 1) return { status: 'matched', method };
  if (hits.size > 1) return { status: 'ambiguous', method: null };
  // A Chromium finding of the same check that cannot be identified might be this element.
  if (sameCheck.some((b) => !identified(b.identity))) return { status: 'ambiguous', method: null };
  return { status: 'absent', method: LEVELS.find((level) => fact.identity![level]) ?? null };
}

/** The identity value used in keys (the first unique level). */
const identityKey = (id: ElementIdentity | null) =>
  id ? (id.attribute ?? id.path ?? id.selector ?? '?') : '?';

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
const sameSite = (host: string | null, site: string) =>
  Boolean(host && (host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`)));

/** A message without things that change from load to load (numbers, quoted ids). */
export function normalizeMessage(message: string): string {
  return message.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const OBJECTIVE_UI = new Set(['HORIZONTAL_SCROLL', 'BROKEN_IMAGE', 'EMPTY_BUTTON', 'EMPTY_LINK']);
const ACCESSIBILITY_UI = new Set(['EMPTY_BUTTON', 'EMPTY_LINK']);

/** What only the other engine has, classified (before confirmation). */
export function compareFacts(
  base: ComparableFacts,
  other: ComparableFacts,
  siteHostname: string,
): Difference[] {
  const out: Difference[] = [];

  // ------------------------------------------------------------------ exceptions
  const location = (e: { source: string | null; line: number | null }) =>
    e.source ? `${pathOf(e.source)}:${e.line ?? '?'}` : null;
  const baseLocations = new Set(base.exceptions.map(location).filter(Boolean));
  const baseMessages = new Set(base.exceptions.map((e) => normalizeMessage(e.message)));
  for (const e of other.exceptions.slice(0, 20)) {
    const loc = location(e);
    if (loc ? baseLocations.has(loc) : baseMessages.has(normalizeMessage(e.message))) continue;
    const thirdParty = e.source !== null && !sameSite(hostOf(e.source), siteHostname);
    out.push({
      check: 'BROWSER_ONLY_ERROR',
      key: `error|${loc ?? normalizeMessage(e.message)}`,
      classification: !loc ? 'INCONCLUSIVE' : thirdParty ? 'OBSERVATION' : 'DETECTED',
      underlying: null,
      summary: `Uncaught error: ${e.message.slice(0, 200)}${e.source ? ` (${e.source}${e.line ? `:${e.line}` : ''})` : ''}`,
      selector: null,
      html: null,
      matchMethod: null,
      evidence: {
        error: e,
        why: !loc
          ? 'the error has no script location, so it cannot be matched reliably'
          : thirdParty
            ? 'thrown by another site’s script'
            : 'thrown by the site’s own script; not thrown at this location in Chromium',
      },
    });
  }

  // ------------------------------------------------------------- fonts (before resources)
  const fontKey = (f: { family: string; weight: string; style: string }) =>
    `${f.family}|${f.weight}|${f.style}`;
  const baseFonts = new Map(base.fonts.map((f) => [fontKey(f), f]));
  const failedFontSources = new Set<string>();
  for (const f of other.fonts) {
    if (f.status !== 'error') continue;
    f.sources.forEach((s) => failedFontSources.add(normalizeResourceUrl(s)));
    const inBase = baseFonts.get(fontKey(f));
    if (inBase?.status === 'error') continue;
    out.push({
      check: 'BROWSER_ONLY_FONT_FAILURE',
      key: `font|${fontKey(f)}`,
      classification: 'DETECTED',
      underlying: null,
      summary: `The web font “${f.family}” (${f.weight} ${f.style}) failed to load in this browser, but not in Chromium.`,
      selector: null,
      html: null,
      matchMethod: null,
      evidence: { font: f, chromium: inBase ?? null },
    });
  }

  // ------------------------------------------------------------------- resources
  const baseFailed = new Set(base.failedRequests.map((r) => normalizeResourceUrl(r.url)));
  for (const r of other.failedRequests) {
    const url = normalizeResourceUrl(r.url);
    // Not browser defects: the proxy's own refusals, aborted requests, network failures.
    if (r.blockedByPolicy) continue;
    if (r.status === null) continue;
    if (failedFontSources.has(url)) continue; // reported as the font failure
    if (baseFailed.has(url)) continue;
    const temporary = r.status >= 500 || r.status === 408 || r.status === 429;
    const own = sameSite(hostOf(r.url), siteHostname);
    out.push({
      check: 'BROWSER_ONLY_RESOURCE_FAILURE',
      key: `resource|${url}`,
      classification: temporary ? 'INCONCLUSIVE' : own ? 'DETECTED' : 'OBSERVATION',
      underlying: r.resourceType,
      summary: `${r.url} failed with HTTP ${r.status} in this browser, but not in Chromium.`,
      selector: null,
      html: null,
      matchMethod: null,
      evidence: {
        url: r.url,
        resourceType: r.resourceType,
        status: r.status,
        error: r.error,
        why: temporary
          ? 'a temporary server error (5xx, 408 or 429) is not evidence of a browser defect'
          : own
            ? 'a same-site resource that this browser requested and the server refused'
            : 'a resource of another site',
      },
    });
  }

  // ------------------------------------------------------- located findings
  const located = (
    list: LocatedFact[],
    baseList: LocatedFact[],
    kind: 'ui' | 'layout' | 'accessibility',
  ) => {
    for (const f of list.slice(0, 50)) {
      const match = matchElement(f, baseList);
      if (match.status === 'matched') continue;
      const check: CompatCheck =
        kind === 'accessibility' || (kind === 'ui' && ACCESSIBILITY_UI.has(f.check))
          ? 'BROWSER_ONLY_ACCESSIBILITY'
          : 'BROWSER_ONLY_LAYOUT';
      let classification: Strength;
      if (match.status === 'ambiguous') classification = 'INCONCLUSIVE';
      else if (kind === 'accessibility') classification = 'OBSERVATION';
      else if (kind === 'ui')
        classification = OBJECTIVE_UI.has(f.check) ? 'DETECTED' : 'POTENTIAL_DEFECT';
      else
        classification =
          f.check === 'ICON_BROKEN'
            ? 'DETECTED'
            : f.check === 'ICON_MISSING'
              ? 'OBSERVATION'
              : 'POTENTIAL_DEFECT';
      out.push({
        check,
        key: `${kind}|${f.check}|${identityKey(f.identity)}`,
        classification,
        underlying: f.check,
        summary:
          match.status === 'ambiguous'
            ? `“${f.check}” was found in this browser; the element could not be matched reliably with Chromium’s copy of the page.`
            : `“${f.check}” was found in this browser but not in Chromium, on the same element.`,
        selector: f.selector,
        html: f.html,
        matchMethod: match.method,
        evidence: { finding: f, match: match.status },
      });
    }
  };
  located(other.ui, base.ui, 'ui');
  located(other.layout, base.layout, 'layout');
  located(other.accessibility.slice(0, 20), base.accessibility, 'accessibility');

  // --------------------------------------------------------------------- CSS
  const unsupported = (other.cssSupport ?? []).filter((d) => !d.supported);
  if (unsupported.length > 0) {
    const properties = [...new Set(unsupported.map((d) => d.property))].slice(0, 20);
    out.push({
      check: 'UNSUPPORTED_CSS',
      key: `css|${properties.join(',')}`,
      classification: 'OBSERVATION',
      underlying: null,
      summary: `This browser reports that it does not support CSS the page applies: ${properties.join(', ')}.`,
      selector: null,
      html: null,
      matchMethod: null,
      evidence: {
        declarations: unsupported.slice(0, 20),
        why: 'the browser’s own CSS.supports() answered false for declarations Chromium applies; this shows a feature gap, not that anything looks wrong',
      },
    });
  }
  return out;
}

/**
 * Keeps a difference only if the second load of both browsers shows it again; otherwise it
 * becomes INCONCLUSIVE (timing or environment). Without a second load, nothing is claimed.
 */
export function confirmDifferences(first: Difference[], second: Difference[] | null): Difference[] {
  return first.map((d) => {
    const again = second?.find((s) => s.key === d.key);
    if (again) {
      return {
        ...d,
        evidence: { ...d.evidence, confirmed: true, secondLoad: again.evidence },
        // Equally strong on both loads, or the weaker of the two.
        classification: weaker(d.classification, again.classification),
      };
    }
    return {
      ...d,
      classification: 'INCONCLUSIVE',
      evidence: {
        ...d.evidence,
        confirmed: false,
        why: second
          ? 'not seen again when both browsers loaded the page a second time'
          : 'the second load could not be completed',
      },
    };
  });
}

const ORDER: Strength[] = ['INCONCLUSIVE', 'OBSERVATION', 'POTENTIAL_DEFECT', 'DETECTED'];
const weaker = (a: Strength, b: Strength) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
