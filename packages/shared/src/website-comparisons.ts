import { z } from 'zod';
import { VIEWPORTS } from './constants';
import type { ProjectRole } from './dto';
import { idSchema, listQuerySchema } from './schemas/common';
import { pathPatternSchema } from './schemas/websites';

/**
 * Website comparison (Phase 9, Milestone 4: Mode 2). Two authorized websites of the same
 * project compared with each other. Separate from scans and issues (Mode 1).
 */

/**
 * The comparison's own state, derived (never stored): ARCHIVED when archived, DRAFT before
 * its first run, IN_USE once it has runs. Not the status of a run.
 */
export const WEBSITE_COMPARISON_STATES = ['DRAFT', 'IN_USE', 'ARCHIVED'] as const;
export type WebsiteComparisonStateName = (typeof WEBSITE_COMPARISON_STATES)[number];

/** Status of one run (stored on WebsiteComparisonRun). Mirrors the Prisma enum. */
export const WEBSITE_COMPARISON_RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'CANCELLING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
] as const;
export type WebsiteComparisonRunStatusName = (typeof WEBSITE_COMPARISON_RUN_STATUSES)[number];
export const ACTIVE_WEBSITE_COMPARISON_RUN_STATUSES = ['QUEUED', 'RUNNING', 'CANCELLING'] as const;

/** BullMQ queue for comparison runs (used from Checkpoint 3; nothing is queued yet). */
export const WEBSITE_COMPARISON_QUEUE_NAME = 'website-comparisons';

/** Screen sizes a comparison can use: the scan's own sizes, e.g. "1920x1080". */
export const WEBSITE_COMPARISON_VIEWPORTS = VIEWPORTS.map((v) => `${v.width}x${v.height}`);

export const WEBSITE_COMPARISON_LIMITS = { maxPages: 50, maxDepth: 3, patterns: 20 } as const;

const settingsShape = {
  maxPages: z
    .number()
    .int()
    .min(1, 'Minimum is 1.')
    .max(WEBSITE_COMPARISON_LIMITS.maxPages, `Maximum is ${WEBSITE_COMPARISON_LIMITS.maxPages}.`),
  maxDepth: z
    .number()
    .int()
    .min(0, 'Minimum is 0.')
    .max(WEBSITE_COMPARISON_LIMITS.maxDepth, `Maximum is ${WEBSITE_COMPARISON_LIMITS.maxDepth}.`),
  includePatterns: z
    .array(pathPatternSchema)
    .max(WEBSITE_COMPARISON_LIMITS.patterns, 'At most 20 patterns.'),
  excludePatterns: z
    .array(pathPatternSchema)
    .max(WEBSITE_COMPARISON_LIMITS.patterns, 'At most 20 patterns.'),
  viewports: z
    .array(
      z.string().refine((v) => WEBSITE_COMPARISON_VIEWPORTS.includes(v), {
        message: `Use one of: ${WEBSITE_COMPARISON_VIEWPORTS.join(', ')}.`,
      }),
    )
    .min(1, 'Choose at least one screen size.')
    .max(WEBSITE_COMPARISON_VIEWPORTS.length)
    .refine((list) => new Set(list).size === list.length, 'Choose each screen size once.'),
};

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters.')
  .max(80, 'Use at most 80 characters.');

/** POST /api/website-comparisons. Unknown fields are rejected. */
export const createWebsiteComparisonSchema = z
  .strictObject({
    projectId: idSchema,
    name: nameSchema,
    referenceWebsiteId: idSchema,
    targetWebsiteId: idSchema,
    ...settingsShape,
  })
  .partial({
    maxPages: true,
    maxDepth: true,
    includePatterns: true,
    excludePatterns: true,
    viewports: true,
  })
  .refine((input) => input.referenceWebsiteId !== input.targetWebsiteId, {
    path: ['targetWebsiteId'],
    message: 'Choose two different websites.',
  });
export type CreateWebsiteComparisonInput = z.infer<typeof createWebsiteComparisonSchema>;

/**
 * PUT /api/website-comparisons/:id (partial). The two websites cannot be changed: create a
 * new comparison instead. archived: true archives, false restores.
 */
export const updateWebsiteComparisonSchema = z
  .strictObject({ name: nameSchema, archived: z.boolean(), ...settingsShape })
  .partial();
export type UpdateWebsiteComparisonInput = z.infer<typeof updateWebsiteComparisonSchema>;

/** GET /api/website-comparisons?projectId=&q=&archived=&page=&pageSize= */
export const websiteComparisonListQuerySchema = listQuerySchema
  .extend({
    projectId: idSchema.optional(),
    /** Default: only comparisons that are not archived. */
    archived: z.enum(['true', 'false', 'all']).default('false'),
  })
  .strict();
export type WebsiteComparisonListQuery = z.infer<typeof websiteComparisonListQuerySchema>;

export interface WebsiteComparisonSiteDto {
  id: string;
  name: string;
  baseUrl: string;
}

export interface WebsiteComparisonSettingsDto {
  maxPages: number;
  maxDepth: number;
  includePatterns: string[];
  excludePatterns: string[];
  viewports: string[];
}

/** The latest run, if any (runs exist from Checkpoint 3). */
export interface WebsiteComparisonRunSummaryDto {
  id: string;
  status: WebsiteComparisonRunStatusName;
  queuedAt: string;
  finishedAt: string | null;
}

export interface WebsiteComparisonListItemDto {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  state: WebsiteComparisonStateName;
  reference: WebsiteComparisonSiteDto;
  target: WebsiteComparisonSiteDto;
  latestRun: WebsiteComparisonRunSummaryDto | null;
  updatedAt: string;
}

export interface WebsiteComparisonDto extends WebsiteComparisonListItemDto {
  settings: WebsiteComparisonSettingsDto;
  runCount: number;
  archivedAt: string | null;
  createdBy: { id: string; name: string } | null;
  myRole: ProjectRole;
  createdAt: string;
}

/** One run (contract only: the run endpoints arrive in Checkpoint 3). */
export interface WebsiteComparisonRunDto {
  id: string;
  comparisonId: string;
  status: WebsiteComparisonRunStatusName;
  progress: number;
  currentStep: string | null;
  referencePages: number;
  targetPages: number;
  pagesFailed: number;
  errorMessage: string | null;
  failureCode: string | null;
  browserVersion: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}
