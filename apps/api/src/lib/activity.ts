import type { Prisma, PrismaClient } from '@whc/db';

export interface ActivityEntry {
  userId: string | null;
  projectId?: string | null;
  action: string; // e.g. "project.created", "website.deleted", "auth.login"
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonObject;
  ipAddress?: string | null;
}

/**
 * Writes one row to the audit trail (ActivityLog table).
 * `db` can be the normal client or a transaction, so the log entry is saved
 * together with the change it describes.
 */
export async function logActivity(
  db: Pick<PrismaClient, 'activityLog'> | Prisma.TransactionClient,
  entry: ActivityEntry,
): Promise<void> {
  await db.activityLog.create({
    data: {
      userId: entry.userId,
      projectId: entry.projectId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
