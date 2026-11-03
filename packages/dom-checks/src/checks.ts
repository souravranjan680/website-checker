/**
 * UI health checks that run INSIDE the scanned web page (in the real browser), so
 * they can see real layout: sizes, positions, scroll widths, what is on top.
 *
 * Used by the scanner (bundled and injected with Playwright) and, in Phase 7, by
 * the Chrome extension. No imports at runtime: everything here uses only the
 * browser's own DOM APIs.
 *
 * Every check prefers missing an edge case over reporting a false positive.
 */
import { isVisible, pageBox, selectorFor, snippet } from './dom-utils';
import type {
  DomCheckOptions,
  DomCheckResult,
  DomFinding,
  LinkInfo,
  InsecureReference,
  SeoSnapshot,
} from './types';

const INTERACTIVE =
  'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [tabindex]:not([tabindex="-1"])';

export function runDomChecks(options: DomCheckOptions): DomCheckResult {
  const maxPerCheck = options.maxPerCheck ?? 20;
  const findings: DomFinding[] = [];
  const counts = new Map<string, number>();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;

  const skip = new Set<Element>();
  for (const selector of options.skipSelectors ?? []) {
    try {
      document.querySelectorAll(selector).forEach((el) => skip.add(el));
    } catch {
      // invalid selector from another tool: ignore
    }
  }

  function add(finding: DomFinding): void {
    const count = counts.get(finding.check) ?? 0;
    if (count >= maxPerCheck) return;
    counts.set(finding.check, count + 1);
    findings.push(finding);
  }

  // ---------------------------------------------------------------- helpers

  /** Common "visually hidden but available to screen readers" technique. */
  function isScreenReaderOnly(el: Element): boolean {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      (rect.width <= 2 && rect.height <= 2) ||
      style.clip === 'rect(0px, 0px, 0px, 0px)' ||
      style.clipPath === 'inset(50%)' ||
      rect.right < -500 ||
      rect.left > viewportWidth + 500
    );
  }

  function accessibleText(el: Element): string {
    const parts = [
      el.getAttribute('aria-label') ?? '',
      el.getAttribute('title') ?? '',
      (el as HTMLElement).innerText ?? el.textContent ?? '',
    ];
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/))
        parts.push(document.getElementById(id)?.textContent ?? '');
    }
    el.querySelectorAll('img[alt], svg title, [aria-label]').forEach((child) => {
      parts.push(
        child.getAttribute('alt') ?? child.getAttribute('aria-label') ?? child.textContent ?? '',
      );
    });
    if (el instanceof HTMLInputElement) parts.push(el.value);
    return parts.join(' ').trim();
  }

  /** True if an ancestor clips or scrolls horizontally (a carousel, a code block...). */
  function insideHorizontalScroller(el: Element): boolean {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (
        overflowX === 'auto' ||
        overflowX === 'scroll' ||
        overflowX === 'hidden' ||
        overflowX === 'clip'
      ) {
        return true;
      }
    }
    return false;
  }

  function isFixedOrSticky(el: Element): boolean {
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  }

  const all = Array.from(document.body?.querySelectorAll('*') ?? []);

  // ------------------------------------------------- 1. horizontal scrolling
  const root = document.documentElement;
  const scrollWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
  const htmlOverflowX = getComputedStyle(root).overflowX;
  const bodyOverflowX = document.body ? getComputedStyle(document.body).overflowX : 'visible';
  const scrollingAllowed = ![htmlOverflowX, bodyOverflowX].some(
    (v) => v === 'hidden' || v === 'clip',
  );
  if (scrollWidth > viewportWidth + 1 && scrollingAllowed) {
    add({
      check: 'HORIZONTAL_SCROLL',
      severity: viewportWidth < 800 ? 'HIGH' : 'MEDIUM',
      message: `The page is ${scrollWidth}px wide but the screen is ${viewportWidth}px, so users must scroll sideways.`,
      selector: 'html',
      html: '<html>',
      box: { x: 0, y: 0, width: scrollWidth, height: viewportHeight },
      measurements: { scrollWidth, viewportWidth },
    });
  }

  // --------------------------------- 2. elements sticking out of the screen
  const reported = new Set<Element>();
  for (const el of all) {
    if (reported.size >= maxPerCheck) break;
    if (!isVisible(el) || isScreenReaderOnly(el)) continue;
    const rect = el.getBoundingClientRect();
    const overflowsRight = rect.right > viewportWidth + 1 && rect.left < viewportWidth;
    const overflowsLeft = rect.left < -1 && rect.right > 0;
    if (!overflowsRight && !overflowsLeft) continue;
    if (insideHorizontalScroller(el)) continue;
    // Report only the outermost element; its children overflow because of it.
    let ancestorReported = false;
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (reported.has(node)) {
        ancestorReported = true;
        break;
      }
    }
    if (ancestorReported) continue;
    reported.add(el);
    const overflowPx = Math.round(overflowsRight ? rect.right - viewportWidth : -rect.left);
    add({
      check: scrollingAllowed ? 'CONTENT_OVERFLOW' : 'OUT_OF_VIEWPORT',
      severity: overflowPx > 40 ? 'MEDIUM' : 'LOW',
      message: scrollingAllowed
        ? `This element is ${overflowPx}px wider than the screen and causes sideways scrolling.`
        : `This element extends ${overflowPx}px beyond the screen edge and is cut off.`,
      selector: selectorFor(el),
      html: snippet(el),
      box: pageBox(el),
      measurements: { overflowPx, elementWidth: Math.round(rect.width), viewportWidth },
    });
  }

  if (options.mode === 'all' || options.mode === 'layout') {
    // ------------------------------------------------------ 3. text clipping
    for (const el of all) {
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
      );
      if (!hasOwnText || !isVisible(el) || isScreenReaderOnly(el)) continue;
      const style = getComputedStyle(el);
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      if (!clipsX && !clipsY) continue;
      // Ellipsis and line-clamp are deliberate design choices, not bugs.
      if (style.textOverflow === 'ellipsis') continue;
      if (
        style.getPropertyValue('-webkit-line-clamp') &&
        style.getPropertyValue('-webkit-line-clamp') !== 'none'
      ) {
        continue;
      }
      const html = el as HTMLElement;
      const hiddenX = clipsX ? html.scrollWidth - html.clientWidth : 0;
      const hiddenY = clipsY ? html.scrollHeight - html.clientHeight : 0;
      if (hiddenX <= 2 && hiddenY <= 2) continue;
      add({
        check: 'TEXT_CLIPPING',
        severity: 'MEDIUM',
        message: `Text is cut off: ${Math.max(hiddenX, hiddenY)}px of it is hidden by overflow: hidden.`,
        selector: selectorFor(el),
        html: snippet(el),
        box: pageBox(el),
        measurements: { hiddenX, hiddenY },
      });
    }

    // ---------------------------------------- 4. overlapping (covered) controls
    const startScroll = window.scrollY;
    const maxSteps = 6;
    const seen = new Set<Element>();
    for (let step = 0; step < maxSteps; step += 1) {
      const top = step * viewportHeight;
      if (step > 0 && top >= root.scrollHeight) break;
      window.scrollTo(0, top);
      for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
        if (seen.has(el) || !isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cy < 0 || cx > viewportWidth || cy > viewportHeight) continue;
        seen.add(el);
        // Custom checkboxes etc. hide the real input under a styled element on purpose.
        if (Number(getComputedStyle(el).opacity) < 0.1) continue;
        const top = document.elementFromPoint(cx, cy);
        if (!top || top === el || el.contains(top) || top.contains(el)) continue;
        if (top instanceof HTMLLabelElement && top.control === el) continue;
        // Only an artifact of the scroll position.
        if (isFixedOrSticky(top)) continue;
        add({
          check: 'OVERLAPPING_ELEMENTS',
          severity: 'HIGH',
          message: 'Another element covers the centre of this control, so it may not be clickable.',
          selector: selectorFor(el),
          html: snippet(el),
          box: pageBox(el),
          measurements: { coveredBy: selectorFor(top) },
        });
      }
    }
    window.scrollTo(0, startScroll);

    // ------------------------------------------- 5. distorted images (sizing)
    for (const img of Array.from(document.images)) {
      if (!img.complete || img.naturalWidth === 0 || !isVisible(img)) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      if (getComputedStyle(img).objectFit !== 'fill') continue;
      const natural = img.naturalWidth / img.naturalHeight;
      const rendered = rect.width / rect.height;
      const distortion = Math.abs(rendered - natural) / natural;
      if (distortion < 0.15) continue;
      add({
        check: 'IMAGE_SIZING',
        severity: 'LOW',
        message: `The image is stretched: its shape differs ${Math.round(distortion * 100)}% from the original.`,
        selector: selectorFor(img),
        html: snippet(img),
        box: pageBox(img),
        measurements: { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight },
      });
    }
  }

  if (options.mode === 'all') {
    // ------------------------------------------------------ 6. broken images
    for (const img of Array.from(document.images)) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      if (img.loading === 'lazy' && !img.complete) continue; // not loaded yet, not broken
      if (!(img.complete && img.naturalWidth === 0)) continue;
      add({
        check: 'BROKEN_IMAGE',
        severity: 'MEDIUM',
        message: 'This image failed to load.',
        selector: selectorFor(img),
        html: snippet(img),
        box: isVisible(img) ? pageBox(img) : null,
        measurements: { src },
      });
    }

    // ------------------------------------------- 7. empty buttons and links
    const controls = document.querySelectorAll(
      'button, [role=button], input[type=button], input[type=submit], input[type=reset], a[href]',
    );
    for (const el of Array.from(controls)) {
      if (skip.has(el) || !isVisible(el)) continue;
      if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'reset')) continue; // browsers add a default label
      if (accessibleText(el)) continue;
      const isLink = el.tagName === 'A';
      add({
        check: isLink ? 'EMPTY_LINK' : 'EMPTY_BUTTON',
        severity: 'HIGH',
        message: isLink
          ? 'This link has no text or label, so its purpose is unknown.'
          : 'This button has no text or label, so its purpose is unknown.',
        selector: selectorFor(el),
        html: snippet(el),
        box: pageBox(el),
      });
    }
  }

  // ------------------------------------------------------------- snapshot
  const links: LinkInfo[] = [];
  const seenHrefs = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (links.length >= (options.maxLinks ?? 500)) break;
    const href = anchor.href;
    if (!/^https?:/i.test(href)) continue; // skip mailto:, tel:, javascript:
    if (seenHrefs.has(href)) continue; // one entry per distinct link on this page
    seenHrefs.add(href);
    links.push({
      href,
      text: (anchor.textContent ?? '').trim().slice(0, 120),
      selector: selectorFor(anchor),
      html: snippet(anchor),
    });
  }

  return {
    findings,
    snapshot: {
      title: document.title,
      lang: root.getAttribute('lang'),
      metaDescription:
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      h1Count: document.querySelectorAll('h1').length,
      seo: seoSnapshot(),
      insecureReferences: insecureReferences(selectorFor),
      viewportWidth,
      viewportHeight,
      documentWidth: scrollWidth,
      documentHeight: Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0),
      links,
    },
  };
}

