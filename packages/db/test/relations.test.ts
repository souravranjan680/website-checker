/**
 * Proves that the schema's relations, unique constraints and delete rules
 * behave as designed in docs/03-database.md. Runs against DATABASE_URL_TEST.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, Prisma } from '../src';
import { getTestDatabaseUrl } from './test-env';

const prisma = createPrismaClient(getTestDatabaseUrl());

afterAll(async () => {
  await prisma.$disconnect();
});

/** Empties every table (except Prisma's migration history) between tests. */
async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  // Table names come from Postgres itself, not from user input.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

beforeEach(resetDatabase);

/** Builds one complete chain: user → project → website → scan → page → issue → ... */
async function createScanGraph() {
  const user = await prisma.user.create({
    data: { email: 'qa@example.com', name: 'QA Tester', passwordHash: 'not-a-real-hash' },
  });
  const project = await prisma.project.create({
    data: {
      name: 'Marketing sites',
      createdById: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  const website = await prisma.website.create({
    data: {
      projectId: project.id,
      name: 'Homepage',
      baseUrl: 'https://example.com/',
      hostname: 'example.com',
      authorizationConfirmedAt: new Date(),
      createdById: user.id,
    },
  });
  const scan = await prisma.scan.create({
    data: { websiteId: website.id, triggeredById: user.id, config: { maxPages: 5 } },
  });
  const page = await prisma.scanPage.create({
    data: { scanId: scan.id, url: 'https://example.com/', normalizedUrl: 'https://example.com/' },
  });
  const screenshot = await prisma.screenshot.create({
    data: {
      scanId: scan.id,
      scanPageId: page.id,
      kind: 'PAGE_FULL',
      width: 1920,
      height: 3000,
      storageKey: `scans/${scan.id}/page.png`,
      sizeBytes: 12345,
    },
  });
  const tracked = await prisma.trackedIssue.create({
    data: {
      websiteId: website.id,
      fingerprint: 'fp-image-alt-1',
      category: 'ACCESSIBILITY',
      ruleId: 'image-alt',
      title: 'Images must have alternate text',
      severity: 'CRITICAL',
      firstSeenScanId: scan.id,
      lastSeenScanId: scan.id,
    },
  });
  const issue = await prisma.issue.create({
    data: {
      scanId: scan.id,
      scanPageId: page.id,
      trackedIssueId: tracked.id,
      screenshotId: screenshot.id,
      category: 'ACCESSIBILITY',
      severity: 'CRITICAL',
      ruleId: 'image-alt',
      title: 'Images must have alternate text',
      description: 'Ensures <img> elements have alternate text',
      selector: 'img.hero',
      htmlSnippet: '<img class="hero" src="/hero.png">',
      fingerprint: 'fp-image-alt-1',
      accessibility: {
        create: {
          axeRuleId: 'image-alt',
          impact: 'critical',
          wcagCriteria: ['1.1.1'],
          wcagLevel: 'A',
        },
      },
    },
  });
  return { user, project, website, scan, page, screenshot, tracked, issue };
}

describe('relations', () => {
  it('loads the whole chain through nested includes', async () => {
    const { issue } = await createScanGraph();

    const loaded = await prisma.issue.findUniqueOrThrow({
      where: { id: issue.id },
      include: {
        accessibility: true,
        screenshot: true,
        trackedIssue: true,
        scanPage: true,
        scan: { include: { website: { include: { project: { include: { members: true } } } } } },
      },
    });

    expect(loaded.accessibility?.wcagCriteria).toEqual(['1.1.1']);
    expect(loaded.screenshot?.kind).toBe('PAGE_FULL');
    expect(loaded.trackedIssue?.fingerprint).toBe('fp-image-alt-1');
    expect(loaded.scanPage?.url).toBe('https://example.com/');
    expect(loaded.scan.website.hostname).toBe('example.com');
    expect(loaded.scan.website.project.members[0]?.role).toBe('OWNER');
  });

  it('finds scans by project membership (the pattern used for authorization)', async () => {
    const { user, scan } = await createScanGraph();
    const outsider = await prisma.user.create({
      data: { email: 'other@example.com', name: 'Other', passwordHash: 'x' },
    });

    const visible = (userId: string) =>
      prisma.scan.findFirst({
        where: { id: scan.id, website: { project: { members: { some: { userId } } } } },
      });

    expect(await visible(user.id)).not.toBeNull();
    expect(await visible(outsider.id)).toBeNull();
  });

  it('links a scan to the previous scan for comparisons', async () => {
    const { website, scan } = await createScanGraph();
    const next = await prisma.scan.create({
      data: { websiteId: website.id, config: {}, previousScanId: scan.id, trigger: 'RESCAN' },
      include: { previousScan: true },
    });
    expect(next.previousScan?.id).toBe(scan.id);
  });

  it('connects visual baselines, comparisons, bug reports and AI insights', async () => {
    const { user, project, website, scan, screenshot, issue } = await createScanGraph();

    const baselineShot = await prisma.screenshot.create({
      data: {
        kind: 'BASELINE',
        width: 1920,
        height: 1080,
        storageKey: 'baselines/a.png',
        sizeBytes: 1,
      },
    });
    const baseline = await prisma.visualBaseline.create({
      data: {
        websiteId: website.id,
        pageUrl: 'https://example.com/',
        viewport: '1920x1080',
        screenshotId: baselineShot.id,
        createdById: user.id,
      },
    });
    await prisma.visualComparison.create({
      data: {
        baselineId: baseline.id,
        scanId: scan.id,
        currentScreenshotId: screenshot.id,
        diffPixels: 100,
        totalPixels: 2_073_600,
        diffPercent: 0.005,
        passed: true,
      },
    });
    await prisma.bugReport.create({
      data: {
        projectId: project.id,
        websiteId: website.id,
        issueId: issue.id,
        title: 'Hero image has no alt text',
        description: 'Screen readers announce only the file name.',
        severity: 'CRITICAL',
        affectedUrl: 'https://example.com/',
        browser: 'Chromium',
        viewport: '1920x1080',
        stepsToReproduce: ['Open the homepage', 'Inspect the hero image'],
        expectedBehavior: 'Image has a meaningful alt attribute',
        actualBehavior: 'alt attribute missing',
      },
    });
    await prisma.aiInsight.create({
      data: {
        issueId: issue.id,
        kind: 'EXPLANATION',
        model: 'claude-sonnet-5-5',
        content: { summary: 'x' },
      },
    });

    const loaded = await prisma.issue.findUniqueOrThrow({
      where: { id: issue.id },
      include: { bugReports: true, aiInsights: true },
    });
    const loadedBaseline = await prisma.visualBaseline.findUniqueOrThrow({
      where: { id: baseline.id },
      include: { comparisons: true, screenshot: true },
    });

    expect(loaded.bugReports).toHaveLength(1);
    expect(loaded.aiInsights).toHaveLength(1);
    expect(loadedBaseline.comparisons).toHaveLength(1);
    expect(loadedBaseline.screenshot.kind).toBe('BASELINE');
  });
});

describe('unique constraints', () => {
  it('rejects a second user with the same email', async () => {
    await createScanGraph();
    await expect(
      prisma.user.create({ data: { email: 'qa@example.com', name: 'Dup', passwordHash: 'x' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects the same issue fingerprint twice in one scan', async () => {
    const { scan } = await createScanGraph();
    await expect(
      prisma.issue.create({
        data: {
          scanId: scan.id,
          category: 'ACCESSIBILITY',
          severity: 'LOW',
          ruleId: 'image-alt',
          title: 'dup',
          description: 'dup',
          fingerprint: 'fp-image-alt-1',
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('rejects the same website URL twice in one project', async () => {
    const { project } = await createScanGraph();
    await expect(
      prisma.website.create({
        data: {
          projectId: project.id,
          name: 'Again',
          baseUrl: 'https://example.com/',
          hostname: 'example.com',
          authorizationConfirmedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('delete rules', () => {
  it('deleting a project removes its websites, scans, pages, issues and details', async () => {
    const { project } = await createScanGraph();

    await prisma.project.delete({ where: { id: project.id } });

    expect(await prisma.website.count()).toBe(0);
    expect(await prisma.scan.count()).toBe(0);
    expect(await prisma.scanPage.count()).toBe(0);
    expect(await prisma.issue.count()).toBe(0);
    expect(await prisma.accessibilityIssue.count()).toBe(0);
    expect(await prisma.trackedIssue.count()).toBe(0);
    expect(await prisma.screenshot.count()).toBe(0);
  });

  it('deleting a scan keeps the tracked issue but clears its scan links', async () => {
    const { scan, tracked } = await createScanGraph();

    await prisma.scan.delete({ where: { id: scan.id } });

    const after = await prisma.trackedIssue.findUniqueOrThrow({ where: { id: tracked.id } });
    expect(after.firstSeenScanId).toBeNull();
    expect(after.lastSeenScanId).toBeNull();
  });

  it('deleting a user keeps team data and audit logs, but removes their sessions', async () => {
    const { user, project, scan } = await createScanGraph();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'h1',
        familyId: 'f1',
        expiresAt: new Date(Date.now() + 1e6),
      },
    });
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        projectId: project.id,
        action: 'scan.started',
        entityType: 'Scan',
        entityId: scan.id,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.refreshToken.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
    const keptProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(keptProject.createdById).toBeNull();
    const keptScan = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(keptScan.triggeredById).toBeNull();
    const log = await prisma.activityLog.findFirstOrThrow();
    expect(log.userId).toBeNull();
  });

  it('deleting an issue keeps its bug report (with copied fields) but removes AI insights', async () => {
    const { project, issue } = await createScanGraph();
    const report = await prisma.bugReport.create({
      data: {
        projectId: project.id,
        issueId: issue.id,
        title: 'Hero image has no alt text',
        description: 'd',
        severity: 'CRITICAL',
        affectedUrl: 'https://example.com/',
        browser: 'Chromium',
        viewport: '1920x1080',
        expectedBehavior: 'e',
        actualBehavior: 'a',
      },
    });
    await prisma.aiInsight.create({
      data: { issueId: issue.id, kind: 'FIX', model: 'claude-sonnet-5-5', content: {} },
    });

    await prisma.issue.delete({ where: { id: issue.id } });

    const kept = await prisma.bugReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(kept.issueId).toBeNull();
    expect(kept.title).toBe('Hero image has no alt text');
    expect(await prisma.aiInsight.count()).toBe(0);
  });
});
