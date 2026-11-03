/**
 * Pure decisions of the Milestone 2 checks (Phase 9): font coverage, icon glyphs and
 * component consistency. No DOM access, so the scanner and unit tests can import it;
 * the in-page collection lives in extra.ts.
 */
import type { ExtraCheckName } from './presentation';
import type { Box } from './types';

export type FindingStrength = 'DETECTED' | 'POTENTIAL_DEFECT' | 'OBSERVATION';

export interface ExtraFinding {
  check: ExtraCheckName;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  classification: FindingStrength;
  message: string;
  selector: string;
  html: string;
  box: Box | null;
  measurements: Record<string, unknown>;
}

export interface ExtraCheckOptions {
  layout?: boolean;
  fonts?: boolean;
  icons?: boolean;
  consistency?: boolean;
  maxPerCheck?: number;
}

/** One @font-face as the page sees it (document.fonts), with its source URLs if readable. */
export interface FontFaceFact {
  family: string;
  style: string;
  weight: string;
  status: 'unloaded' | 'loading' | 'loaded' | 'error';
  display: string;
  unicodeRange: string;
  /** Absolute URLs of url() sources; empty when the stylesheet cannot be read (CORS). */
  sources: string[];
  /** True when the matching CSS rule was found and its src read. */
  sourcesKnown: boolean;
}

/** Visible text that asks for a web font family of which no face has loaded. */
export interface FallbackFact {
  family: string;
  elements: number;
  sample: { selector: string; html: string; box: Box | null; text: string };
}

/** Icons drawn with Private Use Area characters, grouped by font family. */
export interface GlyphIconFact {
  family: string;
  elements: number;
  sample: { selector: string; html: string; box: Box | null };
}

/** An <svg><use href="other-file.svg#id"> icon (the sprite file is checked in Node). */
export interface ExternalUseFact {
  url: string;
  fragment: string;
  /** The <use> draws nothing (zero-size box). */
  empty: boolean;
  selector: string;
  html: string;
  box: Box | null;
}

export type ComponentKind = 'button' | 'link-button' | 'text-input' | 'select' | 'textarea';
export type ComponentContext =
  'form' | 'nav' | 'toolbar' | 'table' | 'header' | 'footer' | 'aside' | 'dialog' | 'main';

/** The styles compared between comparable components. */
export interface ComponentStyle {
  /** Only for single-line, text-only members (otherwise content decides the height). */
  height: number | null;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  borderRadius: number;
  borderWidth: number;
  color: string;
  backgroundColor: string;
  borderColor: string;
}
export type StyleProperty = keyof ComponentStyle;

export interface ComponentMember {
  kind: ComponentKind;
  /** kind|tag|type|sorted classes|context: only members with the same key are compared. */
  key: string;
  label: string;
  selector: string;
  html: string;
  box: Box | null;
  style: ComponentStyle;
  /** Properties set by the element's own style attribute or by a rule for its #id only. */
  ownOverrides: StyleProperty[];
}

export interface ExtraResult {
  findings: ExtraFinding[];
  fonts: FontFaceFact[];
  fallbacks: FallbackFact[];
  glyphIcons: GlyphIconFact[];
  externalUses: ExternalUseFact[];
  components: ComponentMember[];
}

/** Where a DOM change during a probe happened (see side-effects.ts). */
export type SideEffectBucket = 'expected' | 'announcement' | 'ambient' | 'background' | 'unrelated';

export interface SideEffectReport {
  counts: Record<SideEffectBucket, number>;
  /** Up to 10 unrelated changes: where and what. */
  unrelated: { selector: string; type: string; attribute: string | null }[];
}

// ------------------------------------------------------------------ fonts

/** "U+0-7F, U+2000-206F, U+20AC" → [[0, 127], [8192, 8303], [8364, 8364]]. */
export function parseUnicodeRange(range: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of range.split(',')) {
    const m = /^\s*u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!m) continue;
    if (m[1]!.includes('?')) {
      out.push([parseInt(m[1]!.replace(/\?/g, '0'), 16), parseInt(m[1]!.replace(/\?/g, 'f'), 16)]);
    } else {
      const start = parseInt(m[1]!, 16);
      out.push([start, m[2] ? parseInt(m[2], 16) : start]);
    }
  }
  return out.length > 0 ? out : [[0, 0x10ffff]];
}

/** Whether a face with this unicode-range would be used for any character of `text`. */
export function rangeCoversText(range: string, text: string): boolean {
  const ranges = parseUnicodeRange(range);
  for (const char of text) {
    if (/\s/.test(char)) continue;
    const code = char.codePointAt(0)!;
    if (ranges.some(([a, b]) => code >= a && code <= b)) return true;
  }
  return false;
}

