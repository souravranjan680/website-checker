/**
 * Phase 9, Milestone 2 (Checkpoint 1): the pure decisions of the layout, font, icon and
 * consistency checks, how font failures are matched to failed requests, and the list of
 * checks that count towards the UI health score.
 */
import {
  consistencyOutliers,
  contentText,
  crossPageDeviations,
  EXTRA_CHECKS,
  isPrivateUse,
  parseUnicodeRange,
  primaryFamily,
  rangeCoversText,
  styleDistance,
  summarizeComponents,
  type ComponentMember,
  type ComponentStyle,
  type ExtraResult,
  type FontFaceFact,
} from '@whc/dom-checks';
import { describe, expect, it } from 'vitest';
import type { FailedRequest, PageNetworkLog } from '../src/checks/collectors';
import { fontAndIconDrafts } from '../src/extra-issues';
import { countsTowardsUiScore, SCORED_UI_CHECKS } from '../src/finalize';
import { classifyDraft, networkToDrafts } from '../src/issues';

const ctx = { websiteId: 'w1', pageUrl: 'https://example.com/', viewport: '1920x1080' };

describe('fonts', () => {
  it('parses unicode-range lists, including wildcards', () => {
    expect(parseUnicodeRange('U+0-7F, U+2000-206F, U+20AC')).toEqual([
      [0, 0x7f],
      [0x2000, 0x206f],
      [0x20ac, 0x20ac],
    ]);
    expect(parseUnicodeRange('U+4??')).toEqual([[0x400, 0x4ff]]);
    expect(parseUnicodeRange('')).toEqual([[0, 0x10ffff]]);
  });

  it('knows which text a subset face would be used for', () => {
    expect(rangeCoversText('U+0400-04FF', 'Hello')).toBe(false);
    expect(rangeCoversText('U+0400-04FF', 'Привет')).toBe(true);
    expect(rangeCoversText('U+0-10FFFF', 'Hello')).toBe(true);
  });

  it('reads the first family of a font-family list', () => {
    expect(primaryFamily(`"Brand Sans", system-ui, sans-serif`)).toBe('Brand Sans');
    expect(primaryFamily(`'Brand', serif`)).toBe('Brand');
    expect(primaryFamily('Georgia')).toBe('Georgia');
  });

  it('recognises icon-font glyphs (Private Use Area) and pseudo-element content', () => {
    expect(isPrivateUse('')).toBe(true);
    expect(isPrivateUse('')).toBe(true);
    expect(isPrivateUse('A')).toBe(false);
    expect(isPrivateUse('A')).toBe(false);
    expect(isPrivateUse('')).toBe(false);
    expect(contentText('""')).toBe('');
    expect(contentText('none')).toBeNull();
  });
});

function face(overrides: Partial<FontFaceFact>): FontFaceFact {
  return {
    family: 'Brand',
    style: 'normal',
    weight: '400',
    status: 'loaded',
    display: 'auto',
    unicodeRange: 'U+0-10FFFF',
    sources: [],
    sourcesKnown: true,
    ...overrides,
  };
}
function extra(overrides: Partial<ExtraResult>): ExtraResult {
  return {
    findings: [],
    fonts: [],
    fallbacks: [],
    glyphIcons: [],
    externalUses: [],
    components: [],
    ...overrides,
  };
}
function log(failed: Partial<FailedRequest>[]): PageNetworkLog {
  return {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: failed.map((f) => ({
      url: 'https://example.com/x',
      resourceType: 'font',
      status: 404,
      blockedByPolicy: false,
      verdict: 'CONFIRMED',
      verdictReason: 'The server answered HTTP 404, and HTTP 404 again on a re-check.',
      ...f,
    })),
    imageResponses: new Map(),
  } as unknown as PageNetworkLog;
}

