import type { Prisma, PrismaClient, Scan, Website } from '@whc/db';
import {
  DEFAULT_WEBSITE_SETTINGS,
  normalizeWebsiteUrl,
  type CreateWebsiteInput,
  type ListQuery,
  type Paginated,
  type ProjectRole,
  type ScanSummaryDto,
  type UpdateWebsiteInput,
  type WebsiteDto,
} from '@whc/shared';
import { logActivity } from '../../lib/activity';
import { randomToken } from '../../lib/crypto';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { assertPublicHostname, type ResolveHostname } from '../../lib/hostname-guard';
import { pageMeta, toSkipTake } from '../../lib/pagination';
import type { AuthUser } from '../../types/express';
import { hasRole, requireProjectRole, visibleProjectsWhere } from '../projects/project-access';

const SCAN_SUMMARY_SELECT = {
  id: true,
  status: true,
  trigger: true,
  mode: true,
  progress: true,
  totalIssues: true,
  criticalCount: true,
  accessibilityScore: true,
  performanceScore: true,
  uiHealthScore: true,
  createdAt: true,
  finishedAt: true,
  durationMs: true,
} satisfies Prisma.ScanSelect;

type ScanSummaryRow = Pick<Scan, keyof typeof SCAN_SUMMARY_SELECT>;

export function toScanSummary(scan: ScanSummaryRow): ScanSummaryDto {
  return {
    ...scan,
    createdAt: scan.createdAt.toISOString(),
    finishedAt: scan.finishedAt?.toISOString() ?? null,
  };
}

const WEBSITE_INCLUDE = (userId: string) =>
  ({
    project: { select: { name: true, members: { where: { userId }, select: { role: true } } } },
    _count: { select: { scans: true } },
    scans: { orderBy: { createdAt: 'desc' }, take: 1, select: SCAN_SUMMARY_SELECT },
  }) satisfies Prisma.WebsiteInclude;

type WebsiteRow = Website & {
  project: { name: string; members: { role: ProjectRole }[] };
  _count: { scans: number };
  scans: ScanSummaryRow[];
};

function toWebsiteDto(website: WebsiteRow, user: AuthUser): WebsiteDto {
  return {
    id: website.id,
    projectId: website.projectId,
    projectName: website.project.name,
    name: website.name,
    baseUrl: website.baseUrl,
    hostname: website.hostname,
    maxDepth: website.maxDepth,
    maxPages: website.maxPages,
    includePatterns: website.includePatterns,
    excludePatterns: website.excludePatterns,
    respectRobotsTxt: website.respectRobotsTxt,
    responsivePageLimit: website.responsivePageLimit,
    lighthousePageLimit: website.lighthousePageLimit,
    verificationStatus: website.verificationStatus,
    authorizationConfirmedAt: website.authorizationConfirmedAt.toISOString(),
    myRole: user.role === 'ADMIN' ? 'OWNER' : (website.project.members[0]?.role ?? 'VIEWER'),
    scanCount: website._count.scans,
    lastScan: website.scans[0] ? toScanSummary(website.scans[0]) : null,
    createdAt: website.createdAt.toISOString(),
    updatedAt: website.updatedAt.toISOString(),
  };
}

const duplicateWebsite = () =>
  new AppError(409, 'WEBSITE_EXISTS', 'This website is already in the project.', [
    { path: 'baseUrl', message: 'This website is already in the project.' },
  ]);

export type WebsitesService = ReturnType<typeof createWebsitesService>;

