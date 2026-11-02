import type { PrismaClient } from '@whc/db';
import { idSchema, updateTrackedIssueSchema } from '@whc/shared';
import { Router } from 'express';
import { logActivity } from '../../lib/activity';
import { notFound } from '../../lib/errors';
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
      include: { scan: { select: { website: { select: { projectId: true } } } } },
    });
    if (!screenshot?.scan) throw notFound('Screenshot');
    await requireProjectRole(
      deps.prisma,
      user,
      screenshot.scan.website.projectId,
      'VIEWER',
      'view screenshots',
    );

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

/** PATCH /api/tracked-issues/:id: mark a problem as ignored / false positive / open again. */
export function createTrackedIssuesRouter(deps: { prisma: PrismaClient }): Router {
  const router = Router();

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    const { status } = parseInput(updateTrackedIssueSchema, req.body);
    const tracked = await deps.prisma.trackedIssue.findUnique({
      where: { id: parseInput(idSchema, req.params.id) },
      include: { website: { select: { projectId: true } } },
    });
    if (!tracked) throw notFound('Issue');
    await requireProjectRole(
      deps.prisma,
      user,
      tracked.website.projectId,
      'EDITOR',
      'change issue status',
    );

    const updated = await deps.prisma.trackedIssue.update({
      where: { id: tracked.id },
      data: { status, ...(status === 'OPEN' ? { resolvedAt: null, resolvedInScanId: null } : {}) },
    });
    await logActivity(deps.prisma, {
      userId: user.id,
      projectId: tracked.website.projectId,
      action: 'issue.status_changed',
      entityType: 'TrackedIssue',
      entityId: tracked.id,
      metadata: {
        from: tracked.status,
        to: status,
        title: tracked.title,
        websiteId: tracked.websiteId,
      },
    });
    res.json({ data: { id: updated.id, status: updated.status } });
  });

  return router;
}
