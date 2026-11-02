import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  makeAdmin,
  resetDatabase,
  signUp,
} from '../../../test/helpers';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

describe('admin user management', () => {
  it('is forbidden for normal users', async () => {
    const { agent } = await signUp(ctx.app);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('lets an admin list users and disable one, which signs them out', async () => {
    const admin = await signUp(ctx.app, { email: 'admin@example.com' });
    await makeAdmin(prisma, admin.user.id);
    const target = await signUp(ctx.app, { email: 'target@example.com' });

    const list = await admin.agent.get('/api/admin/users?q=target');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ email: 'target@example.com', isActive: true });
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');

    const disable = await admin.agent
      .patch(`/api/admin/users/${target.user.id}`)
      .set(CSRF)
      .send({ isActive: false });
    expect(disable.status).toBe(200);
    expect((await target.agent.get('/api/auth/me')).status).toBe(401);
    expect((await target.agent.post('/api/auth/refresh').set(CSRF)).status).toBe(401);
  });

  it('prevents admins from changing their own role', async () => {
    const admin = await signUp(ctx.app);
    await makeAdmin(prisma, admin.user.id);
    const res = await admin.agent
      .patch(`/api/admin/users/${admin.user.id}`)
      .set(CSRF)
      .send({ role: 'USER' });
    expect(res.status).toBe(422);
  });
});
