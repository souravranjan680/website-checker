import type { PrismaClient } from '@whc/db';
import { normalizeUrl } from './crawler/urls';

const PENALTY: Record<string, number> = { CRITICAL: 10, HIGH: 5, MEDIUM: 2, LOW: 1, INFO: 0 };

/**
 * The UI checks that count towards the UI health score: those that existed before
 * Phase 9, Milestone 2. Checks added since (layout measurements, fonts and icons,
 * component consistency) are reported and tracked but never change the score, so
 * scores stay comparable with earlier scans.
 */
export const SCORED_UI_CHECKS: ReadonlySet<string> = new Set([
  'BROKEN_IMAGE',
  'BROKEN_LINK',
  'HORIZONTAL_SCROLL',
  'CONTENT_OVERFLOW',
  'OVERLAPPING_ELEMENTS',
  'TEXT_CLIPPING',
  'OUT_OF_VIEWPORT',
  'FAILED_STYLESHEET',
  'FAILED_SCRIPT',
  'CONSOLE_ERROR',
  'JS_ERROR',
  'FAILED_REQUEST',
  'EMPTY_BUTTON',
  'EMPTY_LINK',
  'BROKEN_NAVIGATION',
  'IMAGE_SIZING',
]);

/** Which probe has to run on a page again before its findings there may be resolved. */
const PROBE_OF_RULE: Record<
  string,
  'keyboardPages' | 'formsReadPages' | 'formsProbedPages' | 'formsSyntheticPages'
> = {
  'functional/focus-not-visible': 'keyboardPages',
  'functional/focus-on-hidden': 'keyboardPages',
  'functional/focus-lost': 'keyboardPages',
  'functional/keyboard-trap': 'keyboardPages',
  'functional/key-activation-failed': 'keyboardPages',
  'functional/click-not-focusable': 'keyboardPages',
  'functional/form-required-not-indicated': 'formsReadPages',
  'functional/form-indicator-without-required': 'formsReadPages',
  'functional/form-describedby-missing': 'formsReadPages',
  'functional/form-placeholder-only-label': 'formsReadPages',
  'functional/form-error-not-associated': 'formsProbedPages',
  'functional/form-no-blur-feedback': 'formsProbedPages',
};

/** Whether a UI or responsive issue counts towards the UI health score. */
export function countsTowardsUiScore(issue: { uiHealth: { checkType: string } | null }): boolean {
  return !issue.uiHealth || SCORED_UI_CHECKS.has(issue.uiHealth.checkType);
}

/**
 * Score 0-100 (higher is better), as documented in docs/01-architecture.md §4:
 * each unique (rule, page, screen size) problem costs points by severity,
 * the cost is averaged over the scanned pages and subtracted from 100.
 * This is OUR heuristic, not an official standard.
 */
