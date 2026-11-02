/**
 * Makes an existing (already registered) user a global administrator.
 * There are no built-in or hardcoded admin accounts: register normally, then run
 *   npm run admin:promote -- you@example.com
 */
import { createPrismaClient } from '@whc/db';
import { loadConfig } from '../config/env';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run admin:promote -- you@example.com');
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account uses ${email}. Register in the app first.`);
    process.exitCode = 1;
  } else if (user.role === 'ADMIN') {
    console.log(`${email} is already an administrator.`);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'admin.promoted_via_cli',
        entityType: 'User',
        entityId: user.id,
      },
    });
    console.log(`${email} is now an administrator. Sign out and in again to see it.`);
  }
} finally {
  await prisma.$disconnect();
}
