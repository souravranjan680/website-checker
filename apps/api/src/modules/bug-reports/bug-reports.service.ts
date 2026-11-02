import type { Prisma, PrismaClient } from '@whc/db';
import type { BugReportDto, Paginated, ProjectRole } from '@whc/shared';
import { logActivity } from '../../lib/activity';
import { notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import type { AuthUser } from '../../types/express';
import { requireProjectRole, visibleProjectsWhere } from '../projects/project-access';
import { BUG_REPORT_ISSUE_INCLUDE, buildBugReport } from './builder';

const INCLUDE = {
  website: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  issue: { select: { scanId: true } },
} satisfies Prisma.BugReportInclude;

type Row = Prisma.BugReportGetPayload<{ include: typeof INCLUDE }>;

function toDto(row: Row, myRole: ProjectRole): BugReportDto {
  return {
    id: row.id,
    projectId: row.projectId,
    website: row.website,
    issueId: row.issueId,
    scanId: row.issue?.scanId ?? null,
    title: row.title,
    description: row.description,
    severity: row.severity,
    priority: row.priority,
    status: row.status,
    affectedUrl: row.affectedUrl,
    browser: row.browser,
    viewport: row.viewport,
    stepsToReproduce: row.stepsToReproduce,
    expectedBehavior: row.expectedBehavior,
    actualBehavior: row.actualBehavior,
    selector: row.selector,
    htmlSnippet: row.htmlSnippet,
    suggestedFix: row.suggestedFix,
    screenshotId: row.screenshotId,
    aiGenerated: row.aiGenerated,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    myRole,
  };
}

export type BugReportsService = ReturnType<typeof createBugReportsService>;

export function createBugReportsService({ prisma }: { prisma: PrismaClient }) {
  async function load(user: AuthUser, id: string, minimum: ProjectRole, action: string) {
    const row = await prisma.bugReport.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Bug report');
    const { role } = await requireProjectRole(prisma, user, row.projectId, minimum, action);
    return { row, role };
  }

  return {
    /**
     * Creates a bug report from a detected issue (editors and owners). If the issue
     * already has an open report, that one is returned instead of a duplicate.
     */
    async createFromIssue(
      user: AuthUser,
      issueId: string,
    ): Promise<{ report: BugReportDto; created: boolean }> {
      const issue = await prisma.issue.findUnique({
        where: { id: issueId },
        include: BUG_REPORT_ISSUE_INCLUDE,
      });
      if (!issue) throw notFound('Issue');
      const website = issue.scan.website;
      const { role } = await requireProjectRole(
        prisma,
        user,
        website.projectId,
        'EDITOR',
        'create bug reports',
      );

      const existing = await prisma.bugReport.findFirst({
        where: { issueId, status: { not: 'CLOSED' } },
        include: INCLUDE,
      });
      if (existing) return { report: toDto(existing, role), created: false };

      const draft = buildBugReport(issue);
      const row = await prisma.bugReport.create({
        data: {
          ...draft,
          projectId: website.projectId,
          websiteId: website.id,
          issueId,
          createdById: user.id,
        },
        include: INCLUDE,
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId: website.projectId,
        action: 'bug_report.created',
        entityType: 'BugReport',
        entityId: row.id,
        metadata: { websiteId: website.id, title: row.title },
      });
      return { report: toDto(row, role), created: true };
    },

    async list(
      user: AuthUser,
      query: {
        page: number;
        pageSize: number;
        q?: string;
        projectId?: string;
        websiteId?: string;
        status?: BugReportDto['status'];
      },
    ): Promise<Paginated<BugReportDto>> {
      const where: Prisma.BugReportWhereInput = {
        project: visibleProjectsWhere(user),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.websiteId ? { websiteId: query.websiteId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { affectedUrl: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.bugReport.count({ where }),
        prisma.bugReport.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
          include: {
            ...INCLUDE,
            project: {
              select: { members: { where: { userId: user.id }, select: { role: true } } },
            },
          },
        }),
      ]);
      return {
        // Admins see every project without being members: they get VIEWER rights in lists.
        data: rows.map((row) => toDto(row, row.project.members[0]?.role ?? 'VIEWER')),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async get(user: AuthUser, id: string): Promise<BugReportDto> {
      const { row, role } = await load(user, id, 'VIEWER', 'view bug reports');
      return toDto(row, role);
    },

    async update(
      user: AuthUser,
      id: string,
      input: Partial<
        Pick<
          BugReportDto,
          | 'title'
          | 'description'
          | 'priority'
          | 'status'
          | 'stepsToReproduce'
          | 'expectedBehavior'
          | 'actualBehavior'
          | 'suggestedFix'
        >
      >,
    ): Promise<BugReportDto> {
      const { row: before, role } = await load(user, id, 'EDITOR', 'edit bug reports');
      const row = await prisma.bugReport.update({ where: { id }, data: input, include: INCLUDE });
      await logActivity(prisma, {
        userId: user.id,
        projectId: row.projectId,
        action: 'bug_report.updated',
        entityType: 'BugReport',
        entityId: id,
        metadata: {
          websiteId: row.website?.id ?? null,
          title: row.title,
          ...(input.status && input.status !== before.status
            ? { from: before.status, to: input.status }
            : {}),
        },
      });
      return toDto(row, role);
    },

    async remove(user: AuthUser, id: string): Promise<void> {
      const { row } = await load(user, id, 'EDITOR', 'delete bug reports');
      await prisma.bugReport.delete({ where: { id } });
      await logActivity(prisma, {
        userId: user.id,
        projectId: row.projectId,
        action: 'bug_report.deleted',
        entityType: 'BugReport',
        entityId: id,
        metadata: { websiteId: row.website?.id ?? null, title: row.title },
      });
    },
  };
}
