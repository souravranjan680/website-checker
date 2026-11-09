import type { Prisma, PrismaClient } from '@whc/db';
import {
  type CreateWebsiteComparisonInput,
  type Paginated,
  type ProjectRole,
  type UpdateWebsiteComparisonInput,
  type WebsiteComparisonDto,
  type WebsiteComparisonListItemDto,
  type WebsiteComparisonListQuery,
  type WebsiteComparisonStateName,
} from '@whc/shared';
import { logActivity } from '../../lib/activity';
import { AppError, isForeignKeyViolation, notFound } from '../../lib/errors';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import type { AuthUser } from '../../types/express';
import { requireProjectRole, visibleProjectsWhere } from '../projects/project-access';

/**
 * Website comparisons (Phase 9, Milestone 4, Checkpoint 1): two authorized websites of
 * the same project. Only the definition is managed here; runs arrive in Checkpoint 3.
 *
 * Same project is enforced twice: here (both websites loaded and checked in one
 * transaction) and by PostgreSQL (composite foreign keys (websiteId, projectId)).
 */

const SITE = { select: { id: true, name: true, baseUrl: true } } as const;
const INCLUDE = {
  project: { select: { id: true, name: true } },
  reference: SITE,
  target: SITE,
  createdBy: { select: { id: true, name: true } },
  runs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, queuedAt: true, finishedAt: true },
  },
  _count: { select: { runs: true } },
} satisfies Prisma.WebsiteComparisonInclude;

type Row = Prisma.WebsiteComparisonGetPayload<{ include: typeof INCLUDE }>;

/** Derived, never stored (see the WebsiteComparison model). */
export function comparisonState(row: {
  archivedAt: Date | null;
  _count: { runs: number };
}): WebsiteComparisonStateName {
  if (row.archivedAt) return 'ARCHIVED';
  return row._count.runs > 0 ? 'IN_USE' : 'DRAFT';
}

function toListItem(row: Row): WebsiteComparisonListItemDto {
  const latest = row.runs[0];
  return {
    id: row.id,
    projectId: row.project.id,
    projectName: row.project.name,
    name: row.name,
    state: comparisonState(row),
    reference: row.reference,
    target: row.target,
    latestRun: latest
      ? {
          id: latest.id,
          status: latest.status,
          queuedAt: latest.queuedAt.toISOString(),
          finishedAt: latest.finishedAt?.toISOString() ?? null,
        }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDto(row: Row, role: ProjectRole): WebsiteComparisonDto {
  return {
    ...toListItem(row),
    settings: {
      maxPages: row.maxPages,
      maxDepth: row.maxDepth,
      includePatterns: row.includePatterns,
      excludePatterns: row.excludePatterns,
      viewports: row.viewports,
    },
    runCount: row._count.runs,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    myRole: role,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A website is not (or no longer) in the requested project: same answer as the check. */
const websiteNotInProject = (field: 'referenceWebsiteId' | 'targetWebsiteId') =>
  new AppError(404, 'NOT_FOUND', 'Website not found in this project.', [
    { path: field, message: 'Choose a website of this project.' },
  ]);

/** The composite (website, project) foreign keys of WebsiteComparison, by field. */
const WEBSITE_KEYS: Record<string, 'referenceWebsiteId' | 'targetWebsiteId'> = {
  WebsiteComparison_referenceWebsiteId_projectId_fkey: 'referenceWebsiteId',
  WebsiteComparison_targetWebsiteId_projectId_fkey: 'targetWebsiteId',
};

/**
 * Which website key PostgreSQL refused, if the error is exactly that (a website moved to
 * another project or deleted after the check). Any other error, including other foreign
 * keys, returns null and is not translated.
 */
export function refusedWebsiteKey(error: unknown): 'referenceWebsiteId' | 'targetWebsiteId' | null {
  if (!isForeignKeyViolation(error)) return null;
  const constraint = (
    error as { meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } }
  ).meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof constraint === 'string' ? (WEBSITE_KEYS[constraint] ?? null) : null;
}

const runActive = () =>
  new AppError(
    409,
    'WEBSITE_COMPARISON_RUN_ACTIVE',
    'This comparison is running. Wait for it to finish or cancel it first.',
  );

/**
 * 409 for deleting or moving a website that comparisons use (their history is kept, so
 * the website must stay). Lists the comparisons; they are always in the website's own
 * project, which the caller can edit.
 */
export async function websiteInComparisonError(
  prisma: PrismaClient,
  websiteId: string,
): Promise<AppError | null> {
  const where: Prisma.WebsiteComparisonWhereInput = {
    OR: [{ referenceWebsiteId: websiteId }, { targetWebsiteId: websiteId }],
  };
  const [count, comparisons] = await Promise.all([
    prisma.websiteComparison.count({ where }),
    prisma.websiteComparison.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, name: true },
    }),
  ]);
  if (count === 0) return null;
  return new AppError(
    409,
    'WEBSITE_IN_COMPARISON',
    `This website is used by ${count} website comparison${count === 1 ? '' : 's'}. Delete those comparisons first.`,
    { count, comparisons },
  );
}

/** Same as websiteInComparisonError, for a refusal by the database (a race). */
export async function asWebsiteInComparison(
  prisma: PrismaClient,
  websiteId: string,
  error: unknown,
): Promise<unknown> {
  if (!isForeignKeyViolation(error)) return error;
  return (
    (await websiteInComparisonError(prisma, websiteId)) ??
    new AppError(409, 'WEBSITE_IN_COMPARISON', 'This website is used by a website comparison.')
  );
}