export function computeScore(
  issues: { ruleId: string; pageUrl: string | null; viewport: string | null; severity: string }[],
  pagesScanned: number,
): number | null {
  if (pagesScanned === 0) return null;
  const seen = new Set<string>();
  let penalty = 0;
  for (const issue of issues) {
    const key = `${issue.ruleId}|${issue.pageUrl}|${issue.viewport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    penalty += PENALTY[issue.severity] ?? 0;
  }
  return Math.max(0, Math.round(100 - penalty / pagesScanned));
}

/**
 * Links this scan's issues to long-lived TrackedIssue rows (one per fingerprint per
 * website), so problems keep their identity across scans:
 *   new fingerprint            → new TrackedIssue
 *   seen before                → occurrenceCount + 1, lastSeen = this scan
 *   was RESOLVED, seen again   → OPEN again (a regression)
 *   IGNORED / FALSE_POSITIVE   → the user's decision is kept
 *   OPEN, not seen, but its page WAS re-checked in this scan → RESOLVED
 *     (interaction findings: only if the explorer ran on that page again;
 *      component consistency: only if components were compared there again;
 *      keyboard and form probes: only if that probe ran there again)
 */
export async function trackIssues(
  prisma: PrismaClient,
  scan: { id: string; websiteId: string },
  checked: {
    pages: Set<string>;
    responsivePages: Set<string>;
    /** Pages the safe explorer opened menus/tabs on (Phase 9). */
    exploredPages?: Set<string>;
    /** Pages whose components were compared (Phase 9, Milestone 2). */
    consistencyPages?: Set<string>;
    /** Pages the keyboard probe ran on, and the form probe read / focused (Checkpoint 2). */
    keyboardPages?: Set<string>;
    formsReadPages?: Set<string>;
    formsProbedPages?: Set<string>;
    /** Pages where the form probe also typed invalid values (SYNTHETIC). */
    formsSyntheticPages?: Set<string>;
  },
): Promise<{
  newCount: number;
  reopenedCount: number;
  recurringCount: number;
  resolvedCount: number;
}> {
  const issues = await prisma.issue.findMany({
    where: { scanId: scan.id },
    select: {
      id: true,
      fingerprint: true,
      category: true,
      ruleId: true,
      title: true,
      severity: true,
    },
  });
  const byFingerprint = new Map(issues.map((issue) => [issue.fingerprint, issue]));
  const fingerprints = [...byFingerprint.keys()];
  const now = new Date();

  const existing = await prisma.trackedIssue.findMany({
    where: { websiteId: scan.websiteId, fingerprint: { in: fingerprints } },
  });
  const existingByFingerprint = new Map(existing.map((t) => [t.fingerprint, t]));

  const toCreate = fingerprints.filter((f) => !existingByFingerprint.has(f));
  if (toCreate.length > 0) {
    await prisma.trackedIssue.createMany({
      data: toCreate.map((f) => {
        const issue = byFingerprint.get(f)!;
        return {
          websiteId: scan.websiteId,
          fingerprint: f,
          category: issue.category,
          ruleId: issue.ruleId,
          title: issue.title,
          severity: issue.severity,
          firstSeenScanId: scan.id,
          lastSeenScanId: scan.id,
          firstSeenAt: now,
          lastSeenAt: now,
        };
      }),
      skipDuplicates: true,
    });
  }

  // Problems that had been fixed and came back: a regression, like new ones.
  const reopenedCount = existing.filter(
    (t) => t.status === 'RESOLVED' && t.lastSeenScanId !== scan.id,
  ).length;
  const updates = existing
    .filter((t) => t.lastSeenScanId !== scan.id)
    .map((t) => {
      const issue = byFingerprint.get(t.fingerprint)!;
      return prisma.trackedIssue.update({
        where: { id: t.id },
        data: {
          occurrenceCount: { increment: 1 },
          lastSeenScanId: scan.id,
          lastSeenAt: now,
          title: issue.title,
          severity: issue.severity,
          ...(t.status === 'RESOLVED'
            ? { status: 'OPEN', resolvedAt: null, resolvedInScanId: null }
            : {}),
        },
      });
    });
  for (let i = 0; i < updates.length; i += 200)
    await prisma.$transaction(updates.slice(i, i + 200));

  // Link every issue of this scan to its tracked identity.
  const tracked = await prisma.trackedIssue.findMany({
    where: { websiteId: scan.websiteId, fingerprint: { in: fingerprints } },
    select: { id: true, fingerprint: true },
  });
  const links = tracked.map((t) =>
    prisma.issue.updateMany({
      where: { scanId: scan.id, fingerprint: t.fingerprint },
      data: { trackedIssueId: t.id },
    }),
  );
  for (let i = 0; i < links.length; i += 200) await prisma.$transaction(links.slice(i, i + 200));

  // Resolve open issues that were not found again, but only where we really re-checked.
  const candidates = await prisma.trackedIssue.findMany({
    where: { websiteId: scan.websiteId, status: 'OPEN', fingerprint: { notIn: fingerprints } },
    select: {
      id: true,
      issues: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { pageUrl: true, category: true, ruleId: true, details: true },
      },
    },
  });
  const toResolve = candidates
    .filter((candidate) => {
      const last = candidate.issues[0];
      if (!last?.pageUrl) return false;
      const page = normalizeUrl(last.pageUrl);
      if (!page) return false;
      // Interaction findings are only resolved where the explorer ran again.
      const fromExplorer =
        last.category === 'FUNCTIONAL' ||
        Boolean((last.details as { interactionState?: unknown } | null)?.interactionState);
      // Keyboard and form findings only where that probe ran again (it can be switched off).
      let probe = PROBE_OF_RULE[last.ruleId];
      if ((last.details as { action?: string } | null)?.action === 'synthetic') {
        probe = 'formsSyntheticPages';
      }
      if (probe) return checked[probe]?.has(page) ?? false;
      if (fromExplorer) return checked.exploredPages?.has(page) ?? false;
      // Consistency findings only where components were compared again.
      if (last.ruleId === 'ui/component-inconsistent') {
        return checked.consistencyPages?.has(page) ?? false;
      }
      return last.category === 'RESPONSIVE'
        ? checked.responsivePages.has(page)
        : checked.pages.has(page);
    })
    .map((candidate) => candidate.id);
  if (toResolve.length > 0) {
    await prisma.trackedIssue.updateMany({
      where: { id: { in: toResolve } },
      data: { status: 'RESOLVED', resolvedAt: now, resolvedInScanId: scan.id },
    });
  }

  return {
    newCount: toCreate.length,
    reopenedCount,
    recurringCount: fingerprints.length - toCreate.length,
    resolvedCount: toResolve.length,
  };
}
