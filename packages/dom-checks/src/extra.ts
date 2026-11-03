/**
 * Milestone 2 checks (Phase 9) that run inside the page: layout measurements, font
 * and icon facts, and the styles of comparable components. Called by the scanner
 * only (window.__whcDomChecks.extra); the Chrome extension does not include them.
 *
 * Like checks.ts, every rule prefers missing an edge case over a false positive:
 * hidden, decorative, ellipsis/line-clamp, scrolling and off-canvas content is left out.
 * The decisions that need no DOM (fonts, icons, consistency) are in extra-rules.ts.
 */
import { isVisible, pageBox, selectorFor, snippet } from './dom-utils';
import {
  contentText,
  isPrivateUse,
  primaryFamily,
  rangeCoversText,
  STATE_CLASS,
  type ComponentContext,
  type ComponentKind,
  type ComponentMember,
  type ExtraCheckOptions,
  type ExtraFinding,
  type ExtraResult,
  type FallbackFact,
  type FontFaceFact,
  type GlyphIconFact,
  type StyleProperty,
} from './extra-rules';

const CONTROLS =
  'button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], summary';

/** Collects the Milestone 2 facts and findings. `root` limits the layout checks to one subtree. */
export async function runExtraChecks(
  options: ExtraCheckOptions,
  root: Element = document.body,
): Promise<ExtraResult> {
  const maxPerCheck = options.maxPerCheck ?? 20;
  const findings: ExtraFinding[] = [];
  const counts = new Map<string, number>();
  const add = (finding: ExtraFinding) => {
    const n = counts.get(finding.check) ?? 0;
    if (n >= maxPerCheck) return;
    counts.set(finding.check, n + 1);
    findings.push(finding);
  };
  const result: ExtraResult = {
    findings,
    fonts: [],
    fallbacks: [],
    glyphIcons: [],
    externalUses: [],
    components: [],
  };
  if (!root) return result;
  const startScroll = { x: window.scrollX, y: window.scrollY };
  try {
    if (options.fonts || options.icons) {
      // Fonts still loading are waited for briefly (the page has already settled).
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
      result.fonts = fontFaces();
    }
    if (options.layout) layoutChecks(root, add);
    if (options.fonts) result.fallbacks = fallbackFonts(result.fonts);
    if (options.icons) iconChecks(result, add);
    if (options.consistency) result.components = componentMembers();
  } finally {
    window.scrollTo(startScroll.x, startScroll.y);
  }
  return result;
}

// ----------------------------------------------------------------- helpers

/** Common "visually hidden" techniques, including parking content far off the screen. */
function isScreenReaderOnly(el: Element): boolean {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return (
    (rect.width <= 2 && rect.height <= 2) ||
    style.clip === 'rect(0px, 0px, 0px, 0px)' ||
    style.clipPath === 'inset(50%)' ||
    rect.right < -500 ||
    rect.left > document.documentElement.clientWidth + 500
  );
}

/** Hidden from assistive technology or marked as decoration: never compared. */
function isDecorative(el: Element): boolean {
  if (el.closest('[aria-hidden="true"], [role="presentation"], [role="none"]')) return true;
  return false;
}

/** Opacity of the element and its ancestors multiplied (watermarks are faint on purpose). */
function effectiveOpacity(el: Element): number {
  let opacity = 1;
  for (let node: Element | null = el; node && opacity > 0; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity);
  }
  return opacity;
}

function isFixedOrSticky(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

function insideHorizontalScroller(el: Element): boolean {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflowX = getComputedStyle(node).overflowX;
    if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) {
      return true;
    }
  }
  return false;
}

/** Ellipsis or line-clamp on the element or an ancestor up to `stop`: truncation is intended. */
function truncatedOnPurpose(el: Element, stop: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.textOverflow === 'ellipsis') return true;
    const clamp = style.getPropertyValue('-webkit-line-clamp');
    if (clamp && clamp !== 'none') return true;
    if (node === stop) break;
  }
  return false;
}

