/**
 * Notifications: the user's own list, read state, and e-mail delivery whose
 * recorded outcome matches what really happened (sent, failed, skipped).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../lib/logger';
import type { Mailer } from '../../lib/mailer';
import { sendNotificationEmail } from '../../lib/notification-email';
import {
  CSRF,
  createFakeMailer,
  createTestContext,
  createTestPrisma,
  resetDatabase,
  signUp,
} from '../../../test/helpers';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);
const logger = createLogger({ level: 'silent', pretty: false });

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

const notify = (userId: string, overrides: Record<string, unknown> = {}) =>
  prisma.notification.create({
    data: {
      userId,
      type: 'SCAN_COMPLETED',
      title: 'Scan of Shop finished',
      message: '3 pages scanned, 12 issues found.',
      link: '/scans/s1',
      ...overrides,
    },
  });

describe('/api/notifications', () => {
  it('lists only my notifications, counts unread and marks them read', async () => {
    const me = await signUp(ctx.app);
    const other = await signUp(ctx.app);
    const a = await notify(me.user.id);
    await notify(me.user.id, { type: 'REGRESSION_DETECTED', title: 'Changes detected on Shop' });
    const theirs = await notify(other.user.id);

    expect((await me.agent.get('/api/notifications')).body.meta.total).toBe(2);
    expect((await me.agent.get('/api/notifications/unread-count')).body.data.count).toBe(2);

    expect((await me.agent.post(`/api/notifications/${a.id}/read`).set(CSRF)).status).toBe(204);
    expect((await me.agent.get('/api/notifications?unread=true')).body.meta.total).toBe(1);
    // Someone else's notification cannot be touched.
    expect((await me.agent.post(`/api/notifications/${theirs.id}/read`).set(CSRF)).status).toBe(
      404,
    );

    expect((await me.agent.post('/api/notifications/read-all').set(CSRF)).body.data.updated).toBe(
      1,
    );
    expect((await me.agent.get('/api/notifications/unread-count')).body.data.count).toBe(0);
    expect((await other.agent.get('/api/notifications/unread-count')).body.data.count).toBe(1);
  });
});

describe('sendNotificationEmail', () => {
  async function userWithEmailPrefs(email: boolean) {
    const { user } = await signUp(ctx.app, { email: `n${Math.random()}@example.com` });
    await prisma.user.update({
      where: { id: user.id },
      data: { notificationPreferences: { email, scanCompleted: true } },
    });
    return user;
  }
  const deps = (mailer: Mailer) => ({ prisma, mailer, appUrl: 'https://whc.example', logger });

  it('sends the e-mail and records SENT with the time', async () => {
    const user = await userWithEmailPrefs(true);
    const n = await notify(user.id, { emailStatus: 'PENDING' });
    const mailer = createFakeMailer();
    expect(await sendNotificationEmail(deps(mailer), n.id, { finalAttempt: false })).toBe('SENT');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: user.email, subject: 'Scan of Shop finished' });
    expect(mailer.sent[0]!.text).toContain('https://whc.example/scans/s1');
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.emailStatus).toBe('SENT');
    expect(row.emailedAt).not.toBeNull();
    // Never sent twice (e.g. a job retried after success).
    expect(await sendNotificationEmail(deps(mailer), n.id, { finalAttempt: false })).toBe(
      'SKIPPED',
    );
    expect(mailer.sent).toHaveLength(1);
  });

  it('does not send when the user turned e-mail off, and says so', async () => {
    const user = await userWithEmailPrefs(false);
    const n = await notify(user.id, { emailStatus: 'PENDING' });
    const mailer = createFakeMailer();
    expect(await sendNotificationEmail(deps(mailer), n.id, { finalAttempt: false })).toBe(
      'SKIPPED',
    );
    expect(mailer.sent).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).emailStatus).toBe(
      'NOT_REQUESTED',
    );
  });

  it('retries on mail server errors and records FAILED only after the last attempt', async () => {
    const user = await userWithEmailPrefs(true);
    const n = await notify(user.id, { emailStatus: 'PENDING' });
    const broken: Mailer = {
      async send() {
        throw new Error('connect ECONNREFUSED smtp.internal:587 (user=admin pass=hunter2)');
      },
    };
    expect(await sendNotificationEmail(deps(broken), n.id, { finalAttempt: false })).toBe('RETRY');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).emailStatus).toBe(
      'PENDING',
    );
    expect(await sendNotificationEmail(deps(broken), n.id, { finalAttempt: true })).toBe('FAILED');
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.emailStatus).toBe('FAILED');
    // The stored reason is generic: no server names or credentials.
    expect(row.emailError).toBe('The mail server did not accept the message.');
    const listed = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(JSON.stringify(listed)).not.toContain('hunter2');
  });
});
