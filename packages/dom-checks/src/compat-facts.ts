/**
 * In-page facts for the cross-browser comparison (Phase 9, Milestone 3, Checkpoint 2).
 * Runs in every engine; standard DOM and CSSOM only. The comparison itself is pure Node
 * code (apps/scanner/src/pipeline/compat-diff.ts).
 */
import { isVisible } from './dom-utils';
import type { CssDeclaration, ElementIdentity } from './compat-rules';
import { normalizeResourceUrl } from './compat-rules';

const STATE_CLASS =
  /(^|[-_])(active|current|selected|disabled|open|opened|checked|focus|focused|hover|loading|error|invalid|expanded|pressed|visible|hidden|show|shown)$/i;

/** Class names that look written by people (not generated hashes like css-1x2y3z). */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList)
    .filter((c) => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}/.test(c) && !STATE_CLASS.test(c))
    .sort();
}

function text(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

/** tag.stableClasses > … up to <body>, with the element's text. */
function domPath(el: Element): string {
  const parts: string[] = [];
  for (
    let node: Element | null = el;
    node && node !== document.body && parts.length < 12;
    node = node.parentElement
  ) {
    const classes = stableClasses(node);
    parts.unshift(`${node.tagName.toLowerCase()}${classes.length ? `.${classes.join('.')}` : ''}`);
  }
  return `${parts.join('>')}|${text(el)}`;
}

const ATTRIBUTES = ['id', 'data-testid', 'data-test', 'name', 'aria-label', 'for'] as const;

/** The first stable attribute that identifies exactly one element, or null. */
function attributeIdentity(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  for (const attr of ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (!value || value.length > 120) continue;
    const selector =
      attr === 'id' ? `#${CSS.escape(value)}` : `${tag}[${attr}="${CSS.escape(value)}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) return `${tag}[${attr}=${value}]`;
    } catch {
      // not a valid selector in this engine: try the next attribute
    }
  }
  for (const attr of ['href', 'src'] as const) {
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    let normalized: string;
    try {
      normalized = normalizeResourceUrl(new URL(raw, document.baseURI).href);
    } catch {
      continue;
    }
    const same = Array.from(document.getElementsByTagName(tag)).filter((other) => {
      const v = other.getAttribute(attr);
      if (!v) return false;
      try {
        return normalizeResourceUrl(new URL(v, document.baseURI).href) === normalized;
      } catch {
        return false;
      }
    });
    if (same.length === 1) return `${tag}[${attr}=${normalized}]`;
  }
  return null;
}

/** The DOM path + text, if no other element of the page has the same one. */
function pathIdentity(el: Element): string | null {
  const path = domPath(el);
  const peers = Array.from(document.getElementsByTagName(el.tagName)).slice(0, 2000);
  return peers.filter((other) => domPath(other) === path).length === 1 ? path : null;
}

/**
 * How to recognise each element in another browser's copy of the page. Every level is
 * kept only if it identifies exactly ONE element here; null at every level means the
 * element cannot be matched reliably.
 */
export function identities(selectors: string[]): ElementIdentity[] {
  return selectors.map((selector) => {
    if (selector === 'html' || selector === 'body' || selector === ':root') {
      return { attribute: 'document', path: 'document', selector: 'document' };
    }
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { attribute: null, path: null, selector: null };
    }
    if (matches.length !== 1) return { attribute: null, path: null, selector: null };
    const el = matches[0]!;
    return { attribute: attributeIdentity(el), path: pathIdentity(el), selector };
  });
}

/** "a: 1; b: url('x;y') !important" → [{a, 1}, {b, url('x;y')}] (quotes and brackets kept). */
function declarations(cssText: string): { property: string; value: string }[] {
  const out: { property: string; value: string }[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number) => {
    const part = cssText.slice(start, end);
    const colon = part.indexOf(':');
    if (colon > 0) {
      const property = part.slice(0, colon).trim().toLowerCase();
      const value = part
        .slice(colon + 1)
        .replace(/!\s*important\s*$/i, '')
        .trim();
      if (property && value) out.push({ property, value });
    }
    start = end + 1;
  };
  for (let i = 0; i < cssText.length; i += 1) {
    const c = cssText[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) push(i);
  }
  push(cssText.length);
  return out;
}

/**
 * CSS declarations the page actually applies: rules of readable stylesheets whose selector
 * matches a rendered element. Leaves out custom properties, vendor-prefixed properties and
 * rules inside @supports (those are guarded on purpose).
 */
export function cssInUse(limit = 300): CssDeclaration[] {
  const found = new Map<string, CssDeclaration>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (found.size >= limit) return;
      if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) continue;
      if (rule instanceof CSSStyleRule) {
        let applied: boolean;
        try {
          applied = Array.from(document.querySelectorAll(rule.selectorText)).some((el) =>
            isVisible(el),
          );
        } catch {
          applied = false;
        }
        if (!applied) continue;
        // As serialized (shorthands kept), not the expanded longhands: "font: 12px serif"
        // must not become a claim about every font-* longhand the page never wrote.
        for (const { property, value } of declarations(rule.style.cssText)) {
          if (property.startsWith('--') || /^-(webkit|moz|ms|o)-/.test(property)) continue;
          const key = `${property}:${value}`;
          if (!found.has(key))
            found.set(key, { property, value, selector: rule.selectorText.slice(0, 120) });
        }
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // another origin without CORS: not readable
    }
  }
  return [...found.values()];
}

/** This engine's own verdict on each declaration (CSS.supports: feature-support evidence). */
export function cssSupport(
  declarations: CssDeclaration[],
): (CssDeclaration & { supported: boolean })[] {
  return declarations.map((d) => {
    let supported: boolean;
    try {
      supported = CSS.supports(d.property, d.value);
    } catch {
      supported = true; // cannot tell: treated as supported (never claimed)
    }
    return { ...d, supported };
  });
}