function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
  );
}

/**
 * The glyph boxes of the visible text inside `el`: text that is screen-reader-only,
 * hidden, or positioned out of the flow (absolute/fixed descendants) is left out.
 */
function textRects(el: Element): DOMRect[] {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.textContent ?? '').trim()) continue;
    let skip = false;
    for (
      let owner = node.parentElement;
      owner && owner !== el.parentElement;
      owner = owner.parentElement
    ) {
      if (!isVisible(owner) || isScreenReaderOnly(owner)) {
        skip = true;
        break;
      }
      const position = getComputedStyle(owner).position;
      if (owner !== el && (position === 'absolute' || position === 'fixed')) {
        skip = true;
        break;
      }
    }
    if (!skip) rects.push(...ownTextRects(node as Text));
  }
  return rects;
}

function ownTextRects(node: Text): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  return Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

/** Brings a page-coordinate area into the window (elementsFromPoint needs it there). */
function scrollIntoWindow(pageY: number): void {
  const target = Math.max(0, pageY - window.innerHeight / 3);
  if (Math.abs(window.scrollY - target) > 1) window.scrollTo(window.scrollX, target);
}

function hasVisibleContentAt(el: Element, x: number, y: number): boolean {
  const tag = el.tagName.toLowerCase();
  if (['img', 'svg', 'video', 'canvas', 'input', 'select', 'textarea', 'button'].includes(tag)) {
    return true;
  }
  const style = getComputedStyle(el);
  const bg = style.backgroundColor;
  if (style.backgroundImage !== 'none') return true;
  if (bg && !/rgba\([^)]*,\s*0\)$/.test(bg) && bg !== 'transparent') return true;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !(node.textContent ?? '').trim()) continue;
    if (
      ownTextRects(node as Text).some(
        (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
      )
    ) {
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ layout

function layoutChecks(root: Element, add: (f: ExtraFinding) => void): void {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  // Elements whose text spills onto others: their overlaps are the same problem.
  const spilled = new Set<Element>();

  // ------------------------------------------- 1. text spilling out onto other content
  for (const el of all) {
    if (!hasOwnText(el) || !isVisible(el) || isScreenReaderOnly(el) || isDecorative(el)) continue;
    const style = getComputedStyle(el);
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') continue; // TEXT_CLIPPING's case
    if (style.display.startsWith('inline') && style.display !== 'inline-block') continue;
    const html = el as HTMLElement;
    if (html.scrollHeight <= html.clientHeight + 2) continue;
    if (truncatedOnPurpose(el, null) || insideHorizontalScroller(el) || isFixedOrSticky(el))
      continue;
    const box = el.getBoundingClientRect();
    const bottom = box.bottom - px(style.borderBottomWidth);
    const spill = textRects(el).filter((r) => r.bottom > bottom + 4);
    if (spill.length === 0) continue;
    const spillPx = Math.round(Math.max(...spill.map((r) => r.bottom)) - bottom);
    // Sample the spilled text; it must land on another element's content.
    scrollIntoWindow(spill[0]!.top + window.scrollY);
    const ancestors = new Set<Element>();
    for (let node: Element | null = el; node; node = node.parentElement) ancestors.add(node);
    let hit: Element | null = null;
    const now = textRects(el).filter(
      (r) => r.bottom > el.getBoundingClientRect().bottom - px(style.borderBottomWidth) + 4,
    );
    for (const rect of now.slice(0, 6)) {
      const y = Math.max(rect.top, el.getBoundingClientRect().bottom + 2) + 2;
      for (const x of [rect.left + 4, (rect.left + rect.right) / 2, rect.right - 4]) {
        for (const other of document.elementsFromPoint(x, y)) {
          if (ancestors.has(other) || el.contains(other) || isDecorative(other)) continue;
          if (hasVisibleContentAt(other, x, y)) {
            hit = other;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) break;
    }
    if (!hit) continue; // spills into empty space: not drawn over anything
    spilled.add(el);
    spilled.add(hit);
    add({
      check: 'TEXT_OVERFLOW_VISIBLE',
      severity: 'MEDIUM',
      classification: 'POTENTIAL_DEFECT',
      message: `Text is ${spillPx}px taller than its box and is drawn over ${selectorFor(hit)}.`,
      selector: selectorFor(el),
      html: snippet(el),
      box: pageBox(el),
      measurements: {
        spillPx,
        boxHeight: Math.round(box.height),
        overlaps: selectorFor(hit),
        viewportWidth: document.documentElement.clientWidth,
      },
    });
  }

  // ------------------------------------------------- 2. text drawn over other text
  window.scrollTo(window.scrollX, 0);
  type TextBox = { owner: Element; left: number; top: number; right: number; bottom: number };
  const boxes: TextBox[] = [];
  const clips = new Map<Element, { left: number; top: number; right: number; bottom: number }>();
  /** The area where the owner's text is painted: ancestors that hide overflow cut it. */
  const paintArea = (owner: Element) => {
    const cached = clips.get(owner);
    if (cached) return cached;
    let area = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (let node: Element | null = owner; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const r = node.getBoundingClientRect();
      area = {
        left: Math.max(area.left, r.left),
        top: Math.max(area.top, r.top),
        right: Math.min(area.right, r.right),
        bottom: Math.min(area.bottom, r.bottom),
      };
    }
    clips.set(owner, area);
    return area;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && boxes.length < 4000; node = walker.nextNode()) {
    if (!(node.textContent ?? '').trim()) continue;
    const owner = node.parentElement;
    if (!owner || owner.closest('svg, script, style, noscript, template, option')) continue;
    if (!isVisible(owner) || isScreenReaderOnly(owner) || isDecorative(owner)) continue;
    if (isFixedOrSticky(owner) || effectiveOpacity(owner) < 0.3) continue;
    if (/rgba\([^)]*,\s*0\)$/.test(getComputedStyle(owner).color)) continue;
    const area = paintArea(owner);
    for (const r of ownTextRects(node as Text)) {
      // Only the painted part: clamped, ellipsised or scrolled-away text is not drawn.
      const left = Math.max(r.left, area.left);
      const top = Math.max(r.top, area.top);
      const right = Math.min(r.right, area.right);
      const bottom = Math.min(r.bottom, area.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      // Text left of or above the page can never be scrolled to (off-screen skip links).
      if (right + window.scrollX <= 0 || bottom + window.scrollY <= 0) continue;
      boxes.push({
        owner,
        left: left + window.scrollX,
        top: top + window.scrollY,
        right: right + window.scrollX,
        bottom: bottom + window.scrollY,
      });
    }
  }
  const grid = new Map<string, TextBox[]>();
  const CELL = 200;
  for (const b of boxes) {
    for (let gx = Math.floor(b.left / CELL); gx <= Math.floor(b.right / CELL); gx += 1) {
      for (let gy = Math.floor(b.top / CELL); gy <= Math.floor(b.bottom / CELL); gy += 1) {
        const key = `${gx}:${gy}`;
        grid.set(key, [...(grid.get(key) ?? []), b]);
      }
    }
  }
  const reportedPairs = new Set<string>();
  const reportedOwners = new Set<Element>();
  for (const cell of grid.values()) {
    for (let i = 0; i < cell.length; i += 1) {
      for (let j = i + 1; j < cell.length; j += 1) {
        const a = cell[i]!;
        const b = cell[j]!;
        if (a.owner === b.owner || a.owner.contains(b.owner) || b.owner.contains(a.owner)) continue;
        if ([...spilled].some((s) => s.contains(a.owner) || s.contains(b.owner))) continue;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w <= 0 || h <= 0) continue;
        const overlap = w * h;
        const smaller = Math.min(
          (a.right - a.left) * (a.bottom - a.top),
          (b.right - b.left) * (b.bottom - b.top),
        );
        if (overlap < 40 || overlap < 0.3 * smaller) continue;
        const [first, second] =
          a.top < b.top || (a.top === b.top && a.left <= b.left) ? [a, b] : [b, a];
        const pair = `${selectorFor(first.owner)}|${selectorFor(second.owner)}`;
        if (reportedPairs.has(pair) || reportedOwners.has(first.owner)) continue;
        reportedPairs.add(pair);
        reportedOwners.add(first.owner);
        add({
          check: 'TEXT_OVERLAP',
          severity: 'MEDIUM',
          classification: 'POTENTIAL_DEFECT',
          message: `This text and the text of ${selectorFor(second.owner)} are drawn on top of each other (${Math.round(w)}×${Math.round(h)}px overlap).`,
          selector: selectorFor(first.owner),
          html: snippet(first.owner),
          box: pageBox(first.owner),
          measurements: {
            overlapsWith: selectorFor(second.owner),
            overlapWidth: Math.round(w),
            overlapHeight: Math.round(h),
            viewportWidth: document.documentElement.clientWidth,
          },
        });
      }
    }
  }

  // ------------------------------------- 3. fixed elements partly below/above the window
  const fixedReported = new Set<Element>();
  for (const el of all) {
    if (getComputedStyle(el).position !== 'fixed') continue;
    if (Array.from(fixedReported).some((f) => f.contains(el))) continue;
    if (!isVisible(el) || isScreenReaderOnly(el) || isDecorative(el)) continue;
    const rect = el.getBoundingClientRect();
    const hiddenBottom = rect.bottom - window.innerHeight;
    const hiddenTop = -rect.top;
    const hidden = Math.max(hiddenBottom, hiddenTop);
    if (hidden <= 4 || rect.height <= 0) continue;
    // Mostly off-screen: an off-canvas panel or a "peeking" sheet, hidden on purpose.
    if ((rect.height - hidden) / rect.height < 0.5) continue;
    const outside = (r: DOMRect) => r.top >= window.innerHeight || r.bottom <= 0;
    const unreachableControls = Array.from(
      el.querySelectorAll(CONTROLS + ', input, select, textarea'),
    ).filter((c) => isVisible(c) && outside(c.getBoundingClientRect()));
    const unreachableText = textRects(el).filter(outside);
    if (unreachableControls.length === 0 && unreachableText.length === 0) continue; // only padding/background
    fixedReported.add(el);
    add({
      check: 'FIXED_OUT_OF_VIEWPORT',
      severity: unreachableControls.length > 0 ? 'HIGH' : 'MEDIUM',
      classification: 'POTENTIAL_DEFECT',
      message: `This fixed element extends ${Math.round(hidden)}px ${hiddenBottom >= hiddenTop ? 'below' : 'above'} the window and does not scroll${unreachableControls.length > 0 ? `; ${unreachableControls.length} control(s) in it can never be reached` : ''}.`,
      selector: selectorFor(el),
      html: snippet(el),
      box: pageBox(el),
      measurements: {
        hiddenPx: Math.round(hidden),
        elementHeight: Math.round(rect.height),
        windowHeight: window.innerHeight,
        unreachableControls: unreachableControls.slice(0, 5).map((c) => selectorFor(c)),
      },
    });
  }

  // ---------------------------------------------- 4. control labels that do not fit
  for (const control of Array.from(root.querySelectorAll(CONTROLS))) {
    if (!isVisible(control) || isScreenReaderOnly(control) || isDecorative(control)) continue;
    const label = ((control as HTMLElement).innerText ?? '').trim();
    if (!label) continue;
    const style = getComputedStyle(control);
    // Inline links flow with the text around them; their glyph boxes may exceed the box.
    if (style.display === 'inline' || style.display === 'contents') continue;
    const html = control as HTMLElement;
    // Own text cut off by overflow: hidden is already reported as TEXT_CLIPPING.
    const clips =
      style.overflowX === 'hidden' ||
      style.overflowX === 'clip' ||
      style.overflowY === 'hidden' ||
      style.overflowY === 'clip';
    if (
      clips &&
      hasOwnText(control) &&
      (html.scrollWidth - html.clientWidth > 2 || html.scrollHeight - html.clientHeight > 2)
    ) {
      continue;
    }
    const rects = textRects(control);
    if (rects.length === 0) continue;
    if (
      Array.from(control.querySelectorAll('*')).some((child) =>
        truncatedOnPurpose(child, control),
      ) ||
      truncatedOnPurpose(control, control)
    ) {
      continue;
    }
    const box = control.getBoundingClientRect();
    const content = {
      left: box.left + px(style.borderLeftWidth),
      right: box.right - px(style.borderRightWidth),
      top: box.top + px(style.borderTopWidth),
      bottom: box.bottom - px(style.borderBottomWidth),
    };
    const outX = Math.max(
      Math.max(...rects.map((r) => r.right)) - content.right,
      content.left - Math.min(...rects.map((r) => r.left)),
    );
    const outY = Math.max(
      Math.max(...rects.map((r) => r.bottom)) - content.bottom,
      content.top - Math.min(...rects.map((r) => r.top)),
    );
    const out = Math.max(outX, outY);
    if (out <= 2) continue;
    add({
      check: 'CONTROL_LABEL_CLIPPED',
      severity: 'MEDIUM',
      classification: 'POTENTIAL_DEFECT',
      message: `The label “${label.slice(0, 60)}” is ${Math.round(out)}px ${outX >= outY ? 'wider' : 'taller'} than its control${clips ? ' and is cut off' : ' and spills outside it'}.`,
      selector: selectorFor(control),
      html: snippet(control),
      box: pageBox(control),
      measurements: {
        overflowPx: Math.round(out),
        direction: outX >= outY ? 'horizontal' : 'vertical',
        cutOff: clips,
        controlWidth: Math.round(box.width),
        controlHeight: Math.round(box.height),
        viewportWidth: document.documentElement.clientWidth,
      },
    });
  }
}

// ------------------------------------------------------------------- fonts

function fontFaces(): FontFaceFact[] {
  type Rule = { family: string; style: string; weight: string; range: string; sources: string[] };
  const rules: Rule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // another origin without CORS: its sources stay unknown
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(cssRules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const src = rule.style.getPropertyValue('src');
      const sources: string[] = [];
      for (const m of src.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
        try {
          sources.push(new URL(m[2]!, base).href);
        } catch {
          // unparsable URL: ignored
        }
      }
      rules.push({
        family: primaryFamily(rule.style.getPropertyValue('font-family')),
        style: rule.style.getPropertyValue('font-style') || 'normal',
        weight: rule.style.getPropertyValue('font-weight') || 'normal',
        range: rule.style.getPropertyValue('unicode-range') || '',
        sources,
      });
    }
  }
  const normalWeight = (w: string) =>
    w
      .replace(/\bnormal\b/, '400')
      .replace(/\bbold\b/, '700')
      .trim();
  const faces: FontFaceFact[] = [];
  document.fonts.forEach((face) => {
    const family = primaryFamily(face.family);
    const rule = rules.find(
      (r) =>
        r.family === family &&
        r.style === face.style &&
        normalWeight(r.weight) === normalWeight(face.weight) &&
        (!r.range || r.range.toLowerCase() === face.unicodeRange.toLowerCase()),
    );
    faces.push({
      family,
      style: face.style,
      weight: face.weight,
      status: face.status,
      display: face.display,
      unicodeRange: face.unicodeRange,
      sources: rule?.sources ?? [],
      sourcesKnown: Boolean(rule),
    });
  });
  return faces;
}

function fallbackFonts(faces: FontFaceFact[]): FallbackFact[] {
  const families = new Map<string, FontFaceFact[]>();
  for (const face of faces) families.set(face.family, [...(families.get(face.family) ?? []), face]);
  const found = new Map<string, FallbackFact>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let visited = 0;
  for (let node = walker.nextNode(); node && visited < 5000; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (!text) continue;
    const owner = node.parentElement;
    if (!owner || owner.closest('script, style, noscript, template')) continue;
    visited += 1;
    const family = primaryFamily(getComputedStyle(owner).fontFamily);
    const familyFaces = families.get(family);
    if (!familyFaces) continue; // not a web font (system font or generic family)
    if (isPrivateUse(text)) continue; // icon glyphs are the icon check's business
    // Faces that would be used for this text (unicode-range subsets are intended fallbacks).
    const relevant = familyFaces.filter((f) => rangeCoversText(f.unicodeRange, text));
    if (relevant.length === 0) continue;
    if (relevant.some((f) => f.status === 'loaded')) continue;
    if (relevant.every((f) => f.display === 'optional')) continue; // fallback accepted on purpose
    if (!isVisible(owner) || isScreenReaderOnly(owner)) continue;
    const entry = found.get(family);
    if (entry) {
      entry.elements += 1;
      continue;
    }
    found.set(family, {
      family,
      elements: 1,
      sample: {
        selector: selectorFor(owner),
        html: snippet(owner),
        box: pageBox(owner),
        text: text.slice(0, 80),
      },
    });
  }
  return [...found.values()];
}

// ------------------------------------------------------------------- icons

function iconChecks(result: ExtraResult, add: (f: ExtraFinding) => void): void {
  // 1. <svg><use href="#id">: the symbol must exist in the page.
  for (const use of Array.from(document.querySelectorAll('svg use'))) {
    const svg = use.closest('svg');
    if (!svg || !isVisible(svg)) continue;
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (!href) continue;
    if (href.startsWith('#')) {
      const id = href.slice(1);
      if (!id || document.getElementById(id)) continue;
      add({
        check: 'ICON_BROKEN',
        severity: 'MEDIUM',
        classification: 'DETECTED',
        message: `The icon refers to the SVG symbol “${href}”, which does not exist in the page.`,
        selector: selectorFor(svg),
        html: snippet(svg),
        box: pageBox(svg),
        measurements: { href, kind: 'svg-symbol' },
      });
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, document.baseURI);
    } catch {
      continue;
    }
    const fragment = url.hash.slice(1);
    url.hash = '';
    let empty: boolean;
    try {
      const bbox = (use as SVGGraphicsElement).getBBox();
      empty = bbox.width === 0 && bbox.height === 0;
    } catch {
      empty = true;
    }
    result.externalUses.push({
      url: url.href,
      fragment,
      empty,
      selector: selectorFor(svg),
      html: snippet(svg),
      box: pageBox(svg),
    });
  }

  // 2. Icon-font glyphs (Private Use Area characters), grouped by font family.
  const glyphs = new Map<string, GlyphIconFact>();
  const noteGlyph = (family: string, el: Element) => {
    const entry = glyphs.get(family);
    if (entry) entry.elements += 1;
    else
      glyphs.set(family, {
        family,
        elements: 1,
        sample: { selector: selectorFor(el), html: snippet(el), box: pageBox(el) },
      });
  };
  for (const el of Array.from(document.body.querySelectorAll('*')).slice(0, 6000)) {
    if (el.closest('script, style, svg')) continue;
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(el, pseudo);
      const text = contentText(style.content);
      if (text && isPrivateUse(text) && isVisible(el))
        noteGlyph(primaryFamily(style.fontFamily), el);
    }
    if (hasOwnText(el) && isPrivateUse((el.textContent ?? '').trim()) && isVisible(el)) {
      noteGlyph(primaryFamily(getComputedStyle(el).fontFamily), el);
    }
  }
  result.glyphIcons = [...glyphs.values()];

  // 3. Icon-only controls with a label for screen readers but nothing visible inside.
  for (const control of Array.from(document.querySelectorAll('button, a[href], [role=button]'))) {
    if (!isVisible(control) || isScreenReaderOnly(control) || isDecorative(control)) continue;
    const box = control.getBoundingClientRect();
    if (box.width < 12 || box.height < 12) continue;
    const named =
      (control.getAttribute('aria-label') ?? '').trim() ||
      (control.getAttribute('aria-labelledby') ?? '').trim() ||
      (control.getAttribute('title') ?? '').trim();
    if (!named) continue; // unnamed controls are reported as EMPTY_BUTTON / EMPTY_LINK
    if (((control as HTMLElement).innerText ?? '').trim()) continue;
    const style = getComputedStyle(control);
    if (style.backgroundImage !== 'none') continue; // CSS background icon
    if (
      ['::before', '::after'].some((p) => {
        const c = getComputedStyle(control, p).content;
        return c !== 'none' && c !== 'normal' && c !== '""';
      })
    ) {
      continue;
    }
    const parts = Array.from(control.querySelectorAll('*'));
    const somethingVisible = parts.some((part) => {
      if (!isVisible(part)) return false;
      const tag = part.tagName.toLowerCase();
      if (['svg', 'img', 'canvas', 'video', 'picture'].includes(tag)) return true;
      if (getComputedStyle(part).backgroundImage !== 'none') return true;
      return ['::before', '::after'].some((p) => {
        const c = getComputedStyle(part, p).content;
        return c !== 'none' && c !== 'normal' && c !== '""';
      });
    });
    if (somethingVisible) continue;
    add({
      check: 'ICON_MISSING',
      severity: 'LOW',
      classification: 'OBSERVATION',
      message: `This control is named “${named.slice(0, 60)}” for screen readers, but nothing is visible inside it: its icon is missing or has no size.`,
      selector: selectorFor(control),
      html: snippet(control),
      box: pageBox(control),
      measurements: { label: named.slice(0, 120), iconElements: parts.length },
    });
  }
}

