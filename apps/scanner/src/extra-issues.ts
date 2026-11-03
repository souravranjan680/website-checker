/**
 * Issue drafts of the Milestone 2 checks (Phase 9): layout measurements, fonts and
 * icons, and component consistency. None of these counts towards a score (see
 * SCORED_UI_CHECKS in finalize.ts).
 */
import {
  consistencyOutliers,
  crossPageDeviations,
  formatStyleValue,
  propertyLabel,
  type ComponentDeviation,
  type ComponentMember,
  type ComponentSummaryEntry,
  type ExtraFinding,
  type ExtraResult,
  type FontFaceFact,
} from '@whc/dom-checks';
import type { FailedRequest, PageNetworkLog } from './checks/collectors';
import { uiDraft, type Category, type IssueContext, type IssueDraft } from './issues';

/** Layout and icon findings decided in the page. */
export function extraFindingDrafts(
  findings: ExtraFinding[],
  ctx: IssueContext,
  category: Category,
): IssueDraft[] {
  return findings.map((finding) =>
    uiDraft(finding.check, ctx, category, {
      severity: finding.severity,
      classification: finding.classification,
      description: finding.message,
      selector: finding.selector,
      html: finding.html,
      box: finding.box,
      measurements: finding.measurements,
      target: finding.selector,
    }),
  );
}

const withoutHash = (url: string) => url.split('#')[0]!;

/** The failed requests that are verifiably the given file (same URL). */
function failedRequestsFor(log: PageNetworkLog, urls: string[]): FailedRequest[] {
  const wanted = new Set(urls.map(withoutHash));
  return log.failedRequests.filter((r) => !r.blockedByPolicy && wanted.has(withoutHash(r.url)));
}

const faceLabel = (face: FontFaceFact) =>
  `“${face.family}”${face.weight !== 'normal' && face.weight !== '400' ? ` ${face.weight}` : ''}${face.style !== 'normal' ? ` ${face.style}` : ''}`;

/**
 * Fonts and icons, using what the page reported and the page's failed requests.
 * A generic "failed request" issue is replaced only when the failed URL is verifiably
 * the source of a font face that failed (or the sprite file of a broken icon); every
 * other failed request is still reported as before.
 */
export function fontAndIconDrafts(
  extra: ExtraResult,
  log: PageNetworkLog,
  ctx: IssueContext,
): { drafts: IssueDraft[]; reportedElsewhere: Set<string> } {
  const drafts: IssueDraft[] = [];
  const reportedElsewhere = new Set<string>();
  const failedFamilies = new Set<string>();

  // ---------------------------------------------------- font faces that failed
  for (const face of extra.fonts) {
    if (face.status !== 'error') continue;
    failedFamilies.add(face.family);
    const failed = face.sourcesKnown ? failedRequestsFor(log, face.sources) : [];
    const confirmed = failed.filter((r) => r.verdict === 'CONFIRMED');
    for (const r of confirmed) reportedElsewhere.add(r.url);
    const first = confirmed[0] ?? failed[0];
    const evidence = !face.sourcesKnown
      ? 'Its stylesheet could not be read (another origin), so the file it tried is unknown.'
      : first
        ? `${first.url}: ${first.verdictReason ?? (first.status ? `HTTP ${first.status}` : (first.error ?? 'failed'))}`
        : 'Its files downloaded but could not be used (for example a corrupt or wrong-format file).';
    drafts.push(
      uiDraft('FONT_LOAD_FAILED', ctx, 'UI_HEALTH', {
        severity: 'MEDIUM',
        // Certain only when the re-check confirmed that the file itself fails.
        classification: confirmed.length > 0 ? 'DETECTED' : 'POTENTIAL_DEFECT',
        description: `The web font ${faceLabel(face)} failed to load. ${evidence}`,
        resourceUrl: first?.url ?? face.sources[0] ?? null,
        statusCode: first?.status ?? null,
        measurements: {
          family: face.family,
          weight: face.weight,
          style: face.style,
          sources: face.sources,
          sourcesKnown: face.sourcesKnown,
          correlatedRequests: failed.map((r) => ({
            url: r.url,
            status: r.status ?? null,
            verdict: r.verdict ?? null,
          })),
        },
        target: `${face.family}|${face.weight}|${face.style}|${face.unicodeRange}`,
      }),
    );
  }

  // ---------------------------------------------- text shown in a fallback font
  for (const fallback of extra.fallbacks) {
    const failed = failedFamilies.has(fallback.family);
    drafts.push(
      uiDraft('FONT_FALLBACK_RENDERED', ctx, 'UI_HEALTH', {
        severity: failed ? 'MEDIUM' : 'LOW',
        classification: failed ? 'POTENTIAL_DEFECT' : 'OBSERVATION',
        description: `${fallback.elements} text element(s) ask for the web font “${fallback.family}”, but ${failed ? 'it failed to load' : 'it had not loaded when the page was checked'}, so they are shown in a fallback font (for example “${fallback.sample.text}”).`,
        selector: fallback.sample.selector,
        html: fallback.sample.html,
        box: fallback.sample.box,
        measurements: { family: fallback.family, elements: fallback.elements, fontFailed: failed },
        target: `font:${fallback.family}`,
      }),
    );
  }

  // --------------------------------------- icon-font glyphs whose font failed
  for (const icons of extra.glyphIcons) {
    if (!failedFamilies.has(icons.family)) continue;
    const anyLoaded = extra.fonts.some((f) => f.family === icons.family && f.status === 'loaded');
    if (anyLoaded) continue;
    drafts.push(
      uiDraft('ICON_BROKEN', ctx, 'UI_HEALTH', {
        severity: 'MEDIUM',
        classification: 'POTENTIAL_DEFECT',
        description: `${icons.elements} icon(s) are drawn with the icon font “${icons.family}”, which failed to load, so they show empty boxes or nothing.`,
        selector: icons.sample.selector,
        html: icons.sample.html,
        box: icons.sample.box,
        measurements: { kind: 'icon-font', family: icons.family, elements: icons.elements },
        target: `icon-font:${icons.family}`,
      }),
    );
  }

  // -------------------------------------------- <use href="sprite.svg#id"> icons
  const spritesReported = new Set<string>();
  for (const use of extra.externalUses) {
    const failed = failedRequestsFor(log, [use.url]);
    const confirmed = failed.filter((r) => r.verdict === 'CONFIRMED');
    if (failed.length > 0) {
      for (const r of confirmed) reportedElsewhere.add(r.url);
      if (spritesReported.has(use.url)) continue;
      spritesReported.add(use.url);
      const first = confirmed[0] ?? failed[0]!;
      drafts.push(
        uiDraft('ICON_BROKEN', ctx, 'UI_HEALTH', {
          severity: 'MEDIUM',
          classification: confirmed.length > 0 ? 'DETECTED' : 'POTENTIAL_DEFECT',
          description: `The icon sprite ${use.url} could not be loaded (${first.verdictReason ?? (first.status ? `HTTP ${first.status}` : (first.error ?? 'failed'))}), so the icons that use it are empty.`,
          selector: use.selector,
          html: use.html,
          box: use.box,
          resourceUrl: use.url,
          statusCode: first.status ?? null,
          measurements: { kind: 'svg-sprite', url: use.url, symbol: use.fragment },
          target: `sprite:${use.url}`,
        }),
      );
    } else if (use.empty) {
      drafts.push(
        uiDraft('ICON_BROKEN', ctx, 'UI_HEALTH', {
          severity: 'LOW',
          classification: 'POTENTIAL_DEFECT',
          description: `The icon uses the symbol “#${use.fragment}” of ${use.url}; the file loaded but the icon draws nothing (the symbol may be missing).`,
          selector: use.selector,
          html: use.html,
          box: use.box,
          resourceUrl: use.url,
          measurements: { kind: 'svg-sprite-symbol', url: use.url, symbol: use.fragment },
          target: use.selector,
        }),
      );
    }
  }

  return { drafts, reportedElsewhere };
}

