/**
 * Shapes of the data the API returns (DTO = "data transfer object").
 * Dates are ISO-8601 strings because JSON has no date type.
 * The web app imports these types, so a renamed field breaks the build, not production.
 */

export const USER_ROLES = ['ADMIN', 'USER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Per-project roles, highest first. Mirrors the Prisma `ProjectRole` enum. */
export const PROJECT_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface ProjectSummaryDto {
  id: string;
  name: string;
  description: string | null;
  /** Your effective role. Global admins act as OWNER everywhere. */
  myRole: ProjectRole;
  websiteCount: number;
  memberCount: number;
  scanCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStatsDto {
  websiteCount: number;
  memberCount: number;
  scanCount: number;
  completedScanCount: number;
  openIssueCount: number;
  lastScanAt: string | null;
}

export interface ProjectDetailsDto extends Omit<
  ProjectSummaryDto,
  'websiteCount' | 'memberCount' | 'scanCount'
> {
  stats: ProjectStatsDto;
}

export interface ProjectMemberDto {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  joinedAt: string;
}

export type ScanStatusName =
  'QUEUED' | 'RUNNING' | 'CANCELLING' | 'CANCELLED' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface ScanSummaryDto {
  id: string;
  status: ScanStatusName;
  trigger: string;
  mode: string;
  progress: number;
  totalIssues: number;
  criticalCount: number;
  accessibilityScore: number | null;
  performanceScore: number | null;
  uiHealthScore: number | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface WebsiteDto {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  baseUrl: string;
  hostname: string;
  maxDepth: number;
  maxPages: number;
  includePatterns: string[];
  excludePatterns: string[];
  respectRobotsTxt: boolean;
  responsivePageLimit: number;
  lighthousePageLimit: number;
  /** Safe explorer settings (Phase 9). */
  explorationEnabled: boolean;
  explorationPageLimit: number;
  explorationControlLimit: number;
  /** Component consistency check (Phase 9, Milestone 2). */
  consistencyEnabled: boolean;
  /** Keyboard and form probes (Phase 9, Milestone 2, Checkpoint 2). */
  keyboardProbeEnabled: boolean;
  formProbeMode: 'OFF' | 'STATIC' | 'BLUR' | 'SYNTHETIC';
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
  authorizationConfirmedAt: string;
  myRole: ProjectRole;
  scanCount: number;
  lastScan: ScanSummaryDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  user: { id: string; name: string } | null;
  createdAt: string;
}

export interface AdminUserDto extends UserDto {
  isActive: boolean;
  lastLoginAt: string | null;
  projectCount: number;
}

/** Standard error body: { error: { code, message, details?, requestId } } */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}
