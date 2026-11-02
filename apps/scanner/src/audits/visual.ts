import pixelmatch from 'pixelmatch';
import type { Page } from 'playwright';
import { PNG } from 'pngjs';

/**
 * Visual regression: comparable PNG captures and a noise-tolerant comparison.
 *
 * Small rendering noise (font smoothing, anti-aliasing) must not look like a defect:
 *   1. pixelmatch with anti-aliasing detection (anti-aliased pixels are ignored)
 *   2. the image is split into 32×32 blocks; a block only counts as changed when at
 *      least MIN_BLOCK_DIFF pixels in it differ (isolated speckles are dropped)
 *   3. the result is CHANGED only above the baseline's threshold (default 0.5 %)
 */

/** Freezes things that move: animations, transitions, the text caret, smooth scrolling. */
export const STABILIZE_CSS = `*, *::before, *::after {
  animation: none !important; transition: none !important;
  caret-color: transparent !important; scroll-behavior: auto !important;
}`;

/** Tall pages are cut here: comparisons stay fast and files small. */
export const MAX_CAPTURE_HEIGHT = 4000;
export const BLOCK_SIZE = 32;
export const MIN_BLOCK_DIFF = 8;
/** A page that got more than 5 % taller/shorter counts as changed. */
export const SIZE_CHANGE_RATIO = 0.05;
/** Masked areas are painted this colour in both images (and in the capture). */
const MASK_COLOR = { r: 255, g: 0, b: 255 };

export interface IgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualCapture {
  buffer: Buffer;
  width: number;
  height: number;
  /** The page was taller than MAX_CAPTURE_HEIGHT and was cut. */
  truncated: boolean;
  /**
   * Where the ignored elements are on this page. The comparison blanks these areas in
   * BOTH images, so content that changes (a clock, a carousel) never counts as a change.
   */
  ignoredRegions: IgnoreRegion[];
}

/** Takes a stable PNG of the current page and measures the elements to ignore. */
export async function captureVisual(
  page: Page,
  maskSelectors: string[] = [],
): Promise<VisualCapture> {
  await page.addStyleTag({ content: STABILIZE_CSS });
  // In-page code as strings: the scanner is compiled without the browser's DOM types.
  await page.evaluate('document.fonts.ready.then(() => undefined)');
  await page.evaluate('window.scrollTo(0, 0)');
  const size = (await page.evaluate(
    '({ width: document.documentElement.clientWidth, height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) })',
  )) as { width: number; height: number };
  const height = Math.min(size.height, MAX_CAPTURE_HEIGHT);
  const buffer = await page.screenshot({
    type: 'png',
    fullPage: true,
    clip: { x: 0, y: 0, width: size.width, height },
    animations: 'disabled',
    caret: 'hide',
  });
  // Measured after scrolling to the top, so box coordinates are page coordinates.
  const ignoredRegions: IgnoreRegion[] = [];
  for (const selector of maskSelectors) {
    const matches = await page
      .locator(selector)
      .all()
      .catch(() => []);
    for (const match of matches.slice(0, 20)) {
      const box = await match.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) ignoredRegions.push(box);
    }
  }
  return {
    buffer,
    width: size.width,
    height,
    truncated: size.height > MAX_CAPTURE_HEIGHT,
    ignoredRegions,
  };
}

export type ComparisonStatus = 'UNCHANGED' | 'MINOR' | 'CHANGED';

export interface ComparisonResult {
  status: ComparisonStatus;
  passed: boolean;
  /** Pixels in "changed" blocks (noise excluded). */
  diffPixels: number;
  /** Every pixel pixelmatch flagged, including isolated noise. */
  rawDiffPixels: number;
  totalPixels: number;
  diffPercent: number;
  /** Bounding boxes of changed areas, biggest first (max 20). */
  regions: IgnoreRegion[];
  size: {
    baseline: { width: number; height: number };
    current: { width: number; height: number };
    changed: boolean;
  };
  /** Red marks on a faded copy of the current image. */
  diffPng: Buffer;
}

/** Copies a PNG into a canvas of the given size (extra area white), painting ignore regions. */
function normalize(png: PNG, width: number, height: number, ignore: IgnoreRegion[]): Buffer {
  const out = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < Math.min(png.height, height); y += 1) {
    png.data.copy(
      out,
      y * width * 4,
      y * png.width * 4,
      y * png.width * 4 + Math.min(png.width, width) * 4,
    );
  }
  for (const region of ignore) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(width, Math.ceil(region.x + region.width));
    const y1 = Math.min(height, Math.ceil(region.y + region.height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * 4;
        out[i] = MASK_COLOR.r;
        out[i + 1] = MASK_COLOR.g;
        out[i + 2] = MASK_COLOR.b;
        out[i + 3] = 255;
      }
    }
  }
  return out;
}

