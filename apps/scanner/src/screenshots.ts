import type { Box } from '@whc/dom-checks';
import type { Page } from 'playwright';

export interface CapturedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Very long pages are cut at this height to keep files reasonable. */
const MAX_FULL_PAGE_HEIGHT = 12_000;

export async function captureFullPage(page: Page): Promise<CapturedImage> {
  const size = (await page.evaluate(
    `({ w: Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth), h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) })`,
  )) as { w: number; h: number };
  const width = Math.max(1, Math.min(size.w, 4000));
  const height = Math.max(1, Math.min(size.h, MAX_FULL_PAGE_HEIGHT));
  const buffer = await page.screenshot({
    type: 'jpeg',
    quality: 70,
    fullPage: true,
    clip:
      size.h > MAX_FULL_PAGE_HEIGHT || size.w > 4000 ? { x: 0, y: 0, width, height } : undefined,
    animations: 'disabled',
    caret: 'hide',
    timeout: 30_000,
  });
  return { buffer, width, height };
}

export async function captureViewport(page: Page): Promise<CapturedImage> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const buffer = await page.screenshot({
    type: 'jpeg',
    quality: 70,
    animations: 'disabled',
    caret: 'hide',
    timeout: 30_000,
  });
  return { buffer, width: viewport.width, height: viewport.height };
}

const HIGHLIGHT_ID = '__whc_highlight';

/**
 * Screenshot of one problem: draws a red outline + label over the element (in page
 * coordinates), captures the area around it, then removes the outline again.
 */
export async function captureHighlightedIssue(
  page: Page,
  box: Box,
  label: string,
): Promise<CapturedImage> {
  const padding = 40;
  const doc = (await page.evaluate(
    `({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`,
  )) as { w: number; h: number };

  const overlay = `(() => {
    const box = ${JSON.stringify(box)};
    const el = document.createElement('div');
    el.id = ${JSON.stringify(HIGHLIGHT_ID)};
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute', left: (box.x - 3) + 'px', top: (box.y - 3) + 'px',
      width: (box.width + 6) + 'px', height: (box.height + 6) + 'px',
      outline: '3px solid #e11d48', background: 'rgba(225, 29, 72, 0.12)',
      zIndex: '2147483647', pointerEvents: 'none', boxSizing: 'border-box'
    });
    const tag = document.createElement('div');
    tag.textContent = ${JSON.stringify(label)};
    Object.assign(tag.style, {
      position: 'absolute', left: '-3px', top: '-22px', background: '#e11d48', color: '#fff',
      font: '600 12px/18px system-ui, sans-serif', padding: '1px 6px', whiteSpace: 'nowrap'
    });
    el.appendChild(tag);
    document.documentElement.appendChild(el);
  })()`;
  await page.evaluate(overlay);
  try {
    const x = Math.max(0, box.x - padding);
    const y = Math.max(0, box.y - padding - 20);
    const width = Math.max(1, Math.min(box.width + padding * 2, doc.w - x, 1600));
    const height = Math.max(1, Math.min(box.height + padding * 2 + 20, doc.h - y, 900));
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: true,
      clip: { x, y, width, height },
      animations: 'disabled',
      timeout: 15_000,
    });
    return { buffer, width: Math.round(width), height: Math.round(height) };
  } finally {
    await page
      .evaluate(`document.getElementById(${JSON.stringify(HIGHLIGHT_ID)})?.remove()`)
      .catch(() => {});
  }
}