describe('font failures are matched to failed requests before replacing them', () => {
  const missing = 'https://example.com/fonts/brand.woff2';

  it('a failed face whose source failed (re-check confirmed): detected, and the generic issue is replaced', () => {
    const network = log([{ url: missing }]);
    const { drafts, reportedElsewhere } = fontAndIconDrafts(
      extra({ fonts: [face({ status: 'error', sources: [missing] })] }),
      network,
      ctx,
    );
    expect(drafts.map((d) => [d.ruleId, classifyDraft(d)])).toEqual([
      ['ui/font-load-failed', 'DETECTED'],
    ]);
    expect([...reportedElsewhere]).toEqual([missing]);
    expect(networkToDrafts(network, ctx, 'example.com', new Set(), reportedElsewhere)).toEqual([]);
  });

  it('a failed font file that is NOT the source of a failed face stays a failed-request issue', () => {
    // The face's first source is missing, the second loads: the face works.
    const network = log([{ url: missing }]);
    const { drafts, reportedElsewhere } = fontAndIconDrafts(
      extra({
        fonts: [face({ status: 'loaded', sources: [missing, 'https://example.com/ok.woff2'] })],
      }),
      network,
      ctx,
    );
    expect(drafts).toEqual([]);
    expect(reportedElsewhere.size).toBe(0);
    const generic = networkToDrafts(network, ctx, 'example.com', new Set(), reportedElsewhere);
    expect(generic.map((d) => d.ruleId)).toEqual(['ui/failed-request']);
  });

  it('an unrelated failed request is never hidden, even next to a failed face', () => {
    const other = 'https://example.com/fonts/other.woff2';
    const network = log([{ url: missing }, { url: other }]);
    const { reportedElsewhere } = fontAndIconDrafts(
      extra({ fonts: [face({ status: 'error', sources: [missing] })] }),
      network,
      ctx,
    );
    const generic = networkToDrafts(network, ctx, 'example.com', new Set(), reportedElsewhere);
    expect(generic.map((d) => d.uiHealth?.resourceUrl)).toEqual([other]);
  });

  it('a failed face whose stylesheet could not be read: potential defect, nothing replaced', () => {
    const network = log([{ url: missing }]);
    const { drafts, reportedElsewhere } = fontAndIconDrafts(
      extra({ fonts: [face({ status: 'error', sources: [], sourcesKnown: false })] }),
      network,
      ctx,
    );
    expect(drafts.map((d) => classifyDraft(d))).toEqual(['POTENTIAL_DEFECT']);
    expect(reportedElsewhere.size).toBe(0);
  });

  it('a failure the re-check could not confirm: potential defect, and the request is not replaced', () => {
    const network = log([{ url: missing, verdict: 'INCONCLUSIVE' }]);
    const { drafts, reportedElsewhere } = fontAndIconDrafts(
      extra({ fonts: [face({ status: 'error', sources: [missing] })] }),
      network,
      ctx,
    );
    expect(drafts.map((d) => classifyDraft(d))).toEqual(['POTENTIAL_DEFECT']);
    expect(reportedElsewhere.size).toBe(0);
  });

  it('fallback text: a potential defect when its font failed, otherwise an observation', () => {
    const sample = { selector: 'h1', html: '<h1>', box: null, text: 'Hello' };
    const failed = fontAndIconDrafts(
      extra({
        fonts: [face({ status: 'error' })],
        fallbacks: [{ family: 'Brand', elements: 1, sample }],
      }),
      log([]),
      ctx,
    ).drafts.find((d) => d.ruleId === 'ui/font-fallback-rendered')!;
    expect(classifyDraft(failed)).toBe('POTENTIAL_DEFECT');
    const slow = fontAndIconDrafts(
      extra({
        fonts: [face({ status: 'loading' })],
        fallbacks: [{ family: 'Brand', elements: 1, sample }],
      }),
      log([]),
      ctx,
    ).drafts;
    expect(slow.map((d) => [d.ruleId, classifyDraft(d)])).toEqual([
      ['ui/font-fallback-rendered', 'OBSERVATION'],
    ]);
  });

  it('icon-font glyphs are broken only when their font failed and no face loaded', () => {
    const glyphIcons = [
      { family: 'Icons', elements: 3, sample: { selector: 'i', html: '<i>', box: null } },
    ];
    const broken = fontAndIconDrafts(
      extra({ fonts: [face({ family: 'Icons', status: 'error' })], glyphIcons }),
      log([]),
      ctx,
    ).drafts.filter((d) => d.ruleId === 'ui/icon-broken');
    expect(broken).toHaveLength(1);
    const fine = fontAndIconDrafts(
      extra({ fonts: [face({ family: 'Icons', status: 'loaded' })], glyphIcons }),
      log([]),
      ctx,
    ).drafts;
    expect(fine).toEqual([]);
  });

  it('a missing sprite file is matched by URL; a loaded sprite with an empty icon is only potential', () => {
    const sprite = 'https://example.com/sprite.svg';
    const use = {
      url: sprite,
      fragment: 'star',
      empty: true,
      selector: 'svg',
      html: '<svg>',
      box: null,
    };
    const missing = fontAndIconDrafts(
      extra({ externalUses: [use] }),
      log([{ url: sprite, resourceType: 'other' }]),
      ctx,
    );
    expect(missing.drafts.map((d) => classifyDraft(d))).toEqual(['DETECTED']);
    expect([...missing.reportedElsewhere]).toEqual([sprite]);
    const empty = fontAndIconDrafts(extra({ externalUses: [use] }), log([]), ctx);
    expect(empty.drafts.map((d) => classifyDraft(d))).toEqual(['POTENTIAL_DEFECT']);
    const fine = fontAndIconDrafts(
      extra({ externalUses: [{ ...use, empty: false }] }),
      log([]),
      ctx,
    );
    expect(fine.drafts).toEqual([]);
  });
});

