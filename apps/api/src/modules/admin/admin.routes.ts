import type { PrismaClient } from '@whc/db';
import { idSchema, listQuerySchema, USER_ROLES, type AdminUserDto } from '@whc/shared';
import { Router } from 'express';
import { z } from 'zod';
import { logActivity } from '../../lib/activity';
import { AppError, notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import { parseInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';

const updateUserSchema = z
  .object({ role: z.enum(USER_ROLES).optional(), isActive: z.boolean().optional() })
  .refine((data) => data.role !== undefined || data.isActive !== undefined, {
    error: 'Nothing to update.',
  });

/** /api/admin/*: global user management. Mounted behind requireAuth + requireAdmin. */
export function createAdminRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  router.get('/users', async (req, res) => {
    const query = parseInput(listQuerySchema, req.query);
    const where = query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { name: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query.page, query.pageSize),
        include: { _count: { select: { memberships: true } } },
      }),
    ]);
    const data: AdminUserDto[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      projectCount: u._count.memberships,
      createdAt: u.createdAt.toISOString(),
    }));
    res.json({ data, meta: pageMeta(query.page, query.pageSize, total) });
  });

  router.patch('/users/:id', async (req, res) => {
    const admin = currentUser(req);
    const userId = parseInput(idSchema, req.params.id);
    const input = parseInput(updateUserSchema, req.body);

    if (userId === admin.id) {
      // Prevents an admin from accidentally locking themselves (and maybe everyone) out.
      throw new AppError(422, 'INVALID_STATE', 'You cannot change your own role or status.');
    }
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw notFound('User');

    const updated = await prisma.user.update({ where: { id: userId }, data: input });
    if (input.isActive === false) {
      // A disabled user is signed out everywhere immediately.
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await logActivity(prisma, {
      userId: admin.id,
      action: 'admin.user_updated',
      entityType: 'User',
      entityId: userId,
      metadata: input,
    });
    res.json({
      data: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        isActive: updated.isActive,
      },
    });
  });

  return router;
}
