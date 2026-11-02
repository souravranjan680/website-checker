import { z } from 'zod';
import { SEVERITIES, type SeverityName } from './constants';
import { idSchema, listQuerySchema } from './schemas/common';

/** Name of the BullMQ queue that carries scan jobs from the API to the scanner. */
export const SCAN_QUEUE_NAME = 'scans';

/** Redis channels/keys used for live progress and cancellation. */
export const scanChannels = {
  events: (scanId: string) => `whc:scan:${scanId}:events`,
  eventsPattern: 'whc:scan:*:events',
  latest: (scanId: string) => `whc:scan:${scanId}:latest`,
  cancel: 'whc:scan-cancel',
};

export const ISSUE_CATEGORIES = [
  'ACCESSIBILITY',
  'UI_HEALTH',
  'RESPONSIVE',
  'PERFORMANCE',
  'SEO',
  'SECURITY',
] as const;
export type IssueCategoryName = (typeof ISSUE_CATEGORIES)[number];

export const ACTIVE_SCAN_STATUSES = ['QUEUED', 'RUNNING', 'CANCELLING'] as const;
export const FINISHED_SCAN_STATUSES = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;

export const startScanSchema = z.object({
  websiteId: idSchema,
  mode: z.enum(['CRAWL', 'SINGLE_PAGE']).default('CRAWL'),
});
export type StartScanInput = z.infer<typeof startScanSchema>;

export const scanListQuerySchema = listQuerySchema.extend({
  websiteId: idSchema.optional(),
  projectId: idSchema.optional(),
  status: z
    .enum(['QUEUED', 'RUNNING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'PARTIAL', 'FAILED'])
    .optional(),
  /** Scans created on or after / before these dates. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const issueListQuerySchema = listQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
  category: z.enum(ISSUE_CATEGORIES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  viewport: z.string().max(20).optional(),
  pageId: idSchema.optional(),
  /** UI check type (e.g. BROKEN_LINK) or axe rule id. */
  checkType: z.string().max(40).optional(),
  ruleId: z.string().max(80).optional(),
  detection: z.enum(['AUTOMATED', 'NEEDS_REVIEW']).optional(),
  trackedStatus: z.enum(['OPEN', 'RESOLVED', 'IGNORED', 'FALSE_POSITIVE']).optional(),
});

export const updateTrackedIssueSchema = z.object({
  status: z.enum(['OPEN', 'IGNORED', 'FALSE_POSITIVE']),
});

/** Live progress message (Redis pub/sub → API → browser via Server-Sent Events). */
export interface ScanProgressEvent {
  type: 'progress';
  scanId: string;
  status: string;
  progress: number;
  step: string;
  currentUrl: string | null;
  pagesDiscovered: number;
  pagesScanned: number;
  pagesFailed: number;
  issuesFound: number;
  at: string;
}

export interface ScanFinishedEvent {
  type: 'finished';
  scanId: string;
  status: string;
  at: string;
}

export type ScanEvent = ScanProgressEvent | ScanFinishedEvent;

export type SeverityCounts = Record<SeverityName, number>;

export interface ScanDetailsDto {
  id: string;
  status: string;
  trigger: string;
  mode: string;
  progress: number;
  currentStep: string | null;
  pagesDiscovered: number;
  pagesScanned: number;
  pagesFailed: number;
  errorMessage: string | null;
  accessibilityScore: number | null;
  uiHealthScore: number | null;
  totalIssues: number;
  severityCounts: SeverityCounts;
  categoryCounts: Partial<Record<IssueCategoryName, number>>;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  previousScanId: string | null;
  myRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  website: { id: string; name: string; baseUrl: string; projectId: string; projectName: string };
  triggeredBy: { id: string; name: string } | null;
}

export interface ScanListItemDto {
  id: string;
  status: string;
  trigger: string;
  mode: string;
  progress: number;
  totalIssues: number;
  criticalCount: number;
  highCount: number;
  accessibilityScore: number | null;
  uiHealthScore: number | null;
  pagesScanned: number;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  website: { id: string; name: string; baseUrl: string };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScanPageDto {
  id: string;
  url: string;
  depth: number;
  status: string;
  httpStatus: number | null;
  title: string | null;
  loadTimeMs: number | null;
  errorMessage: string | null;
  consoleErrorCount: number;
  failedRequestCount: number;
  issueCount: number;
  screenshots: {
    id: string;
    kind: string;
    viewport: string | null;
    width: number;
    height: number;
  }[];
}

export interface IssueDto {
  id: string;
  category: IssueCategoryName;
  severity: SeverityName;
  ruleId: string;
  title: string;
  description: string;
  pageId: string | null;
  pageUrl: string | null;
  viewport: string | null;
  selector: string | null;
  htmlSnippet: string | null;
  boundingBox: BoundingBox | null;
  suggestedFix: string | null;
  details: Record<string, unknown> | null;
  fingerprint: string;
  screenshotId: string | null;
  pageScreenshotId: string | null;
  createdAt: string;
  tracked: {
    id: string;
    status: 'OPEN' | 'RESOLVED' | 'IGNORED' | 'FALSE_POSITIVE';
    occurrenceCount: number;
    firstSeenAt: string;
  } | null;
  accessibility: {
    axeRuleId: string;
    impact: string | null;
    wcagCriteria: string[];
    wcagLevel: string | null;
    helpUrl: string | null;
    detection: 'AUTOMATED' | 'NEEDS_REVIEW';
  } | null;
  uiHealth: { checkType: string; resourceUrl: string | null; statusCode: number | null } | null;
}

export interface IssueRefDto {
  fingerprint: string;
  title: string;
  severity: SeverityName;
  category: IssueCategoryName;
  ruleId: string;
  pageUrl: string | null;
  viewport: string | null;
}

export interface ScanComparisonDto {
  scanId: string;
  comparedWithScanId: string | null;
  newIssues: IssueRefDto[];
  resolvedIssues: IssueRefDto[];
  recurringIssues: IssueRefDto[];
  counts: { new: number; resolved: number; recurring: number };
}
