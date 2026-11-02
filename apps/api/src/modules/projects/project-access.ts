import type { Prisma, PrismaClient, Project } from '@whc/db';
import type { ProjectRole } from '@whc/shared';
import { forbidden, notFound } from '../../lib/errors';
import type { AuthUser } from '../../types/express';

/**
 * Role-based access control (docs/05-security.md §5).
 *
 *   VIEWER  can see the project, its websites and reports
 *   EDITOR  + add/edit/delete websites (and start scans from Phase 4)
 *   OWNER   + rename/delete the project, manage members
 *   ADMIN   (global role) acts as OWNER in every project
 */
const ROLE_RANK: Record<ProjectRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function hasRole(role: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Prisma filter: "projects this user may see". Used in every list query so that
 * other people's data is filtered out by the database itself.
 */
export function visibleProjectsWhere(user: AuthUser): Prisma.ProjectWhereInput {
  return user.role === 'ADMIN' ? {} : { members: { some: { userId: user.id } } };
}

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

/**
 * Loads a project and the user's role in it, and checks the minimum role.
 *   not a member → 404 (we don't reveal that the project exists)
 *   member, role too low → 403 with a clear message
 */
export async function requireProjectRole(
  prisma: PrismaClient,
  user: AuthUser,
  projectId: string,
  minimum: ProjectRole,
  action: string,
): Promise<ProjectAccess> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { where: { userId: user.id }, select: { role: true } } },
  });
  const membership = project?.members[0];
  if (!project || (!membership && user.role !== 'ADMIN')) throw notFound('Project');

  const role: ProjectRole = user.role === 'ADMIN' ? 'OWNER' : membership!.role;
  if (!hasRole(role, minimum)) {
    throw forbidden(`You need the ${minimum.toLowerCase()} role in this project to ${action}.`);
  }
  const { members: _members, ...plainProject } = project;
  return { project: plainProject, role };
}
