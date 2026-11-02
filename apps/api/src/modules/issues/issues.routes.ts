import type { PrismaClient } from '@whc/db';
import { idSchema, type IssueHistoryDto } from '@whc/shared';
import { Router } from 'express';
import { notFound } from '../../lib/errors';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { requireProjectRole } from '../projects/project-access';
import { ISSUE_INCLUDE, toIssueDto } from '../scans/issue-mapping';

/**
 * GET /api/issues/:id: one issue with its full tracking history:
 * every scan where the same problem (fingerprint) appeared, status changes made by
 * people (from the audit log), and when it was resolved.
 */
export function createIssuesRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const user = currentUser(req);
    const row = await prisma.issue.findUnique({
      where: { id: parseInput(idSchema, req.params.id) },
      include: {
        ...ISSUE_INCLUDE,
        scan: {
          select: {
            id: true,
            createdAt: true,
            status: true,
            website: {
              select: {
                id: true,
                name: true,
                baseUrl: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!row) throw notFound('Issue');
    const { role } = await requireProjectRole(
      prisma,
      user,
      row.scan.website.project.id,
      'VIEWER',
      'view issues',
    );

    const tracked = row.trackedIssueId
      ? await prisma.trackedIssue.findUnique({
          where: { id: row.trackedIssueId },
          include: {
            issues: {
              orderBy: { createdAt: 'desc' },
              take: 50,
              select: {
                id: true,
                severity: true,
                createdAt: true,
                scan: { select: { id: true, status: true, createdAt: true } },
              },
            },
          },
        })
      : null;
    const statusChanges = tracked
      ? await prisma.activityLog.findMany({
          where: { entityType: 'TrackedIssue', entityId: tracked.id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { user: { select: { id: true, name: true } } },
        })
      : [];

    const timeline: IssueHistoryDto['timeline'] = [
      ...(tracked?.issues ?? []).map((occurrence) => ({
        type: 'DETECTED' as const,
        at: occurrence.scan.createdAt.toISOString(),
        scanId: occurrence.scan.id,
        scanStatus: occurrence.scan.status,
        issueId: occurrence.id,
        severity: occurrence.severity,
      })),
      ...statusChanges.map((entry) => {
        const meta = (entry.metadata as { from?: string; to?: string } | null) ?? {};
        return {
          type: 'STATUS_CHANGED' as const,
          at: entry.createdAt.toISOString(),
          from: meta.from,
          to: meta.to,
          user: entry.user,
        };
      }),
      ...(tracked?.resolvedAt
        ? [
            {
              type: 'RESOLVED' as const,
              at: tracked.resolvedAt.toISOString(),
              scanId: tracked.resolvedInScanId ?? undefined,
            },
          ]
        : []),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const { scan } = row;
    const result: IssueHistoryDto = {
      issue: toIssueDto(row),
      scan: { id: scan.id, createdAt: scan.createdAt.toISOString(), status: scan.status },
      website: { id: scan.website.id, name: scan.website.name, baseUrl: scan.website.baseUrl },
      project: scan.website.project,
      myRole: role,
      tracking: tracked
        ? {
            id: tracked.id,
            status: tracked.status,
            occurrenceCount: tracked.occurrenceCount,
            firstSeenAt: tracked.firstSeenAt.toISOString(),
            lastSeenAt: tracked.lastSeenAt.toISOString(),
            resolvedAt: tracked.resolvedAt?.toISOString() ?? null,
            firstSeenScanId: tracked.firstSeenScanId,
            lastSeenScanId: tracked.lastSeenScanId,
            resolvedInScanId: tracked.resolvedInScanId,
          }
        : null,
      timeline,
    };
    res.json({ data: result });
  });

  return router;
}