export function createWebsitesService(deps: {
  prisma: PrismaClient;
  resolveHostname: ResolveHostname;
}) {
  const { prisma } = deps;

  /** Syntax rules (layer 1) + DNS must point to public addresses (layer 2). */
  async function checkUrl(rawUrl: string): Promise<{ url: string; hostname: string }> {
    const result = normalizeWebsiteUrl(rawUrl);
    if (!result.ok) {
      throw new AppError(400, 'UNSAFE_URL', result.reason, [
        { path: 'baseUrl', message: result.reason },
      ]);
    }
    await assertPublicHostname(result.hostname, deps.resolveHostname);
    return { url: result.url, hostname: result.hostname };
  }

  /** Loads a website the user can see, plus their role. Not visible → 404. */
  async function loadWebsite(
    user: AuthUser,
    websiteId: string,
    minimum: ProjectRole,
    action: string,
  ) {
    const website = await prisma.website.findUnique({
      where: { id: websiteId },
      include: WEBSITE_INCLUDE(user.id),
    });
    if (!website) throw notFound('Website');
    // Same rule as projects: non-members get 404, low roles get 403.
    await requireProjectRole(prisma, user, website.projectId, minimum, action);
    return website;
  }

  return {
    async list(
      user: AuthUser,
      query: ListQuery & { projectId?: string },
    ): Promise<Paginated<WebsiteDto>> {
      const where: Prisma.WebsiteWhereInput = {
        project: visibleProjectsWhere(user),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { baseUrl: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [total, websites] = await Promise.all([
        prisma.website.count({ where }),
        prisma.website.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
          include: WEBSITE_INCLUDE(user.id),
        }),
      ]);
      return {
        data: websites.map((w) => toWebsiteDto(w, user)),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    async create(user: AuthUser, input: CreateWebsiteInput): Promise<WebsiteDto> {
      await requireProjectRole(prisma, user, input.projectId, 'EDITOR', 'add websites');
      const { url, hostname } = await checkUrl(input.baseUrl);
      const settings = { ...DEFAULT_WEBSITE_SETTINGS };
      for (const key of Object.keys(settings) as (keyof typeof settings)[]) {
        if (input[key] !== undefined) Object.assign(settings, { [key]: input[key] });
      }

      try {
        const website = await prisma.website.create({
          data: {
            projectId: input.projectId,
            name: input.name,
            baseUrl: url,
            hostname,
            ...settings,
            verificationToken: randomToken(24), // for domain verification (Phase 4)
            authorizationConfirmedAt: new Date(),
            createdById: user.id,
          },
          include: WEBSITE_INCLUDE(user.id),
        });
        await logActivity(prisma, {
          userId: user.id,
          projectId: input.projectId,
          action: 'website.created',
          entityType: 'Website',
          entityId: website.id,
          metadata: { name: website.name, baseUrl: url, authorizationConfirmed: true },
        });
        return toWebsiteDto(website, user);
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateWebsite();
        throw error;
      }
    },

    async get(user: AuthUser, websiteId: string): Promise<WebsiteDto> {
      return toWebsiteDto(await loadWebsite(user, websiteId, 'VIEWER', 'view it'), user);
    },

    async update(
      user: AuthUser,
      websiteId: string,
      input: UpdateWebsiteInput,
    ): Promise<WebsiteDto> {
      const website = await loadWebsite(user, websiteId, 'EDITOR', 'edit websites');
      const data: Prisma.WebsiteUncheckedUpdateInput = {};

      if (input.projectId && input.projectId !== website.projectId) {
        // Moving a website: you must be allowed to add websites to the target project too.
        const target = await requireProjectRole(
          prisma,
          user,
          input.projectId,
          'EDITOR',
          'add websites',
        );
        if (!hasRole(target.role, 'EDITOR')) throw notFound('Project');
        data.projectId = input.projectId;
      }

      if (input.baseUrl !== undefined) {
        const { url, hostname } = await checkUrl(input.baseUrl);
        if (url !== website.baseUrl) {
          // A different site needs a fresh "I'm authorized to test this" confirmation.
          if (input.authorizationConfirmed !== true) {
            throw new AppError(
              400,
              'AUTHORIZATION_REQUIRED',
              'Confirm you are authorized to test the new address.',
              [
                {
                  path: 'authorizationConfirmed',
                  message: 'Confirm you are authorized to test the new address.',
                },
              ],
            );
          }
          Object.assign(data, {
            baseUrl: url,
            hostname,
            authorizationConfirmedAt: new Date(),
            verificationStatus: 'UNVERIFIED',
            verifiedAt: null,
          });
        }
      }

      for (const key of [
        'name',
        'maxDepth',
        'maxPages',
        'includePatterns',
        'excludePatterns',
        'respectRobotsTxt',
        'responsivePageLimit',
        'lighthousePageLimit',
      ] as const) {
        if (input[key] !== undefined) Object.assign(data, { [key]: input[key] });
      }

      try {
        const updated = await prisma.website.update({
          where: { id: websiteId },
          data,
          include: WEBSITE_INCLUDE(user.id),
        });
        await logActivity(prisma, {
          userId: user.id,
          projectId: updated.projectId,
          action: 'website.updated',
          entityType: 'Website',
          entityId: websiteId,
          metadata: { fields: Object.keys(data) },
        });
        return toWebsiteDto(updated, user);
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateWebsite();
        throw error;
      }
    },

    async remove(user: AuthUser, websiteId: string): Promise<void> {
      const website = await loadWebsite(user, websiteId, 'EDITOR', 'delete websites');
      await prisma.website.delete({ where: { id: websiteId } });
      await logActivity(prisma, {
        userId: user.id,
        projectId: website.projectId,
        action: 'website.deleted',
        entityType: 'Website',
        entityId: websiteId,
        metadata: { name: website.name, baseUrl: website.baseUrl },
      });
    },

    /** Real scan history. Empty until the scanner exists (Phase 4); never invented. */
    async listScans(
      user: AuthUser,
      websiteId: string,
      query: ListQuery,
    ): Promise<Paginated<ScanSummaryDto>> {
      await loadWebsite(user, websiteId, 'VIEWER', 'view its scans');
      const where = { websiteId };
      const [total, scans] = await Promise.all([
        prisma.scan.count({ where }),
        prisma.scan.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(query.page, query.pageSize),
          select: SCAN_SUMMARY_SELECT,
        }),
      ]);
      return { data: scans.map(toScanSummary), meta: pageMeta(query.page, query.pageSize, total) };
    },
  };
}
