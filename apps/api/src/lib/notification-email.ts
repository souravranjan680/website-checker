import type { PrismaClient } from '@whc/db';
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesSchema } from '@whc/shared';
import { Worker } from 'bullmq';
import type { Logger } from './logger';
import type { Mailer } from './mailer';

/** Must match NOTIFICATION_QUEUE_NAME in apps/scanner/src/notifications.ts. */
export const NOTIFICATION_QUEUE_NAME = 'notifications';

export type EmailOutcome = 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';

/**
 * Sends one notification e-mail and records what really happened on the row:
 * SENT (with time), FAILED (with a short reason) or NOT_REQUESTED (the user turned
 * e-mail off before it went out). The UI only ever says "sent" for SENT.
 */
export async function sendNotificationEmail(
  deps: { prisma: PrismaClient; mailer: Mailer; appUrl: string; logger: Logger },
  notificationId: string,
  options: { finalAttempt: boolean },
): Promise<EmailOutcome> {
  const { prisma, mailer, appUrl, logger } = deps;
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      user: { select: { email: true, name: true, isActive: true, notificationPreferences: true } },
    },
  });
  if (!notification || notification.emailStatus === 'SENT') return 'SKIPPED';

  const parsed = notificationPreferencesSchema
    .partial()
    .safeParse(notification.user.notificationPreferences ?? {});
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(parsed.success ? parsed.data : {}) };
  if (!prefs.email || !notification.user.isActive) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { emailStatus: 'NOT_REQUESTED', emailError: 'E-mail was turned off before sending.' },
    });
    return 'SKIPPED';
  }

  const link = notification.link ? `${appUrl}${notification.link}` : appUrl;
  try {
    await mailer.send({
      to: notification.user.email,
      subject: notification.title,
      text: `Hi ${notification.user.name},\n\n${notification.message}\n\nOpen: ${link}\n\nYou get this e-mail because e-mail notifications are on in your settings (${appUrl}/settings).\n`,
    });
  } catch (err) {
    // The reason is logged in full; the row gets a short, safe summary (no credentials).
    logger.warn(
      { err, notificationId, finalAttempt: options.finalAttempt },
      'notification e-mail failed',
    );
    if (!options.finalAttempt) return 'RETRY';
    await prisma.notification.update({
      where: { id: notificationId },
      data: { emailStatus: 'FAILED', emailError: 'The mail server did not accept the message.' },
    });
    return 'FAILED';
  }
  await prisma.notification.update({
    where: { id: notificationId },
    data: { emailStatus: 'SENT', emailedAt: new Date(), emailError: null },
  });
  return 'SENT';
}

/** BullMQ worker inside the API process: the API is the service that can reach SMTP. */
export function startNotificationEmailWorker(options: {
  redisUrl: string;
  prefix: string;
  prisma: PrismaClient;
  mailer: Mailer;
  appUrl: string;
  logger: Logger;
}) {
  const worker = new Worker<{ notificationId: string }>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const outcome = await sendNotificationEmail(options, job.data.notificationId, {
        finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      });
      // Throwing makes BullMQ retry with backoff (attempts are set by the scanner).
      if (outcome === 'RETRY') throw new Error('mail server error, will retry');
      return outcome;
    },
    {
      connection: { url: options.redisUrl, maxRetriesPerRequest: null },
      prefix: options.prefix,
      concurrency: 2,
    },
  );
  worker.on('error', (err) => options.logger.warn({ err }, 'notification worker error'));
  return { close: () => worker.close() };
}
