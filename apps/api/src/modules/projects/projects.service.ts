import type { PrismaClient } from '@whc/db';
import type {
  AddMemberInput,
  CreateProjectInput,
  ListQuery,
  Paginated,
  ProjectDetailsDto,
  ProjectMemberDto,
  ProjectRole,
  ProjectSummaryDto,
  UpdateProjectInput,
} from '@whc/shared';
import { logActivity } from '../../lib/activity';
import { AppError, notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import type { AuthUser } from '../../types/express';
import { requireProjectRole, visibleProjectsWhere } from './project-access';

export type ProjectsService = ReturnType<typeof createProjectsService>;

export function createProjectsService({ prisma }: { prisma: PrismaClient }) {
  /** Number of scans per project (scans belong to websites, which belong to projects). */
  async function scanCountsByProject(projectIds: string[]): Promise<Map<string, number>> {
    const websites = await prisma.website.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, _count: { select: { scans: true } } },
    });
    const counts = new Map<string, number>();
    for (const website of websites) {
      counts.set(website.projectId, (counts.get(website.projectId) ?? 0) + website._count.scans);
    }
    return counts;
  }

  async function ensureAnotherOwner(projectId: string, excludingUserId: string): Promise<void> {
    const otherOwners = await prisma.projectMember.count({
      where: { projectId, role: 'OWNER', userId: { not: excludingUserId } },
    });
    if (otherOwners === 0) {
      throw new AppError(
        422,
        'LAST_OWNER',
        'A project needs at least one owner. Make someone else an owner first.',
      );
    }
  }

  return {
    async list(user: AuthUser, query: ListQuery): Promise<Paginated<ProjectSummaryDto>> {
      const where = {
        ...visibleProjectsWhere(user),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      };
      const [total, projects] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
          include: {
            members: { where: { userId: user.id }, select: { role: true } },
            _count: { select: { websites: true, members: true } },
          },
        }),
      ]);
      const scanCounts = await scanCountsByProject(projects.map((p) => p.id));

      return {
        data: projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          myRole: user.role === 'ADMIN' ? 'OWNER' : (p.members[0]?.role ?? 'VIEWER'),
          websiteCount: p._count.websites,
          memberCount: p._count.members,
          scanCount: scanCounts.get(p.id) ?? 0,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    /** The creator automatically becomes the project's OWNER (in the same transaction). */
    async create(user: AuthUser, input: CreateProjectInput): Promise<ProjectDetailsDto> {
      const project = await prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: {
            name: input.name,
            description: input.description || null,
            createdById: user.id,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        await logActivity(tx, {
          userId: user.id,
          projectId: created.id,
          action: 'project.created',
          entityType: 'Project',
          entityId: created.id,
          metadata: { name: created.name },
        });
        return created;
      });
      return this.get(user, project.id);
    },

    /** Details plus statistics computed from real rows (zero until scans exist). */
    async get(user: AuthUser, projectId: string): Promise<ProjectDetailsDto> {
      const { project, role } = await requireProjectRole(
        prisma,
        user,
        projectId,
        'VIEWER',
        'view it',
      );
      const inProject = { website: { projectId } };
      const [websiteCount, memberCount, scanCount, completedScanCount, openIssueCount, lastScan] =
        await Promise.all([
          prisma.website.count({ where: { projectId } }),
          prisma.projectMember.count({ where: { projectId } }),
          prisma.scan.count({ where: inProject }),
          prisma.scan.count({ where: { ...inProject, status: { in: ['COMPLETED', 'PARTIAL'] } } }),
          prisma.trackedIssue.count({ where: { ...inProject, status: 'OPEN' } }),
          prisma.scan.findFirst({
            where: inProject,
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        myRole: role,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        stats: {
          websiteCount,
          memberCount,
          scanCount,
          completedScanCount,
          openIssueCount,
          lastScanAt: lastScan?.createdAt.toISOString() ?? null,
        },
      };
    },

    async update(
      user: AuthUser,
      projectId: string,
      input: UpdateProjectInput,
    ): Promise<ProjectDetailsDto> {
      await requireProjectRole(prisma, user, projectId, 'EDITOR', 'edit it');
      await prisma.project.update({
        where: { id: projectId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
        },
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId,
        action: 'project.updated',
        entityType: 'Project',
        entityId: projectId,
        metadata: { fields: Object.keys(input) },
      });
      return this.get(user, projectId);
    },

    /** Deletes the project and (by database cascade) its websites, scans and issues. */
    async remove(user: AuthUser, projectId: string, confirmName: string): Promise<void> {
      const { project } = await requireProjectRole(prisma, user, projectId, 'OWNER', 'delete it');
      if (confirmName.trim() !== project.name) {
        throw new AppError(400, 'VALIDATION_ERROR', 'The project name does not match.', [
          { path: 'confirmName', message: `Type "${project.name}" to confirm.` },
        ]);
      }
      await prisma.project.delete({ where: { id: projectId } });
      // The activity log row survives (projectId is set to null by the database).
      await logActivity(prisma, {
        userId: user.id,
        action: 'project.deleted',
        entityType: 'Project',
        entityId: projectId,
        metadata: { name: project.name },
      });
    },

    async listMembers(user: AuthUser, projectId: string): Promise<ProjectMemberDto[]> {
      await requireProjectRole(prisma, user, projectId, 'VIEWER', 'view its members');
      const members = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });
      return members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
      }));
    },

    async addMember(
      user: AuthUser,
      projectId: string,
      input: AddMemberInput,
    ): Promise<ProjectMemberDto> {
      await requireProjectRole(prisma, user, projectId, 'OWNER', 'add members');
      const invitee = await prisma.user.findUnique({ where: { email: input.email } });
      if (!invitee || !invitee.isActive) {
        throw new AppError(
          404,
          'USER_NOT_FOUND',
          'No account uses this email. Ask them to register first.',
          [{ path: 'email', message: 'No account uses this email.' }],
        );
      }
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: invitee.id } },
      });
      if (existing) {
        throw new AppError(409, 'ALREADY_MEMBER', 'This person is already a member.', [
          { path: 'email', message: 'Already a member of this project.' },
        ]);
      }
      const member = await prisma.projectMember.create({
        data: { projectId, userId: invitee.id, role: input.role },
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId,
        action: 'member.added',
        entityType: 'User',
        entityId: invitee.id,
        metadata: { email: invitee.email, role: input.role },
      });
      return {
        userId: invitee.id,
        name: invitee.name,
        email: invitee.email,
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
      };
    },

    async updateMemberRole(user: AuthUser, projectId: string, memberId: string, role: ProjectRole) {
      await requireProjectRole(prisma, user, projectId, 'OWNER', 'change member roles');
      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: memberId } },
      });
      if (!member) throw notFound('Member');
      if (member.role === 'OWNER' && role !== 'OWNER')
        await ensureAnotherOwner(projectId, memberId);

      await prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId: memberId } },
        data: { role },
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId,
        action: 'member.role_changed',
        entityType: 'User',
        entityId: memberId,
        metadata: { from: member.role, to: role },
      });
    },

    /** Owners can remove anyone; any member can remove themselves ("leave project"). */
    async removeMember(user: AuthUser, projectId: string, memberId: string): Promise<void> {
      const leaving = memberId === user.id;
      await requireProjectRole(
        prisma,
        user,
        projectId,
        leaving ? 'VIEWER' : 'OWNER',
        'remove members',
      );
      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: memberId } },
      });
      if (!member) throw notFound('Member');
      if (member.role === 'OWNER') await ensureAnotherOwner(projectId, memberId);

      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId, userId: memberId } },
      });
      await logActivity(prisma, {
        userId: user.id,
        projectId,
        action: leaving ? 'member.left' : 'member.removed',
        entityType: 'User',
        entityId: memberId,
      });
    },
  };
}