function describeDeviations(deviations: ComponentDeviation[]): string {
  return deviations
    .slice(0, 4)
    .map(
      (d) =>
        `${propertyLabel(d.property)} ${formatStyleValue(d.property, d.value)} instead of ${formatStyleValue(d.property, d.usual)}`,
    )
    .join(', ');
}

/** Within one page: comparable components that look different from most of them. */
export function consistencyDrafts(members: ComponentMember[], ctx: IssueContext): IssueDraft[] {
  return consistencyOutliers(members)
    .slice(0, 20)
    .map((outlier) =>
      uiDraft('COMPONENT_INCONSISTENT', ctx, 'UI_HEALTH', {
        severity: outlier.strong ? 'MEDIUM' : 'LOW',
        classification: outlier.strong ? 'POTENTIAL_DEFECT' : 'OBSERVATION',
        description: `Of ${outlier.groupSize} comparable elements (${outlier.member.label}), this one differs: ${describeDeviations(outlier.deviations)}.${outlier.strong ? ' The difference comes from a style set on this element only.' : ' It may be intended.'}`,
        selector: outlier.member.selector,
        html: outlier.member.html,
        box: outlier.member.box,
        measurements: {
          group: outlier.member.label,
          groupSize: outlier.groupSize,
          deviations: outlier.deviations,
          ownOverrides: outlier.member.ownOverrides,
        },
        target: outlier.member.selector,
      }),
    );
}

/** Across pages: the same component looks different on some pages. Always observations. */
export function crossPageConsistencyDrafts(
  pages: { ctx: IssueContext; scanPageId: string; components: ComponentSummaryEntry[] }[],
): { scanPageId: string; draft: IssueDraft }[] {
  return crossPageDeviations(pages.map((p) => p.components)).map((deviation) => {
    const page = pages[deviation.pageIndex]!;
    const { entry } = deviation;
    return {
      scanPageId: page.scanPageId,
      draft: uiDraft('COMPONENT_INCONSISTENT', page.ctx, 'UI_HEALTH', {
        severity: 'LOW',
        classification: 'OBSERVATION',
        description: `On this page, ${entry.label} looks different from ${deviation.pagesWithKey - 1} other page(s) where it appears: ${describeDeviations(deviation.deviations)}. It may be intended.`,
        selector: entry.sample.selector,
        html: entry.sample.html,
        box: entry.sample.box,
        measurements: {
          group: entry.label,
          acrossPages: deviation.pagesWithKey,
          deviations: deviation.deviations,
        },
        target: `across-pages:${entry.key}`,
      }),
    };
  });
}