export type WebsiteComparisonsService = ReturnType<typeof createWebsiteComparisonsService>;

export function createWebsiteComparisonsService({ prisma }: { prisma: PrismaClient }) {
  /** Loads a comparison the user can see, plus their role. Not visible → 404. */
  async function load(user: AuthUser, id: string, minimum: ProjectRole, action: string) {
    const row = await prisma.websiteComparison.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Website comparison');
    const { role } = await requireProjectRole(prisma, user, row.projectId, minimum, action);
    return { row, role };
  }

  const hasActiveRun = (comparisonId: string) =>
    prisma.websiteComparisonRun
      .count({ where: { comparisonId, activeLock: true } })
      .then((n) => n > 0);

  return {
    async create(
      user: AuthUser,
      input: CreateWebsiteComparisonInput,
    ): Promise<WebsiteComparisonDto> {
      const { role } = await requireProjectRole(
        prisma,
        user,
        input.projectId,
        'EDITOR',
        'create website comparisons',
      );
      // If a website is moved or deleted between the check and the insert, PostgreSQL refuses
      // the insert (composite key); the transaction is rolled back (nothing is saved, not
      // even the activity entry) and the answer is the same 404 as the check's.
      const row = await prisma
        .$transaction(async (tx) => {
          // Both websites must be in this project (PostgreSQL enforces it too). A website the
          // user cannot see, or one of another project, is "not found".
          const sites = await tx.website.findMany({
            where: {
              id: { in: [input.referenceWebsiteId, input.targetWebsiteId] },
              projectId: input.projectId,
            },
            select: { id: true },
          });
          for (const [field, id] of [
            ['referenceWebsiteId', input.referenceWebsiteId],
            ['targetWebsiteId', input.targetWebsiteId],
          ] as const) {
            if (!sites.some((s) => s.id === id)) throw websiteNotInProject(field);
          }
          // Scalar foreign keys: a nested connect cannot set the shared projectId twice.
          const created = await tx.websiteComparison.create({
            data: {
              projectId: input.projectId,
              name: input.name,
              referenceWebsiteId: input.referenceWebsiteId,
              targetWebsiteId: input.targetWebsiteId,
              maxPages: input.maxPages,
              maxDepth: input.maxDepth,
              includePatterns: input.includePatterns,
              excludePatterns: input.excludePatterns,
              viewports: input.viewports,
              createdById: user.id,
            },
            include: INCLUDE,
          });
          await logActivity(tx, {
            userId: user.id,
            projectId: input.projectId,
            action: 'website-comparison.created',
            entityType: 'WebsiteComparison',
            entityId: created.id,
            metadata: {
              name: created.name,
              referenceWebsiteId: created.referenceWebsiteId,
              targetWebsiteId: created.targetWebsiteId,
            },
          });
          return created;
        })
        .catch((error: unknown) => {
          const field = refusedWebsiteKey(error);
          throw field ? websiteNotInProject(field) : error;
        });
      return toDto(row, role);
    },

    async list(
      user: AuthUser,
      query: WebsiteComparisonListQuery,
    ): Promise<Paginated<WebsiteComparisonListItemDto>> {
      const where: Prisma.WebsiteComparisonWhereInput = {
        project: visibleProjectsWhere(user),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.archived === 'all'
          ? {}
          : { archivedAt: query.archived === 'true' ? { not: null } : null }),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { reference: { name: { contains: query.q, mode: 'insensitive' } } },
                { target: { name: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.websiteComparison.count({ where }),
        prisma.websiteComparison.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
          include: INCLUDE,
        }),
      ]);
      return { data: rows.map(toListItem), meta: pageMeta(query.page, query.pageSize, total) };
    },

    async get(user: AuthUser, id: string): Promise<WebsiteComparisonDto> {
      const { row, role } = await load(user, id, 'VIEWER', 'view it');
      return toDto(row, role);
    },

    async update(
      user: AuthUser,
      id: string,
      input: UpdateWebsiteComparisonInput,
    ): Promise<WebsiteComparisonDto> {
      const { row, role } = await load(user, id, 'EDITOR', 'edit website comparisons');
      const { archived, ...settings } = input;
      const changesSettings = Object.keys(settings).length > 0;
      if (changesSettings && (await hasActiveRun(id))) throw runActive();
      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.websiteComparison.update({
          where: { id },
          data: {
            ...settings,
            ...(archived === undefined
              ? {}
              : { archivedAt: archived ? (row.archivedAt ?? new Date()) : null }),
          },
          include: INCLUDE,
        });
        const action =
          archived === true && !row.archivedAt
            ? 'website-comparison.archived'
            : archived === false && row.archivedAt
              ? 'website-comparison.restored'
              : 'website-comparison.updated';
        await logActivity(tx, {
          userId: user.id,
          projectId: row.projectId,
          action,
          entityType: 'WebsiteComparison',
          entityId: id,
          metadata: { name: next.name, fields: Object.keys(input) },
        });
        return next;
      });
      return toDto(updated, role);
    },

    async remove(user: AuthUser, id: string): Promise<void> {
      const { row } = await load(user, id, 'EDITOR', 'delete website comparisons');
      if (await hasActiveRun(id)) throw runActive();
      await prisma.$transaction(async (tx) => {
        await tx.websiteComparison.delete({ where: { id } });
        await logActivity(tx, {
          userId: user.id,
          projectId: row.projectId,
          action: 'website-comparison.deleted',
          entityType: 'WebsiteComparison',
          entityId: id,
          metadata: { name: row.name, runs: row._count.runs },
        });
      });
    },
  };
}