const BASE_STYLE: ComponentStyle = {
  height: 38,
  paddingTop: 8,
  paddingRight: 14,
  paddingBottom: 8,
  paddingLeft: 14,
  fontFamily: 'system-ui',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 6,
  borderWidth: 1,
  color: 'rgb(29, 36, 51)',
  backgroundColor: 'rgb(255, 255, 255)',
  borderColor: 'rgb(154, 163, 178)',
};
function member(
  i: number,
  style: Partial<ComponentStyle> = {},
  own: (keyof ComponentStyle)[] = [],
  key = 'button|button||btn|main',
): ComponentMember {
  return {
    kind: 'button',
    key,
    label: 'button.btn in main',
    selector: `#b${i}`,
    html: '<button>',
    box: null,
    style: { ...BASE_STYLE, ...style },
    ownOverrides: own,
  };
}

describe('component consistency', () => {
  it('compares colours by channel and treats all transparent colours as equal', () => {
    expect(styleDistance('color', 'rgb(0, 0, 0)', 'rgb(10, 0, 0)')).toBe(10);
    expect(styleDistance('backgroundColor', 'rgba(0, 0, 0, 0)', 'rgba(255, 0, 0, 0)')).toBe(0);
    expect(styleDistance('fontFamily', 'Arial', 'arial')).toBe(0);
    expect(styleDistance('fontFamily', 'Arial', 'Georgia')).toBe(Infinity);
  });

  it('never compares groups of fewer than 4', () => {
    const members = [member(1), member(2), member(3, { paddingTop: 30 }, ['paddingTop'])];
    expect(consistencyOutliers(members)).toEqual([]);
  });

  it('an outlier among comparable members is an observation', () => {
    const members = [1, 2, 3, 4].map((i) => member(i)).concat(member(5, { borderRadius: 14 }));
    const [outlier, ...rest] = consistencyOutliers(members);
    expect(rest).toEqual([]);
    expect(outlier!.member.selector).toBe('#b5');
    expect(outlier!.strong).toBe(false);
    expect(outlier!.deviations.map((d) => d.property)).toEqual(['borderRadius']);
  });

  it('strong evidence needs 6+ members, 85% agreement, a large difference AND a style set on the element itself', () => {
    const six = [1, 2, 3, 4, 5, 6].map((i) => member(i));
    const own = consistencyOutliers([...six, member(7, { paddingTop: 18 }, ['paddingTop'])]);
    expect(own[0]!.strong).toBe(true);
    // Same difference, but from a shared rule: only an observation.
    const shared = consistencyOutliers([...six, member(7, { paddingTop: 18 })]);
    expect(shared[0]!.strong).toBe(false);
    // Small difference: an observation.
    const small = consistencyOutliers([...six, member(7, { paddingTop: 13 }, ['paddingTop'])]);
    expect(small[0]!.strong).toBe(false);
    // Too few members for strong evidence.
    const five = [1, 2, 3, 4].map((i) => member(i));
    expect(
      consistencyOutliers([...five, member(5, { paddingTop: 18 }, ['paddingTop'])])[0]!.strong,
    ).toBe(false);
  });

  it('does not report when no value has 75% of the members (no usual look)', () => {
    const members = [
      member(1, { fontSize: 12 }),
      member(2, { fontSize: 12 }),
      member(3, { fontSize: 16 }),
      member(4, { fontSize: 16 }),
    ];
    expect(consistencyOutliers(members)).toEqual([]);
  });

  it('members with different keys (variants, contexts) are never compared', () => {
    const members = [1, 2, 3, 4]
      .map((i) => member(i))
      .concat(
        [5, 6, 7, 8].map((i) =>
          member(i, { paddingTop: 2, fontSize: 12 }, [], 'button|button||btn|table'),
        ),
      );
    expect(consistencyOutliers(members)).toEqual([]);
  });

  it('height is not compared when it depends on the content (null)', () => {
    const members = [1, 2, 3, 4].map((i) => member(i)).concat(member(5, { height: null }));
    expect(consistencyOutliers(members)).toEqual([]);
  });

  it('across pages: needs the component on 3+ pages and 75% of them agreeing', () => {
    const page = (fontSize: number) =>
      summarizeComponents([1, 2, 3, 4].map((i) => member(i, { fontSize })));
    const four = crossPageDeviations([page(14), page(14), page(14), page(11)]);
    expect(four.map((d) => [d.pageIndex, d.deviations.map((x) => x.property)])).toEqual([
      [3, ['fontSize']],
    ]);
    expect(crossPageDeviations([page(14), page(14), page(11)])).toEqual([]); // 67%
    expect(crossPageDeviations([page(14), page(11)])).toEqual([]); // 2 pages
  });
});

describe('scores stay comparable', () => {
  it('none of the Milestone 2 checks counts towards the UI health score', () => {
    for (const check of EXTRA_CHECKS) {
      expect(SCORED_UI_CHECKS.has(check), check).toBe(false);
      expect(countsTowardsUiScore({ uiHealth: { checkType: check } })).toBe(false);
    }
    expect(countsTowardsUiScore({ uiHealth: { checkType: 'TEXT_CLIPPING' } })).toBe(true);
    expect(countsTowardsUiScore({ uiHealth: null })).toBe(true);
  });
});
