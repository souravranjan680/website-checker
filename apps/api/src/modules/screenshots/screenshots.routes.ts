import type { PrismaClient } from '@whc/db';
import { idSchema, updateTrackedIssueSchema, type IssueReviewDto } from '@whc/shared';
import { Router, type Request } from 'express';
import { logActivity } from '../../lib/activity';
import { AppError, notFound } from '../../lib/errors';
import { openStoredFile } from '../../lib/storage';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { requireProjectRole } from '../projects/project-access';

/**
 * GET /api/screenshots/:id: streams a screenshot image after checking that the user
 * may see the scan's project. Images are never served from a public folder.
 */
export function createScreenshotsRouter(deps: {
  prisma: PrismaClient;
  storageDir: string;
}): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const user = currentUser(req);
    const screenshot = await deps.prisma.screenshot.findUnique({
      where: { id: parseInput(idSchema, req.params.id) },
      include: {
        scan: { select: { website: { select: { projectId: true } } } },
        // Baseline images belong to a website, not to a scan.
        baseline: { select: { website: { select: { projectId: true } } } },
      },
    });
    const projectId =
      screenshot?.scan?.website.projectId ?? screenshot?.baseline?.website.projectId;
    if (!screenshot || !projectId) throw notFound('Screenshot');
    await requireProjectRole(deps.prisma, user, projectId, 'VIEWER', 'view screenshots');

    const file = await openStoredFile(deps.storageDir, screenshot.storageKey);
    if (!file) throw notFound('Screenshot file');
    const extension = screenshot.mimeType === 'image/png' ? 'png' : 'jpg';
    res.writeHead(200, {
      'Content-Type': screenshot.mimeType,
      'Content-Length': file.size,
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="screenshot-${screenshot.id}.${extension}"`,
    });
    file.stream.pipe(res);
  });

  return router;
}

/**
 * PATCH /api/tracked-issues/:id: a person's decision on a tracked problem.
 *   status        lifecycle: open again / ignored / false positive (Phase 5)
 *   reviewStatus  verdict: unreviewed / confirmed defect / intentional (Phase 9)
 *   note          why (kept in the review history)
 * Both are independent (a confirmed defect can still be resolved by a later scan),
 * except that a false positive cannot also be a confirmed or intentional finding.
 * Every change appends one row to the review history.
 *
 * GET /api/tracked-issues/:id/reviews: that history, oldest first.
 */
export function createTrackedIssuesRouter(deps: { prisma: PrismaClient }): Router {
  const router = Router();

  async function loadTracked(req: Request, minimum: 'VIEWER' | 'EDITOR', action: string) {
    const user = currentUser(req);
    const tracked = await deps.prisma.trackedIssue.findUnique({
      where: { id: parseInput(idSchema, req.params.id) },
      include: { website: { select: { projectId: true } } },
    });
    if (!tracked) throw notFound('Issue');
    await requireProjectRole(deps.prisma, user, tracked.website.projectId, minimum, action);
    return { user, tracked };
  }

  router.patch('/:id', async (req, res) => {
    const input = parseInput(updateTrackedIssueSchema, req.body);
    const { user, tracked } = await loadTracked(req, 'EDITOR', 'change issue status');

    const status = input.status ?? tracked.status;
    const reviewStatus = input.reviewStatus ?? tracked.reviewStatus;
    if (status === 'FALSE_POSITIVE' && reviewStatus !== 'UNREVIEWED') {
      throw new AppError(
        409,
        'REVIEW_CONFLICT',
        'A false positive cannot also be a confirmed or intentional finding. Clear the review first.',
        [
          {
            path: input.status ? 'status' : 'reviewStatus',
            message: 'Conflicts with the current state.',
          },
        ],
      );
    }
    const statusChanged = status !== tracked.status;
    const reviewChanged = reviewStatus !== tracked.reviewStatus;
    if (!statusChanged && !reviewChanged) {
      res.json({ data: { id: tracked.id, status, reviewStatus } });
      return;
    }

    const [updated] = await deps.prisma.$transaction([
      deps.prisma.trackedIssue.update({
        where: { id: tracked.id },
        data: {
          status,
          ...(statusChanged && status === 'OPEN'
            ? { resolvedAt: null, resolvedInScanId: null }
            : {}),
          ...(reviewChanged ? { reviewStatus, reviewedAt: new Date(), reviewedById: user.id } : {}),
        },
      }),
      deps.prisma.issueReview.create({
        data: {
          trackedIssueId: tracked.id,
          userId: user.id,
          ...(statusChanged ? { fromStatus: tracked.status, toStatus: status } : {}),
          ...(reviewChanged ? { fromReview: tracked.reviewStatus, toReview: reviewStatus } : {}),
          note: input.note || null,
        },
      }),
    ]);
    const common = { title: tracked.title, websiteId: tracked.websiteId };
    if (statusChanged) {
      await logActivity(deps.prisma, {
        userId: user.id,
        projectId: tracked.website.projectId,
        action: 'issue.status_changed',
        entityType: 'TrackedIssue',
        entityId: tracked.id,
        metadata: { from: tracked.status, to: status, ...common },
      });
    }
    if (reviewChanged) {
      await logActivity(deps.prisma, {
        userId: user.id,
        projectId: tracked.website.projectId,
        action: 'issue.reviewed',
        entityType: 'TrackedIssue',
        entityId: tracked.id,
        metadata: { from: tracked.reviewStatus, to: reviewStatus, ...common },
      });
    }
    res.json({
      data: { id: updated.id, status: updated.status, reviewStatus: updated.reviewStatus },
    });
  });

  router.get('/:id/reviews', async (req, res) => {
    const { tracked } = await loadTracked(req, 'VIEWER', 'view issue reviews');
    const rows = await deps.prisma.issueReview.findMany({
      where: { trackedIssueId: tracked.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
    const data: IssueReviewDto[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      fromReview: r.fromReview,
      toReview: r.toReview,
      note: r.note,
    }));
    res.json({ data });
  });

  return router;
}
