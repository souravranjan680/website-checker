import type { Prisma, PrismaClient } from '@whc/db';
import { idSchema, listQuerySchema, type ActivityDto } from '@whc/shared';
import { Router } from 'express';
import { notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { requireProjectRole } from '../projects/project-access';

const querySchema = listQuerySchema.extend({
  projectId: idSchema.optional(),
  websiteId: idSchema.optional(),
});

/**
 * GET /api/activity?projectId=...  → audit trail of a project (any member may read it)
 * GET /api/activity?websiteId=...  → actions on one website and its scans
 * GET /api/activity                → your own recent actions
 */
export function createActivityRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const query = parseInput(querySchema, req.query);
    let where: Prisma.ActivityLogWhereInput = { userId: user.id };
    if (query.websiteId) {
      const website = await prisma.website.findUnique({
        where: { id: query.websiteId },
        select: { projectId: true },
      });
      if (!website) throw notFound('Website');
      await requireProjectRole(prisma, user, website.projectId, 'VIEWER', 'view its activity');
      // Scans of this website are logged with entityType 'Scan'; match them via metadata.
      where = {
        projectId: website.projectId,
        OR: [
          { entityType: 'Website', entityId: query.websiteId },
          { metadata: { path: ['websiteId'], equals: query.websiteId } },
        ],
      };
    } else if (query.projectId) {
      await requireProjectRole(prisma, user, query.projectId, 'VIEWER', 'view its activity');
      where = { projectId: query.projectId };
    }

    const [total, rows] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query.page, query.pageSize),
        include: { user: { select: { id: true, name: true } } },
      }),
    ]);

    const data: ActivityDto[] = rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      user: row.user,
      createdAt: row.createdAt.toISOString(),
    }));
    res.json({ data, meta: pageMeta(query.page, query.pageSize, total) });
  });

  return router;
}