// ---------------------------------------------------- component consistency

const COMPONENT_SELECTOR = [
  'button',
  '[role=button]',
  'input[type=submit]',
  'input[type=button]',
  'input[type=reset]',
  'a[href]',
  'input:not([type])',
  'input[type=text]',
  'input[type=email]',
  'input[type=search]',
  'input[type=tel]',
  'input[type=url]',
  'input[type=number]',
  'input[type=password]',
  'select',
  'textarea',
].join(', ');

const STYLE_MAP: Record<string, StyleProperty[]> = {
  height: ['height'],
  'min-height': ['height'],
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  'padding-top': ['paddingTop'],
  'padding-right': ['paddingRight'],
  'padding-bottom': ['paddingBottom'],
  'padding-left': ['paddingLeft'],
  'padding-block': ['paddingTop', 'paddingBottom'],
  'padding-inline': ['paddingLeft', 'paddingRight'],
  font: ['fontFamily', 'fontSize', 'fontWeight'],
  'font-family': ['fontFamily'],
  'font-size': ['fontSize'],
  'font-weight': ['fontWeight'],
  'border-radius': ['borderRadius'],
  border: ['borderWidth', 'borderColor'],
  'border-width': ['borderWidth'],
  'border-color': ['borderColor'],
  color: ['color'],
  background: ['backgroundColor'],
  'background-color': ['backgroundColor'],
};

