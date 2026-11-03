/**
 * Phase 9, Milestone 0: review status and the append-only review history.
 * Runs against DATABASE_URL_TEST.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src';
import { getTestDatabaseUrl } from './test-env';

const prisma = createPrismaClient(getTestDatabaseUrl());

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // Table names come from Postgres itself, not from user input.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} CASCADE`,
  );
});

async function trackedIssueWithReview() {
  const user = await prisma.user.create({
    data: { email: 'reviewer@example.com', name: 'Reviewer', passwordHash: 'x' },
  });
  const project = await prisma.project.create({ data: { name: 'P', createdById: user.id } });
  const website = await prisma.website.create({
    data: {
      projectId: project.id,
      name: 'Site',
      baseUrl: 'https://example.com/',
      hostname: 'example.com',
      authorizationConfirmedAt: new Date(),
    },
  });
  const tracked = await prisma.trackedIssue.create({
    data: {
      websiteId: website.id,
      fingerprint: 'f1',
      category: 'UI_HEALTH',
      ruleId: 'ui/overlapping-elements',
      title: 'Control is covered by another element',
      severity: 'HIGH',
    },
  });
  const review = await prisma.issueReview.create({
    data: {
      trackedIssueId: tracked.id,
      userId: user.id,
      fromReview: 'UNREVIEWED',
      toReview: 'CONFIRMED',
      note: 'Reproduced in Chrome.',
    },
  });
  return { user, website, tracked, review };
}

describe('review status', () => {
  it('defaults to UNREVIEWED and is independent of the lifecycle status', async () => {
    const { tracked } = await trackedIssueWithReview();
    expect(tracked.reviewStatus).toBe('UNREVIEWED');
    // A confirmed defect can later be resolved by a rescan.
    const updated = await prisma.trackedIssue.update({
      where: { id: tracked.id },
      data: { reviewStatus: 'CONFIRMED', status: 'RESOLVED', resolvedAt: new Date() },
    });
    expect(updated).toMatchObject({ reviewStatus: 'CONFIRMED', status: 'RESOLVED' });
  });
});

describe('review history is append-only', () => {
  it('refuses to edit a review row', async () => {
    const { review } = await trackedIssueWithReview();
    await expect(
      prisma.issueReview.update({ where: { id: review.id }, data: { note: 'changed' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.issueReview.update({ where: { id: review.id }, data: { toReview: 'INTENTIONAL' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('keeps the row (without the user) when the reviewer account is deleted', async () => {
    const { user, review } = await trackedIssueWithReview();
    await prisma.user.delete({ where: { id: user.id } });
    const kept = await prisma.issueReview.findUniqueOrThrow({ where: { id: review.id } });
    expect(kept).toMatchObject({
      userId: null,
      toReview: 'CONFIRMED',
      note: 'Reproduced in Chrome.',
    });
  });

  it('is removed together with its website (cascade)', async () => {
    const { website } = await trackedIssueWithReview();
    await prisma.website.delete({ where: { id: website.id } });
    expect(await prisma.issueReview.count()).toBe(0);
  });
});
