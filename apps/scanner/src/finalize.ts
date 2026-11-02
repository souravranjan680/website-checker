import type { PrismaClient } from '@whc/db';
import { normalizeUrl } from './crawler/urls';

const PENALTY: Record<string, number> = { CRITICAL: 10, HIGH: 5, MEDIUM: 2, LOW: 1, INFO: 0 };

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
 */
export async function trackIssues(
  prisma: PrismaClient,
  scan: { id: string; websiteId: string },
  checked: { pages: Set<string>; responsivePages: Set<string> },
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
        select: { pageUrl: true, category: true },
      },
    },
  });
  const toResolve = candidates
    .filter((candidate) => {
      const last = candidate.issues[0];
      if (!last?.pageUrl) return false;
      const page = normalizeUrl(last.pageUrl);
      if (!page) return false;
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
