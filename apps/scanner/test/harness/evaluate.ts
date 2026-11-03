/**
 * Fixture acceptance harness (Phase 9). A manifest (tests/fixtures/manifests/*.json)
 * lists, for one fixture page, the issues deliberately seeded in it and the look-alike
 * elements that must NOT be reported (negative controls). evaluate() compares a scan's
 * findings with the manifest and computes recall and precision per detector category.
 *
 * Only findings classified DETECTED or POTENTIAL_DEFECT count as claims of a problem.
 * OBSERVATION and INCONCLUSIVE findings are listed but never count as false positives.
 */

export interface ExpectedFinding {
  /** Short stable name, used in reports (e.g. "wide-banner-overflow"). */
  id: string;
  category: string;
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
  scan: { maxPages: number; maxDepth: number; responsivePageLimit: number };
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
