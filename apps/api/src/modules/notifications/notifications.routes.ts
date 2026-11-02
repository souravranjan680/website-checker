import type { Prisma, PrismaClient } from '@whc/db';
import { idSchema, listQuerySchema, type NotificationDto, type Paginated } from '@whc/shared';
import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';

const listSchema = listQuerySchema.extend({ unread: z.stringbool().optional() });

/**
 * /api/notifications (the signed-in user's own notifications only)
 *   GET  /                ?unread=true&page=
 *   GET  /unread-count
 *   POST /:id/read
 *   POST /read-all
 */
export function createNotificationsRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  const toDto = (row: Prisma.NotificationGetPayload<object>): NotificationDto => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    emailStatus: row.emailStatus,
    emailedAt: row.emailedAt?.toISOString() ?? null,
    emailError: row.emailError,
    createdAt: row.createdAt.toISOString(),
  });

  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const query = parseInput(listSchema, req.query);
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      ...(query.unread ? { readAt: null } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query.page, query.pageSize),
      }),
    ]);
    const body: Paginated<NotificationDto> = {
      data: rows.map(toDto),
      meta: pageMeta(query.page, query.pageSize, total),
    };
    res.json(body);
  });

  router.get('/unread-count', async (req, res) => {
    const count = await prisma.notification.count({
      where: { userId: currentUser(req).id, readAt: null },
    });
    res.json({ data: { count } });
  });

  router.post('/read-all', async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { userId: currentUser(req).id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ data: { updated: count } });
  });

  router.post('/:id/read', async (req, res) => {
    // Scoped by user ID: someone else's notification is simply "not found".
    const { count } = await prisma.notification.updateMany({
      where: { id: parseInput(idSchema, req.params.id), userId: currentUser(req).id },
      data: { readAt: new Date() },
    });
    if (count === 0) throw notFound('Notification');
    res.status(204).end();
  });

  return router;
}