function propertiesOf(style: CSSStyleDeclaration): StyleProperty[] {
  const out = new Set<StyleProperty>();
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    for (const [prefix, props] of Object.entries(STYLE_MAP)) {
      if (
        name === prefix ||
        (prefix === 'border' && name.startsWith('border-') && name.endsWith('-width'))
      ) {
        props.forEach((p) => out.add(p));
      }
    }
  }
  return [...out];
}

/** Properties set only for one element: rules whose selector is exactly "#id". */
function idRuleProperties(): Map<string, StyleProperty[]> {
  const byId = new Map<string, StyleProperty[]>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const m = /^#([\w-]+)$/.exec(rule.selectorText.trim());
        if (m) byId.set(m[1]!, [...(byId.get(m[1]!) ?? []), ...propertiesOf(rule.style)]);
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
  return byId;
}

function componentKind(el: Element): ComponentKind | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    return ['submit', 'button', 'reset'].includes(type) ? 'button' : 'text-input';
  }
  if (tag === 'button' || (el.getAttribute('role') === 'button' && tag !== 'a')) return 'button';
  if (tag === 'a') {
    if (el.getAttribute('role') === 'button') return 'link-button';
    // A link drawn as a button: a box with padding and a background or border.
    const style = getComputedStyle(el);
    if (style.display === 'inline') return null;
    const filled =
      !/rgba\([^)]*,\s*0\)$/.test(style.backgroundColor) && style.backgroundColor !== 'transparent';
    const bordered = px(style.borderTopWidth) > 0;
    if ((filled || bordered) && px(style.paddingLeft) >= 8) return 'link-button';
    return null;
  }
  return null;
}

