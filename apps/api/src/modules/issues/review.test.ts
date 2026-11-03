/**
 * Phase 9, Milestone 0: human review of tracked problems (review status + append-only
 * history) and finding classification in the issue API.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestContext,
  createTestPrisma,
  resetDatabase,
  signUp,
  type Agent,
} from '../../../test/helpers';

const prisma = createTestPrisma();
let ctx = createTestContext(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
  ctx = createTestContext(prisma);
});
afterAll(() => prisma.$disconnect());

async function seed(agent: Agent) {
  const project = (await agent.post('/api/projects').set(CSRF).send({ name: 'Sites' })).body.data;
  const website = (
    await agent.post('/api/websites').set(CSRF).send({
      projectId: project.id,
      name: 'Home',
      baseUrl: 'https://example.com',
      authorizationConfirmed: true,
    })
  ).body.data;
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
  const scan = await prisma.scan.create({
    data: { websiteId: website.id, config: {}, status: 'COMPLETED' },
  });
  const issue = await prisma.issue.create({
    data: {
      scanId: scan.id,
      trackedIssueId: tracked.id,
      category: 'UI_HEALTH',
      severity: 'HIGH',
      ruleId: 'ui/overlapping-elements',
      title: 'Control is covered by another element',
      description: 'd',
      fingerprint: 'f1',
      classification: 'POTENTIAL_DEFECT',
    },
  });
  return { projectId: project.id as string, tracked, scanId: scan.id, issueId: issue.id };
}

const patch = (agent: Agent, id: string, body: object) =>
  agent.patch(`/api/tracked-issues/${id}`).set(CSRF).send(body);

describe('review status', () => {
  it('confirms a finding with a note, keeps lifecycle separate, and records history', async () => {
    const { agent } = await signUp(ctx.app);
    const { tracked } = await seed(agent);

    const res = await patch(agent, tracked.id, {
      reviewStatus: 'CONFIRMED',
      note: 'Reproduced in Chrome 140.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: tracked.id, status: 'OPEN', reviewStatus: 'CONFIRMED' });

    // A later rescan resolves it: the confirmation stays (Prisma update, as the scanner does).
    await prisma.trackedIssue.update({
      where: { id: tracked.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    const row = await prisma.trackedIssue.findUniqueOrThrow({ where: { id: tracked.id } });
    expect(row).toMatchObject({ status: 'RESOLVED', reviewStatus: 'CONFIRMED' });
    expect(row.reviewedById).not.toBeNull();

    const history = (await agent.get(`/api/tracked-issues/${tracked.id}/reviews`)).body.data;
    expect(history).toEqual([
      expect.objectContaining({
        fromReview: 'UNREVIEWED',
        toReview: 'CONFIRMED',
        fromStatus: null,
        toStatus: null,
        note: 'Reproduced in Chrome 140.',
        user: expect.objectContaining({ name: expect.any(String) }),
      }),
    ]);
  });

  it('still accepts the original status-only request, and records it in the history', async () => {
    const { agent } = await signUp(ctx.app);
    const { tracked } = await seed(agent);
    const res = await patch(agent, tracked.id, { status: 'IGNORED' });
    expect(res.body.data).toEqual({
      id: tracked.id,
      status: 'IGNORED',
      reviewStatus: 'UNREVIEWED',
    });
    const history = (await agent.get(`/api/tracked-issues/${tracked.id}/reviews`)).body.data;
    expect(history).toEqual([
      expect.objectContaining({ fromStatus: 'OPEN', toStatus: 'IGNORED', fromReview: null }),
    ]);
  });

  it('marks a finding intentional, then clears the review: every step is kept in order', async () => {
    const { agent } = await signUp(ctx.app);
    const { tracked } = await seed(agent);
    await patch(agent, tracked.id, { reviewStatus: 'INTENTIONAL', note: 'Design choice.' });
    await patch(agent, tracked.id, { reviewStatus: 'UNREVIEWED' });
    await patch(agent, tracked.id, { reviewStatus: 'UNREVIEWED' }); // no change: no new row
    const history = (await agent.get(`/api/tracked-issues/${tracked.id}/reviews`)).body.data;
    expect(history.map((h: { toReview: string }) => h.toReview)).toEqual([
      'INTENTIONAL',
      'UNREVIEWED',
    ]);
  });

  it('refuses a false positive that is also confirmed or intentional', async () => {
    const { agent } = await signUp(ctx.app);
    const { tracked } = await seed(agent);
    await patch(agent, tracked.id, { reviewStatus: 'CONFIRMED' });
    const conflict = await patch(agent, tracked.id, { status: 'FALSE_POSITIVE' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('REVIEW_CONFLICT');
    const both = await patch(agent, tracked.id, {
      status: 'FALSE_POSITIVE',
      reviewStatus: 'UNREVIEWED',
    });
    expect(both.body.data).toEqual({
      id: tracked.id,
      status: 'FALSE_POSITIVE',
      reviewStatus: 'UNREVIEWED',
    });
    expect((await patch(agent, tracked.id, {})).status).toBe(400);
  });

  it('lets viewers read the history but not review', async () => {
    const owner = await signUp(ctx.app);
    const viewer = await signUp(ctx.app, { email: 'viewer@example.com' });
    const outsider = await signUp(ctx.app);
    const { projectId, tracked } = await seed(owner.agent);
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set(CSRF)
      .send({ email: 'viewer@example.com', role: 'VIEWER' });

    expect((await patch(viewer.agent, tracked.id, { reviewStatus: 'CONFIRMED' })).status).toBe(403);
    expect((await viewer.agent.get(`/api/tracked-issues/${tracked.id}/reviews`)).status).toBe(200);
    expect((await outsider.agent.get(`/api/tracked-issues/${tracked.id}/reviews`)).status).toBe(
      404,
    );
  });
});

describe('issue history timeline', () => {
  it('shows review decisions as reviews, not as status changes', async () => {
    const { agent } = await signUp(ctx.app);
    const { tracked, issueId } = await seed(agent);
    await patch(agent, tracked.id, { reviewStatus: 'INTENTIONAL' });
    await patch(agent, tracked.id, { status: 'IGNORED' });

    const timeline = (await agent.get(`/api/issues/${issueId}`)).body.data.timeline as {
      type: string;
      from?: string;
      to?: string;
    }[];
    expect(timeline.filter((t) => t.type !== 'DETECTED')).toEqual([
      expect.objectContaining({ type: 'STATUS_CHANGED', from: 'OPEN', to: 'IGNORED' }),
      expect.objectContaining({ type: 'REVIEWED', from: 'UNREVIEWED', to: 'INTENTIONAL' }),
    ]);
    const issue = (await agent.get(`/api/issues/${issueId}`)).body.data;
    expect(issue.tracking.reviewStatus).toBe('INTENTIONAL');
  });
});

describe('classification in the issue API', () => {
  it('returns classification and review status, and filters by both', async () => {
    const { agent } = await signUp(ctx.app);
    const { tracked, scanId } = await seed(agent);
    await patch(agent, tracked.id, { reviewStatus: 'CONFIRMED' });

    const list = (await agent.get(`/api/scans/${scanId}/issues`)).body.data;
    expect(list[0]).toMatchObject({
      classification: 'POTENTIAL_DEFECT',
      tracked: { status: 'OPEN', reviewStatus: 'CONFIRMED' },
    });
    const byClass = await agent.get(`/api/scans/${scanId}/issues?classification=DETECTED`);
    expect(byClass.body.data).toHaveLength(0);
    const byReview = await agent.get(`/api/scans/${scanId}/issues?reviewStatus=CONFIRMED`);
    expect(byReview.body.data).toHaveLength(1);

    const websiteId = tracked.websiteId;
    const trackedList = (
      await agent.get(`/api/websites/${websiteId}/issues?reviewStatus=CONFIRMED`)
    ).body.data;
    expect(trackedList).toEqual([
      expect.objectContaining({ id: tracked.id, reviewStatus: 'CONFIRMED' }),
    ]);
  });
});
