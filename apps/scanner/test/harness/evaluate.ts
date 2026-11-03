/**
 * Fixture acceptance harness (Phase 9). A manifest (tests/fixtures/manifests/*.json)
 * lists, for one fixture page, the issues deliberately seeded in it and the look-alike
 * elements that must NOT be reported (negative controls). evaluate() compares a scan's
 * findings with the manifest and computes recall and precision per detector category.
 *
 * Only findings classified DETECTED or POTENTIAL_DEFECT count as claims of a problem.
 * OBSERVATION and INCONCLUSIVE findings are listed but never count as false positives.
 *
 * evaluateDetectors() (Phase 9, Milestone 2) computes the same per detector (layout,
 * fonts and icons, consistency, explorer...). The Milestone 2 detectors are strict: on
 * every fixture, ANY of their findings that is not seeded counts as a false positive,
 * observations included, because their negative controls must stay completely silent.
 */

export interface ExpectedFinding {
  /** Short stable name, used in reports (e.g. "wide-banner-overflow"). */
  id: string;
  category: string;
  /** Detector the finding belongs to; default: derived from the rule (see detectorOf). */
  detector?: string;
  ruleId: string;
  /** One expected finding per listed viewport; omitted = any viewport, once. */
  viewports?: string[];
  /** Exact CSS selector the scanner reports. */
  selector?: string;
  /** Substring of the resource URL (images, links, files). */
  resource?: string;
  /** Substring of the description. */
  text?: string;
  /** Acceptable classifications (the strength of the evidence). */
  classification: string[];
}

export interface NegativeControl {
  id: string;
  /** Why it must not be reported. */
  reason: string;
  /** Any of these selectors (axe and the DOM checks name elements differently). */
  selectors?: string[];
  resource?: string;
  text?: string;
}

export interface FixtureManifest {
  /** Fixture name (folder under tests/fixtures/sites, or a server route). */
  fixture: string;
  /** Page to scan, relative to the fixture server. */
  startPath: string;
  /** Scan settings (same names as the Website model). */
  scan: {
    maxPages: number;
    maxDepth: number;
    responsivePageLimit: number;
    formProbeMode?: 'OFF' | 'STATIC' | 'BLUR' | 'SYNTHETIC';
    keyboardProbeEnabled?: boolean;
  };
  /**
   * Categories whose seeded issues are listed completely: any other DETECTED or
   * POTENTIAL_DEFECT finding in these categories is a false positive. Other categories
   * are reported but not scored (e.g. SEO and security of the local test server).
   */
  scoredCategories: string[];
  expected: ExpectedFinding[];
  negativeControls: NegativeControl[];
  /** Strings specific to this fixture that detector code must never contain. */
  forbiddenTokens?: string[];
}

/** What the harness needs from a stored issue. */
export interface Finding {
  category: string;
  ruleId: string;
  viewport: string | null;
  selector: string | null;
  resourceUrl: string | null;
  description: string;
  classification: string;
}

export interface CategoryResult {
  category: string;
  expected: number;
  found: number;
  /** Expected findings that were not reported (or reported with a weaker classification). */
  missed: string[];
  /** DETECTED / POTENTIAL_DEFECT findings that are not seeded issues. */
  falsePositives: string[];
  /** Of those, the ones on a negative control (always an error). */
  negativeControlHits: string[];
  recall: number;
  precision: number;
}

const CLAIMS = new Set(['DETECTED', 'POTENTIAL_DEFECT']);

function matches(
  finding: Finding,
  spec: { selector?: string; selectors?: string[]; resource?: string; text?: string },
): boolean {
  if (spec.selector !== undefined && finding.selector !== spec.selector) return false;
  if (spec.selectors !== undefined && !spec.selectors.includes(finding.selector ?? ''))
    return false;
  if (spec.resource !== undefined && !(finding.resourceUrl ?? '').includes(spec.resource))
    return false;
  if (spec.text !== undefined && !finding.description.includes(spec.text)) return false;
  return true;
}