function componentContext(el: Element): ComponentContext {
  if (el.closest('td, th')) return 'table';
  if (el.closest('[role=toolbar]')) return 'toolbar';
  if (el.closest('dialog[open], [role=dialog], [role=alertdialog]')) return 'dialog';
  if (el.closest('nav, [role=navigation]')) return 'nav';
  if (el.closest('form, [role=search]')) return 'form';
  if (el.closest('header, [role=banner]')) return 'header';
  if (el.closest('footer, [role=contentinfo]')) return 'footer';
  if (el.closest('aside, [role=complementary]')) return 'aside';
  return 'main';
}

/** A state that is meant to look different (disabled, current, pressed...). */
function inSpecialState(el: Element, classes: string[]): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')
    return true;
  for (const attr of [
    'aria-current',
    'aria-pressed',
    'aria-selected',
    'aria-expanded',
    'aria-checked',
  ]) {
    const value = el.getAttribute(attr);
    if (value && value !== 'false') return true;
  }
  if (el.getAttribute('aria-invalid') === 'true') return true;
  if (el === document.activeElement || el.matches(':hover')) return true;
  return classes.some((c) => STATE_CLASS.test(c));
}

function componentMembers(): ComponentMember[] {
  const idRules = idRuleProperties();
  const members: ComponentMember[] = [];
  for (const el of Array.from(document.querySelectorAll(COMPONENT_SELECTOR))) {
    if (members.length >= 400) break;
    const kind = componentKind(el);
    if (!kind || !isVisible(el) || isScreenReaderOnly(el) || isDecorative(el)) continue;
    const classes = Array.from(el.classList).sort();
    if (inSpecialState(el, classes)) continue;
    const style = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : '';
    const context = componentContext(el);
    const textOnly = el.children.length === 0 && Boolean((el.textContent ?? '').trim());
    const singleLine = textOnly && textRects(el).length <= 1;
    const own = new Set<StyleProperty>(propertiesOf((el as HTMLElement).style));
    if (el.id) idRules.get(el.id)?.forEach((p) => own.add(p));
    members.push({
      kind,
      key: [kind, tag, type, classes.join('.'), context].join('|'),
      label: `${tag}${classes.length ? `.${classes.join('.')}` : ''}${type ? `[type=${type}]` : ''} in ${context}`,
      selector: selectorFor(el),
      html: snippet(el),
      box: pageBox(el),
      style: {
        // Text fields and selects have a set height; buttons only when one line of text.
        height:
          kind === 'text-input' || kind === 'select' || singleLine
            ? Math.round(el.getBoundingClientRect().height)
            : null,
        paddingTop: px(style.paddingTop),
        paddingRight: px(style.paddingRight),
        paddingBottom: px(style.paddingBottom),
        paddingLeft: px(style.paddingLeft),
        fontFamily: style.fontFamily,
        fontSize: px(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
        borderRadius: px(style.borderTopLeftRadius),
        borderWidth: px(style.borderTopWidth),
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
      },
      ownOverrides: [...own],
    });
  }
  return members;
}