/** The first family of a computed font-family list, unquoted ("'Brand', sans-serif" → "Brand"). */
export function primaryFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

/** Characters of the Private Use Areas, where icon fonts put their glyphs. */
export function isPrivateUse(text: string): boolean {
  const chars = [...text.replace(/\s/g, '')];
  if (chars.length === 0) return false;
  return chars.every((char) => {
    const code = char.codePointAt(0)!;
    return (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000;
  });
}

/** The text of a computed `content` value ('"\\e001"' → the character), or null. */
export function contentText(content: string): string | null {
  const m = /^(["'])(.*)\1$/.exec(content.trim());
  return m ? m[2]! : null;
}

// ------------------------------------------------------- component consistency

/**
 * Class tokens that describe a state (active, selected, disabled...). Members with
 * such a token are left out: a different look for a state is intended.
 */
export const STATE_CLASS =
  /(^|[-_])(active|current|selected|disabled|open|opened|checked|focus|focused|hover|hovered|loading|busy|error|invalid|expanded|pressed)$/i;

/** How far a value may differ from the usual one before it counts as different. */
export const TOLERANCE: Record<StyleProperty, number> = {
  height: 4,
  paddingTop: 4,
  paddingRight: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  fontSize: 1,
  fontWeight: 100,
  borderRadius: 2,
  borderWidth: 0.5,
  fontFamily: 0,
  color: 24,
  backgroundColor: 24,
  borderColor: 24,
};

/** A difference this large (or more) is "large": with other evidence, a potential defect. */
const LARGE: Partial<Record<StyleProperty, number>> = {
  height: 8,
  paddingTop: 8,
  paddingRight: 8,
  paddingBottom: 8,
  paddingLeft: 8,
  fontSize: 2,
};

const COLOR_PROPS = new Set<StyleProperty>(['color', 'backgroundColor', 'borderColor']);

function parseColor(value: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i.exec(
    value,
  );
  if (!m) return null;
  const alpha =
    m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

/** Distance between two style values of one property (colours: largest channel difference). */
export function styleDistance(property: StyleProperty, a: unknown, b: unknown): number {
  if (a === null || b === null) return 0;
  if (COLOR_PROPS.has(property)) {
    const x = parseColor(String(a));
    const y = parseColor(String(b));
    if (!x || !y) return a === b ? 0 : Infinity;
    // Fully transparent colours are the same whatever their RGB.
    if (x[3] === 0 && y[3] === 0) return 0;
    return Math.max(...[0, 1, 2].map((i) => Math.abs(x[i]! - y[i]!)), Math.abs(x[3] - y[3]) * 255);
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  return String(a).toLowerCase() === String(b).toLowerCase() ? 0 : Infinity;
}

/**
 * The usual value of a property in a group: the value with the most members within
 * the tolerance, and the share of members that agree with it.
 */
export function usualValue(
  property: StyleProperty,
  values: unknown[],
): { value: unknown; share: number; agreeing: number } | null {
  const present = values.filter((v) => v !== null);
  if (present.length === 0) return null;
  let best: { value: unknown; agreeing: number } = { value: present[0], agreeing: 0 };
  for (const candidate of present) {
    const agreeing = present.filter(
      (v) => styleDistance(property, candidate, v) <= TOLERANCE[property],
    ).length;
    if (agreeing > best.agreeing) best = { value: candidate, agreeing };
  }
  return { ...best, share: best.agreeing / present.length };
}

export interface ComponentDeviation {
  property: StyleProperty;
  value: unknown;
  usual: unknown;
  difference: number;
}

export interface ConsistencyOutlier {
  member: ComponentMember;
  groupSize: number;
  deviations: ComponentDeviation[];
  /** Strong evidence (see consistencyOutliers): a potential defect, not just an observation. */
  strong: boolean;
}

/**
 * Within one page: members with the same key (kind, tag, type, exact classes and kind
 * of container; states already left out) that differ from what most of them look
 * like. Rules (Phase 9, Milestone 2):
 *   - groups of fewer than 4 members are never compared;
 *   - a property counts only if at least 75% of the members agree on its value;
 *   - an outlier differs from that value by more than the tolerance;
 *   - strong evidence (potential defect): at least 6 members, at least 85% agree, the
 *     difference is large (8 px or more, or 2 px of font size), and the outlier sets
 *     that property itself (its style attribute or a rule for its #id only).
 * Width is never compared: it depends on the text.
 */
export function consistencyOutliers(members: ComponentMember[]): ConsistencyOutlier[] {
  const groups = new Map<string, ComponentMember[]>();
  for (const m of members) groups.set(m.key, [...(groups.get(m.key) ?? []), m]);
  const outliers: ConsistencyOutlier[] = [];
  for (const group of groups.values()) {
    if (group.length < 4) continue;
    const properties = Object.keys(group[0]!.style) as StyleProperty[];
    const usual = new Map(
      properties.map(
        (p) =>
          [
            p,
            usualValue(
              p,
              group.map((m) => m.style[p]),
            ),
          ] as const,
      ),
    );
    for (const member of group) {
      const deviations: ComponentDeviation[] = [];
      let strong = false;
      for (const property of properties) {
        const u = usual.get(property);
        if (!u || u.share < 0.75) continue;
        const value = member.style[property];
        if (value === null) continue;
        const difference = styleDistance(property, value, u.value);
        if (difference <= TOLERANCE[property]) continue;
        deviations.push({ property, value, usual: u.value, difference });
        const large = LARGE[property];
        if (
          group.length >= 6 &&
          u.share >= 0.85 &&
          large !== undefined &&
          difference >= large &&
          member.ownOverrides.includes(property)
        ) {
          strong = true;
        }
      }
      if (deviations.length > 0)
        outliers.push({ member, groupSize: group.length, deviations, strong });
    }
  }
  return outliers;
}

/** One page's usual look per component key (for the comparison across pages). */
export interface ComponentSummaryEntry {
  key: string;
  kind: ComponentKind;
  label: string;
  count: number;
  style: Partial<Record<StyleProperty, unknown>>;
  sample: { selector: string; html: string; box: Box | null };
}

/** Per key: the value most members agree on (≥ 75%) for each property. */
export function summarizeComponents(members: ComponentMember[]): ComponentSummaryEntry[] {
  const groups = new Map<string, ComponentMember[]>();
  for (const m of members) groups.set(m.key, [...(groups.get(m.key) ?? []), m]);
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const style: Partial<Record<StyleProperty, unknown>> = {};
    for (const property of Object.keys(first.style) as StyleProperty[]) {
      const u = usualValue(
        property,
        group.map((m) => m.style[property]),
      );
      if (u && u.share >= 0.75) style[property] = u.value;
    }
    return {
      key: first.key,
      kind: first.kind,
      label: first.label,
      count: group.length,
      style,
      sample: { selector: first.selector, html: first.html, box: first.box },
    };
  });
}

export interface CrossPageDeviation {
  pageIndex: number;
  entry: ComponentSummaryEntry;
  deviations: ComponentDeviation[];
  pagesWithKey: number;
}

/**
 * Across pages: the same component key (same classes, same kind of container) looks
 * different on one page than on most others. Needs the key on at least 3 pages and
 * at least 75% of them agreeing. Always an observation.
 */
export function crossPageDeviations(pages: ComponentSummaryEntry[][]): CrossPageDeviation[] {
  const byKey = new Map<string, { pageIndex: number; entry: ComponentSummaryEntry }[]>();
  pages.forEach((entries, pageIndex) => {
    for (const entry of entries) {
      byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), { pageIndex, entry }]);
    }
  });
  const found: CrossPageDeviation[] = [];
  for (const occurrences of byKey.values()) {
    if (occurrences.length < 3) continue;
    const properties = new Set(
      occurrences.flatMap((o) => Object.keys(o.entry.style) as StyleProperty[]),
    );
    const perPage = new Map<number, ComponentDeviation[]>();
    for (const property of properties) {
      const values = occurrences.map((o) => o.entry.style[property] ?? null);
      const u = usualValue(property, values);
      if (!u || u.share < 0.75) continue;
      occurrences.forEach((o, i) => {
        const value = values[i];
        if (value === null || value === undefined) return;
        const difference = styleDistance(property, value, u.value);
        if (difference <= TOLERANCE[property]) return;
        perPage.set(o.pageIndex, [
          ...(perPage.get(o.pageIndex) ?? []),
          { property, value, usual: u.value, difference },
        ]);
      });
    }
    for (const [pageIndex, deviations] of perPage) {
      found.push({
        pageIndex,
        entry: occurrences.find((o) => o.pageIndex === pageIndex)!.entry,
        deviations,
        pagesWithKey: occurrences.length,
      });
    }
  }
  return found;
}

/** "paddingTop" → "padding top", for messages. */
export const propertyLabel = (p: StyleProperty) => p.replace(/([A-Z])/g, ' $1').toLowerCase();

/** A readable value: 12 → "12px", colours and families as they are. */
export function formatStyleValue(property: StyleProperty, value: unknown): string {
  if (typeof value === 'number') {
    return property === 'fontWeight' ? String(value) : `${Math.round(value * 10) / 10}px`;
  }
  return String(value);
}