/** Reads the on-page SEO signals. Text only; nothing is changed in the page. */
function seoSnapshot(): SeoSnapshot {
  const meta = (selector: string) =>
    document.querySelector(selector)?.getAttribute('content')?.trim() || null;
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .slice(0, 100)
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }));
  const images = Array.from(document.querySelectorAll('img'));
  const withoutAlt = images.filter(
    (img) =>
      !img.hasAttribute('alt') &&
      img.getAttribute('role') !== 'presentation' &&
      img.getAttribute('role') !== 'none' &&
      img.getAttribute('aria-hidden') !== 'true',
  ).length;
  return {
    metaRobots: meta('meta[name="robots" i]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    ogImage: meta('meta[property="og:image"]'),
    headings,
    imagesTotal: images.length,
    imagesWithoutAlt: withoutAlt,
  };
}

/**
 * Mixed content: on an https page, sub-resources or form targets that use plain http.
 * Read from the DOM because Chrome blocks or auto-upgrades such requests.
 */
function insecureReferences(selectorFor: (el: Element) => string): InsecureReference[] {
  if (location.protocol !== 'https:') return [];
  const found: InsecureReference[] = [];
  const add = (el: Element, kind: InsecureReference['kind'], raw: string | null) => {
    if (!raw || found.length >= 50) return;
    let url: URL;
    try {
      url = new URL(raw, document.baseURI);
    } catch {
      return;
    }
    if (url.protocol !== 'http:') return;
    found.push({
      kind,
      tag: el.tagName.toLowerCase(),
      url: url.href.slice(0, 300),
      selector: selectorFor(el),
    });
  };
  document
    .querySelectorAll('script[src]')
    .forEach((el) => add(el, 'active', el.getAttribute('src')));
  document
    .querySelectorAll('iframe[src], object[data], embed[src]')
    .forEach((el) => add(el, 'active', el.getAttribute('src') ?? el.getAttribute('data')));
  document
    .querySelectorAll('link[rel~="stylesheet" i][href]')
    .forEach((el) => add(el, 'active', el.getAttribute('href')));
  document
    .querySelectorAll('img[src], audio[src], video[src], source[src], video[poster]')
    .forEach((el) => add(el, 'passive', el.getAttribute('src') ?? el.getAttribute('poster')));
  document
    .querySelectorAll('form[action]')
    .forEach((el) => add(el, 'form', el.getAttribute('action')));
  return found;
}
