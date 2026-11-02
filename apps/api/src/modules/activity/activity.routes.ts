import type { Prisma, PrismaClient } from '@whc/db';
import { idSchema, listQuerySchema, type ActivityDto } from '@whc/shared';
import { Router } from 'express';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { requireProjectRole } from '../projects/project-access';

const querySchema = listQuerySchema.extend({ projectId: idSchema.optional() });

/**
 * GET /api/activity?projectId=...  → audit trail of a project (any member may read it)
 * GET /api/activity                → your own recent actions
 */
export function createActivityRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const query = parseInput(querySchema, req.query);
    if (query.projectId) {
      await requireProjectRole(prisma, user, query.projectId, 'VIEWER', 'view its activity');
    }
    const where: Prisma.ActivityLogWhereInput = query.projectId
      ? { projectId: query.projectId }
      : { userId: user.id };

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
