import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// Re-export the generated client, model types (User, Scan, ...) and enums (Severity, ...)
// so other workspaces only ever import from "@whc/db".
export * from './generated/prisma/client';

/**
 * Creates a Prisma client.
 * Prisma 7 talks to PostgreSQL through a "driver adapter"; here that is the
 * standard `pg` driver, which also manages the connection pool.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
