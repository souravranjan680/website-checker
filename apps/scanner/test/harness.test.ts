/**
 * The fixture harness itself (evaluate()), and the rule that detector code contains
 * no fixture-specific or QA-report-specific logic.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate, type Finding, type FixtureManifest } from './harness/evaluate';

const finding = (overrides: Partial<Finding>): Finding => ({
  category: 'UI_HEALTH',
  ruleId: 'ui/overlapping-elements',
  viewport: '1920x1080',
  selector: '.a',
  resourceUrl: null,
  description: 'd',
  classification: 'POTENTIAL_DEFECT',
  ...overrides,
});

const manifest: FixtureManifest = {
  fixture: 't',
  startPath: '/',
  scan: { maxPages: 1, maxDepth: 0, responsivePageLimit: 0 },
  scoredCategories: ['UI_HEALTH'],
  expected: [
    {
      id: 'covered',
      category: 'UI_HEALTH',
      ruleId: 'ui/overlapping-elements',
      selector: '.a',
      classification: ['POTENTIAL_DEFECT'],
    },
    {
      id: 'clipped',
      category: 'UI_HEALTH',
      ruleId: 'ui/text-clipping',
      viewports: ['390x844', '320x568'],
      classification: ['POTENTIAL_DEFECT'],
    },
  ],
  negativeControls: [{ id: 'ellipsis', reason: 'on purpose', selectors: ['.ellipsis'] }],
};

describe('evaluate()', () => {
  it('computes recall and precision per category', () => {
    const [ui] = evaluate(manifest, [
      finding({}),
      finding({ ruleId: 'ui/text-clipping', viewport: '390x844', selector: '.b' }),
      finding({ ruleId: 'ui/text-clipping', viewport: '1920x1080', selector: '.c' }), // unlisted
      finding({ ruleId: 'ui/text-clipping', selector: '.ellipsis' }), // negative control
      finding({ ruleId: 'ui/content-overflow', classification: 'OBSERVATION' }), // not a claim
    ]);
    expect(ui).toMatchObject({ expected: 3, found: 2 });
    expect(ui!.missed).toEqual(['clipped @ 320x568']);
    expect(ui!.recall).toBeCloseTo(2 / 3);
    expect(ui!.falsePositives).toHaveLength(2);
    expect(ui!.negativeControlHits).toEqual([
      expect.stringContaining('negative control "ellipsis"'),
    ]);
    expect(ui!.precision).toBeCloseTo(2 / 4);
  });

  it('counts a weaker classification than expected as a miss', () => {
    const [ui] = evaluate(manifest, [finding({ classification: 'OBSERVATION' })]);
    expect(ui!.missed[0]).toContain('classified OBSERVATION, expected POTENTIAL_DEFECT');
  });

  it('does not score unlisted categories, except negative controls', () => {
    const results = evaluate(manifest, [
      finding({ category: 'SECURITY', ruleId: 'security/missing-csp', selector: null }),
      finding({ category: 'SEO', ruleId: 'seo/x', selector: '.ellipsis' }),
    ]);
    expect(results.map((r) => r.category)).toEqual(['UI_HEALTH']);
  });
});

// ------------------------------------------------- no fixture-specific detector logic

const ROOT = path.resolve(import.meta.dirname, '../../..');
/** Code that decides what is reported (detectors, classification, presentation). */
const DETECTOR_DIRS = ['apps/scanner/src', 'packages/dom-checks/src', 'packages/shared/src'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx|js)$/.test(name) ? [full] : [];
  });
}

/**
 * Distinctive strings of the fixtures: page titles plus each manifest's list. (Headings
 * are not used: phrases such as "Console messages" are ordinary words in code comments.)
 */
function fixtureTokens(): string[] {
  const tokens = new Set<string>(['fixtures.whc.test']);
  for (const file of files(path.join(ROOT, 'tests/fixtures/sites')).concat(
    readdirSync(path.join(ROOT, 'tests/fixtures/sites'), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.html'))
      .map((f) => path.join(ROOT, 'tests/fixtures/sites', f)),
  )) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<title[^>]*>([^<]{6,})<\/title>/g))
      tokens.add(match[1]!.trim());
  }
  const manifestDir = path.join(ROOT, 'tests/fixtures/manifests');
  for (const name of readdirSync(manifestDir).filter((n) => n.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(path.join(manifestDir, name), 'utf8')) as FixtureManifest;
    for (const token of m.forbiddenTokens ?? []) tokens.add(token);
  }
  return [...tokens];
}

describe('detectors contain no fixture- or QA-report-specific logic', () => {
  const sources = DETECTOR_DIRS.flatMap((dir) => files(path.join(ROOT, dir))).map((file) => ({
    file: path.relative(ROOT, file),
    text: readFileSync(file, 'utf8'),
  }));
  const tokens = fixtureTokens();

  it('has fixture tokens to check against', () => {
    expect(tokens.length).toBeGreaterThan(10);
    expect(sources.length).toBeGreaterThan(20);
  });

  it('never mentions QA report IDs', () => {
    const hits = sources.filter((s) => /\bQA-\d{3}\b/.test(s.text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it('never mentions fixture page titles or listed fixture strings', () => {
    const hits = sources.flatMap((s) =>
      tokens
        .filter((token) => s.text.toLowerCase().includes(token.toLowerCase()))
        .map((token) => `${s.file}: "${token}"`),
    );
    expect(hits).toEqual([]);
  });
});