const label = (f: Finding) =>
  `${f.ruleId} @ ${f.viewport ?? '-'} ${f.selector ?? f.resourceUrl ?? ''}`.trim();

export function evaluate(manifest: FixtureManifest, findings: Finding[]): CategoryResult[] {
  const categories = [
    ...new Set([...manifest.scoredCategories, ...manifest.expected.map((e) => e.category)]),
  ];
  return categories.map((category) => {
    const pool = findings.filter((f) => f.category === category);
    const used = new Set<Finding>();
    const missed: string[] = [];
    let expectedCount = 0;
    let found = 0;

    for (const spec of manifest.expected.filter((e) => e.category === category)) {
      for (const viewport of spec.viewports ?? [null]) {
        expectedCount += 1;
        const match = pool.find(
          (f) =>
            !used.has(f) &&
            f.ruleId === spec.ruleId &&
            (viewport === null || f.viewport === viewport) &&
            matches(f, spec),
        );
        if (match && spec.classification.includes(match.classification)) {
          used.add(match);
          found += 1;
        } else {
          missed.push(
            `${spec.id}${viewport ? ` @ ${viewport}` : ''}${match ? ` (classified ${match.classification}, expected ${spec.classification.join('/')})` : ''}`,
          );
          if (match) used.add(match);
        }
      }
    }

    const claims = pool.filter((f) => !used.has(f) && CLAIMS.has(f.classification));
    const negativeControlHits = claims
      .filter((f) => manifest.negativeControls.some((n) => matches(f, n)))
      .map((f) => {
        const control = manifest.negativeControls.find((n) => matches(f, n))!;
        return `${label(f)} (negative control "${control.id}": ${control.reason})`;
      });
    const scored = manifest.scoredCategories.includes(category);
    const falsePositives = scored
      ? claims.map(label)
      : claims.filter((f) => manifest.negativeControls.some((n) => matches(f, n))).map(label);

    return {
      category,
      expected: expectedCount,
      found,
      missed,
      falsePositives,
      negativeControlHits,
      recall: expectedCount === 0 ? 1 : found / expectedCount,
      precision: found + falsePositives.length === 0 ? 1 : found / (found + falsePositives.length),
    };
  });
}

/** Markdown table of all results, for the milestone report. */
export function formatResults(rows: { fixture: string; result: CategoryResult }[]): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    '| Fixture | Category | Expected | Found | Recall | False positives | Precision |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      ({ fixture, result: r }) =>
        `| ${fixture} | ${r.category} | ${r.expected} | ${r.found} | ${pct(r.recall)} | ${r.falsePositives.length} | ${pct(r.precision)} |`,
    ),
  ].join('\n');
}

/** Detectors of Milestone 2 (both checkpoints), scored strictly (see the header). */
export const STRICT_DETECTORS = [
  'layout',
  'fonts-icons',
  'consistency',
  'keyboard',
  'forms',
] as const;

const DETECTOR_OF_RULE: Record<string, string> = {
  'ui/text-overflow-visible': 'layout',
  'ui/text-overlap': 'layout',
  'ui/fixed-out-of-viewport': 'layout',
  'ui/control-label-clipped': 'layout',
  'ui/font-load-failed': 'fonts-icons',
  'ui/font-fallback-rendered': 'fonts-icons',
  'ui/icon-broken': 'fonts-icons',
  'ui/icon-missing': 'fonts-icons',
  'ui/component-inconsistent': 'consistency',
  'functional/focus-not-visible': 'keyboard',
  'functional/focus-on-hidden': 'keyboard',
  'functional/focus-lost': 'keyboard',
  'functional/keyboard-trap': 'keyboard',
  'functional/key-activation-failed': 'keyboard',
  'functional/click-not-focusable': 'keyboard',
  'functional/form-required-not-indicated': 'forms',
  'functional/form-indicator-without-required': 'forms',
  'functional/form-describedby-missing': 'forms',
  'functional/form-placeholder-only-label': 'forms',
  'functional/form-error-not-associated': 'forms',
  'functional/form-no-blur-feedback': 'forms',
};

