/** Visual comparison rules with synthetic images: exact and fast (no browser). */
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { compareImages, MIN_BLOCK_DIFF, parseIgnoreSettings } from '../src/audits/visual';

/** A white image, with optional black rectangles painted on it. */
function image(
  width: number,
  height: number,
  rects: { x: number; y: number; width: number; height: number }[] = [],
): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.height; y += 1) {
      for (let x = r.x; x < r.x + r.width; x += 1) {
        const i = (y * width + x) * 4;
        png.data[i] = 0;
        png.data[i + 1] = 0;
        png.data[i + 2] = 0;
      }
    }
  }
  return PNG.sync.write(png);
}

describe('compareImages', () => {
  it('reports identical images as UNCHANGED', () => {
    const r = compareImages(image(200, 200), image(200, 200), { failPercent: 0.5 });
    expect(r).toMatchObject({
      status: 'UNCHANGED',
      passed: true,
      diffPixels: 0,
      rawDiffPixels: 0,
      regions: [],
    });
  });

  it('ignores scattered single-pixel noise (anti-aliasing, font smoothing)', () => {
    // 20 isolated pixels, each in a different 32×32 block: below MIN_BLOCK_DIFF per block.
    const noise = Array.from({ length: 20 }, (_, i) => ({
      x: (i % 5) * 40 + 3,
      y: Math.floor(i / 5) * 40 + 3,
      width: 1,
      height: 1,
    }));
    const r = compareImages(image(200, 200), image(200, 200, noise), { failPercent: 0.5 });
    expect(r.rawDiffPixels).toBeGreaterThan(0);
    expect(r.diffPixels).toBe(0);
    expect(r).toMatchObject({ status: 'MINOR', passed: true, diffPercent: 0, regions: [] });
  });

  it('reports a real change above the threshold as CHANGED, with its region', () => {
    const r = compareImages(
      image(400, 400),
      image(400, 400, [{ x: 100, y: 100, width: 60, height: 60 }]),
      {
        failPercent: 0.5,
      },
    );
    expect(r.status).toBe('CHANGED');
    expect(r.passed).toBe(false);
    expect(r.diffPixels).toBe(3600);
    expect(r.diffPercent).toBeCloseTo(2.25, 2);
    // The changed area, rounded out to 32-pixel blocks.
    expect(r.regions).toEqual([{ x: 96, y: 96, width: 64, height: 64 }]); // pixels 100-159 = blocks 96-159
    const diff = PNG.sync.read(r.diffPng);
    expect([diff.width, diff.height]).toEqual([400, 400]);
  });

  it('treats a small real change under the threshold as MINOR', () => {
    const r = compareImages(
      image(400, 400),
      image(400, 400, [{ x: 10, y: 10, width: 10, height: 10 }]),
      {
        failPercent: 0.5,
      },
    );
    expect(r.diffPixels).toBeGreaterThanOrEqual(MIN_BLOCK_DIFF);
    expect(r).toMatchObject({ status: 'MINOR', passed: true });
    expect(r.regions).toHaveLength(1);
  });

  it('skips ignore regions (e.g. a carousel or a date)', () => {
    const changed = image(400, 400, [{ x: 100, y: 100, width: 60, height: 60 }]);
    const r = compareImages(image(400, 400), changed, {
      failPercent: 0.5,
      ignoreRegions: [{ x: 90, y: 90, width: 80, height: 80 }],
    });
    expect(r).toMatchObject({ status: 'UNCHANGED', diffPixels: 0 });
  });

  it('reports a page that got much taller as CHANGED (size change)', () => {
    const r = compareImages(image(300, 1000), image(300, 1200), { failPercent: 50 });
    expect(r.size).toEqual({
      baseline: { width: 300, height: 1000 },
      current: { width: 300, height: 1200 },
      changed: true,
    });
    expect(r.status).toBe('CHANGED');
    // A height change within 5 % is not a size change on its own.
    expect(
      compareImages(image(300, 1000), image(300, 1030), { failPercent: 50 }).size.changed,
    ).toBe(false);
  });
});

describe('parseIgnoreSettings', () => {
  it('accepts rectangles and CSS selectors, ignoring anything else', () => {
    expect(
      parseIgnoreSettings([
        { x: 1, y: 2, width: 3, height: 4 },
        { selector: ' .carousel ' },
        { selector: '' },
        { x: 'a' },
        'nonsense',
      ]),
    ).toEqual({ rects: [{ x: 1, y: 2, width: 3, height: 4 }], selectors: ['.carousel'] });
    expect(parseIgnoreSettings(null)).toEqual({ rects: [], selectors: [] });
  });
});
