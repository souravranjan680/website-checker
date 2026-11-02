import type { PrismaClient } from '@whc/db';
import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesSchema } from '@whc/shared';
import type { Logger } from './logger';

/** Queue the API listens on to send notification e-mails (the scanner has no route to SMTP). */
export const NOTIFICATION_QUEUE_NAME = 'notifications';

/** Anything that can accept an "email" job (BullMQ Queue in production, a fake in tests). */
export interface EmailJobQueue {
  add(name: 'email', data: { notificationId: string }): Promise<unknown>;
}

export interface ScanResultForNotification {
  scanId: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  /** New + reopened tracked problems; null when tracking did not run. */
  regressions: { newIssues: number; reopenedIssues: number } | null;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Writes in-app notifications for the user who started the scan, following their
 * preferences, and queues an e-mail job when they chose e-mail. The e-mail is sent
 * (or fails) in the API; the notification row records the real outcome.
 */
export async function notifyScanFinished(
  deps: { prisma: PrismaClient; emailQueue: EmailJobQueue | null; logger: Logger },
  result: ScanResultForNotification,
): Promise<number> {
  const { prisma, emailQueue, logger } = deps;
  const scan = await prisma.scan.findUnique({
    where: { id: result.scanId },
    select: {
      id: true,
      totalIssues: true,
      pagesScanned: true,
      previousScanId: true,
      triggeredBy: { select: { id: true, notificationPreferences: true } },
      website: { select: { id: true, name: true } },
      visualComparisons: { where: { status: 'CHANGED' }, select: { id: true } },
    },
  });
  // Scheduled scans (later phase) have no user; nobody to notify yet.
  if (!scan?.triggeredBy) return 0;
  const parsed = notificationPreferencesSchema
    .partial()
    .safeParse(scan.triggeredBy.notificationPreferences ?? {});
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(parsed.success ? parsed.data : {}) };

  const drafts: {
    type: 'SCAN_COMPLETED' | 'SCAN_FAILED' | 'REGRESSION_DETECTED';
    title: string;
    message: string;
    link: string;
    metadata: Record<string, unknown>;
  }[] = [];
  const base = { scanId: scan.id, websiteId: scan.website.id };
  if (result.status === 'COMPLETED' && prefs.scanCompleted) {
    drafts.push({
      type: 'SCAN_COMPLETED',
      title: `Scan of ${scan.website.name} finished`,
      message: `${scan.pagesScanned} page${scan.pagesScanned === 1 ? '' : 's'} scanned, ${scan.totalIssues} issue${scan.totalIssues === 1 ? '' : 's'} found.`,
      link: `/scans/${scan.id}`,
      metadata: { ...base, status: result.status },
    });
  }
  if ((result.status === 'FAILED' || result.status === 'PARTIAL') && prefs.scanFailed) {
    drafts.push({
      type: 'SCAN_FAILED',
      title: `Scan of ${scan.website.name} ${result.status === 'FAILED' ? 'failed' : 'only partly completed'}`,
      message:
        result.status === 'FAILED'
          ? 'The scan could not finish. Open it to see why.'
          : `${scan.pagesScanned} page${scan.pagesScanned === 1 ? '' : 's'} scanned; some pages could not be checked.`,
      link: `/scans/${scan.id}`,
      metadata: { ...base, status: result.status },
    });
  }
  // A regression needs something to compare with: never on a website's first scan.
  const newIssues = result.regressions?.newIssues ?? 0;
  const reopened = result.regressions?.reopenedIssues ?? 0;
  const visualChanges = scan.visualComparisons.length;
  if (
    prefs.regressionDetected &&
    scan.previousScanId &&
    (newIssues + reopened > 0 || visualChanges > 0)
  ) {
    const parts = [
      newIssues ? `${newIssues} new problem${newIssues === 1 ? '' : 's'}` : null,
      reopened ? `${reopened} fixed problem${reopened === 1 ? '' : 's'} came back` : null,
      visualChanges
        ? `${visualChanges} visual change${visualChanges === 1 ? '' : 's'} above the threshold`
        : null,
    ].filter(Boolean);
    drafts.push({
      type: 'REGRESSION_DETECTED',
      title: `Changes detected on ${scan.website.name}`,
      message: `${parts.join(', ')} since the previous scan.`,
      link:
        visualChanges && !(newIssues + reopened)
          ? `/scans/${scan.id}/reports/visual`
          : `/scans/${scan.id}`,
      metadata: { ...base, newIssues, reopenedIssues: reopened, visualChanges },
    });
  }

  for (const draft of drafts) {
    const wantsEmail = prefs.email && emailQueue !== null;
    const row = await prisma.notification.create({
      data: {
        userId: scan.triggeredBy.id,
        type: draft.type,
        title: draft.title,
        message: draft.message,
        link: draft.link,
        metadata: draft.metadata as object,
        emailStatus: wantsEmail ? 'PENDING' : 'NOT_REQUESTED',
      },
    });
    if (wantsEmail) {
      try {
        await emailQueue.add('email', { notificationId: row.id });
      } catch (err) {
        // The in-app notification stays; the e-mail is honestly marked as failed.
        logger.warn({ err, notificationId: row.id }, 'could not queue notification e-mail');
        await prisma.notification.update({
          where: { id: row.id },
          data: { emailStatus: 'FAILED', emailError: 'Could not queue the e-mail.' },
        });
      }
    }
  }
  if (drafts.length)
    logger.info(
      { scanId: scan.id, notifications: drafts.map((d) => titleCase(d.type)) },
      'notifications created',
    );
  return drafts.length;
}