/** "layout", "fonts-icons", "consistency", "explorer", or the category for older checks. */
export function detectorOf(f: { category: string; ruleId: string }): string {
  if (DETECTOR_OF_RULE[f.ruleId]) return DETECTOR_OF_RULE[f.ruleId]!;
  if (f.ruleId.startsWith('functional/')) return 'explorer';
  return f.category;
}

export interface DetectorResult extends Omit<CategoryResult, 'category'> {
  detector: string;
}

export function evaluateDetectors(
  manifest: FixtureManifest,
  findings: Finding[],
): DetectorResult[] {
  const expectedDetector = (e: ExpectedFinding) => e.detector ?? detectorOf(e);
  const isStrict = (d: string) => (STRICT_DETECTORS as readonly string[]).includes(d);
  const detectors = [
    ...new Set([
      ...STRICT_DETECTORS,
      ...manifest.scoredCategories.map((c) => (c === 'FUNCTIONAL' ? 'explorer' : c)),
      ...manifest.expected.map(expectedDetector),
      ...findings.filter((f) => manifest.scoredCategories.includes(f.category)).map(detectorOf),
    ]),
  ];
  return detectors.map((detector) => {
    const strict = isStrict(detector);
    const pool = findings.filter(
      (f) =>
        detectorOf(f) === detector && (strict || manifest.scoredCategories.includes(f.category)),
    );
    const used = new Set<Finding>();
    const missed: string[] = [];
    let expectedCount = 0;
    let found = 0;
    for (const spec of manifest.expected.filter((e) => expectedDetector(e) === detector)) {
      for (const viewport of spec.viewports ?? [null]) {
        expectedCount += 1;
        const match = findings.find(
          (f) =>
            !used.has(f) &&
            f.ruleId === spec.ruleId &&
            f.category === spec.category &&
            (viewport === null || f.viewport === viewport) &&
            matches(f, spec),
        );
        if (match) used.add(match);
        if (match && spec.classification.includes(match.classification)) found += 1;
        else {
          missed.push(
            `${spec.id}${viewport ? ` @ ${viewport}` : ''}${match ? ` (classified ${match.classification}, expected ${spec.classification.join('/')})` : ''}`,
          );
        }
      }
    }
    const claims = pool.filter((f) => !used.has(f) && (strict || CLAIMS.has(f.classification)));
    const negativeControlHits = claims
      .filter((f) => manifest.negativeControls.some((n) => matches(f, n)))
      .map(
        (f) =>
          `${label(f)} (negative control "${manifest.negativeControls.find((n) => matches(f, n))!.id}")`,
      );
    return {
      detector,
      expected: expectedCount,
      found,
      missed,
      falsePositives: claims.map((f) => `${label(f)} [${f.classification}]`),
      negativeControlHits,
      recall: expectedCount === 0 ? 1 : found / expectedCount,
      precision: found + claims.length === 0 ? 1 : found / (found + claims.length),
    };
  });
}

/** Totals per detector over all fixtures, for the milestone report. */
export function formatDetectorTotals(rows: { fixture: string; result: DetectorResult }[]): string {
  const totals = new Map<
    string,
    { fixtures: number; expected: number; found: number; fp: number }
  >();
  for (const { result: r } of rows) {
    const t = totals.get(r.detector) ?? { fixtures: 0, expected: 0, found: 0, fp: 0 };
    t.fixtures += 1;
    t.expected += r.expected;
    t.found += r.found;
    t.fp += r.falsePositives.length;
    totals.set(r.detector, t);
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    '| Detector | Fixture pages | Expected | Found | Recall | False positives | Precision |',
    '|---|---|---|---|---|---|---|',
    ...[...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([d, t]) =>
          `| ${d} | ${t.fixtures} | ${t.expected} | ${t.found} | ${pct(t.expected === 0 ? 1 : t.found / t.expected)} | ${t.fp} | ${pct(t.found + t.fp === 0 ? 1 : t.found / (t.found + t.fp))} |`,
      ),
  ].join('\n');
}
