/**
 * Small DOM helpers shared by the in-page checks (checks.ts) and the safe explorer
 * (explore.ts). Browser-only code: no imports at runtime.
 */
import type { Box } from './types';

/** Rendered and not hidden by display/visibility/opacity. */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  if ('checkVisibility' in el) {
    return (el as Element & { checkVisibility(o: object): boolean }).checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    });
  }
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
}

export function pageBox(el: Element): Box {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top + window.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function snippet(el: Element): string {
  const html = el.outerHTML.replace(/\s+/g, ' ');
  if (html.length <= 300) return html;
  const openTag = html.slice(0, html.indexOf('>') + 1);
  return `${openTag.slice(0, 280)}…`;
}

/** A short CSS selector that matches only this element. */
export function selectorFor(el: Element): string {
  const unique = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  if (el.id && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute('data-testid');
  if (testId && unique(`[data-testid="${CSS.escape(testId)}"]`))
    return `[data-testid="${CSS.escape(testId)}"]`;

  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement && parts.length < 8) {
    let part = current.tagName.toLowerCase();
    if (current.id && unique(`#${CSS.escape(current.id)}`)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (unique(candidate)) return candidate;
    current = parent;
  }
  return parts.join(' > ');
}