/** Groups changed blocks that touch into rectangles (flood fill on the block grid). */
export function changedRegions(
  blockDiffs: Uint32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
): IgnoreRegion[] {
  const seen = new Uint8Array(cols * rows);
  const regions: (IgnoreRegion & { pixels: number })[] = [];
  for (let start = 0; start < cols * rows; start += 1) {
    if (seen[start] || blockDiffs[start]! < MIN_BLOCK_DIFF) continue;
    let minX = cols,
      minY = rows,
      maxX = 0,
      maxY = 0,
      pixels = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      const bx = index % cols;
      const by = Math.floor(index / cols);
      minX = Math.min(minX, bx);
      maxX = Math.max(maxX, bx);
      minY = Math.min(minY, by);
      maxY = Math.max(maxY, by);
      pixels += blockDiffs[index]!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = bx + dx;
        const ny = by + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (!seen[next] && blockDiffs[next]! >= MIN_BLOCK_DIFF) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    regions.push({
      x: minX * BLOCK_SIZE,
      y: minY * BLOCK_SIZE,
      width: Math.min(width, (maxX + 1) * BLOCK_SIZE) - minX * BLOCK_SIZE,
      height: Math.min(height, (maxY + 1) * BLOCK_SIZE) - minY * BLOCK_SIZE,
      pixels,
    });
  }
  return regions
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, 20)
    .map(({ x, y, width: w, height: h }) => ({ x, y, width: w, height: h }));
}

/** Compares a baseline and a current PNG (same page, same viewport). */
export function compareImages(
  baselinePng: Buffer,
  currentPng: Buffer,
  options: { failPercent: number; ignoreRegions?: IgnoreRegion[]; threshold?: number },
): ComparisonResult {
  const baseline = PNG.sync.read(baselinePng);
  const current = PNG.sync.read(currentPng);
  const width = Math.max(baseline.width, current.width);
  const height = Math.max(baseline.height, current.height);
  const ignore = options.ignoreRegions ?? [];
  const a = normalize(baseline, width, height, ignore);
  const b = normalize(current, width, height, ignore);
  const diff = new PNG({ width, height });

  const rawDiffPixels = pixelmatch(a, b, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: false, // anti-aliased edge pixels are not differences
    alpha: 0.15,
    diffColor: [220, 38, 38],
    aaColor: [255, 255, 255],
  });

  // Count red diff pixels per block.
  const cols = Math.ceil(width / BLOCK_SIZE);
  const rows = Math.ceil(height / BLOCK_SIZE);
  const blockDiffs = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (diff.data[i] === 220 && diff.data[i + 1] === 38 && diff.data[i + 2] === 38) {
        blockDiffs[Math.floor(y / BLOCK_SIZE) * cols + Math.floor(x / BLOCK_SIZE)]! += 1;
      }
    }
  }
  let diffPixels = 0;
  for (const count of blockDiffs) if (count >= MIN_BLOCK_DIFF) diffPixels += count;

  const totalPixels = width * height;
  const diffPercent = Number(((diffPixels / totalPixels) * 100).toFixed(4));
  const sizeChanged =
    baseline.width !== current.width ||
    Math.abs(baseline.height - current.height) / Math.max(1, baseline.height) > SIZE_CHANGE_RATIO;
  const status: ComparisonStatus =
    sizeChanged || diffPercent > options.failPercent
      ? 'CHANGED'
      : rawDiffPixels === 0
        ? 'UNCHANGED'
        : 'MINOR';

  return {
    status,
    passed: status !== 'CHANGED',
    diffPixels,
    rawDiffPixels,
    totalPixels,
    diffPercent,
    regions: changedRegions(blockDiffs, cols, rows, width, height),
    size: {
      baseline: { width: baseline.width, height: baseline.height },
      current: { width: current.width, height: current.height },
      changed: sizeChanged,
    },
    diffPng: PNG.sync.write(diff),
  };
}

/** Ignore settings stored on a baseline: rectangles and/or CSS selectors. */
export function parseIgnoreSettings(value: unknown): {
  rects: IgnoreRegion[];
  selectors: string[];
} {
  const rects: IgnoreRegion[] = [];
  const selectors: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>;
        if (typeof r.selector === 'string' && r.selector.trim()) selectors.push(r.selector.trim());
        else if ([r.x, r.y, r.width, r.height].every((n) => typeof n === 'number')) {
          rects.push({
            x: r.x as number,
            y: r.y as number,
            width: r.width as number,
            height: r.height as number,
          });
        }
      }
    }
  }
  return { rects, selectors };
}
