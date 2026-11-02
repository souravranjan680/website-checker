import { z } from 'zod';
import type { SeverityName } from './constants';
import type { IssueCategoryName } from './scans';
import { idSchema, listQuerySchema } from './schemas/common';

// ------------------------------------------------------------------ dashboard

/** ?projectId=&websiteId=&from=&to=&status= : the dashboard filter bar. */
export const dashboardQuerySchema = z.object({
  projectId: idSchema.optional(),
  websiteId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z
    .enum(['QUEUED', 'RUNNING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'PARTIAL', 'FAILED'])
    .optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface DashboardSummaryDto {
  range: { from: string; to: string };
  totals: {
    projects: number;
    websites: number;
    scans: number; // scans created in the date range
    openIssues: number; // currently open tracked issues
    criticalIssues: number;
    highIssues: number;
    resolvedIssues: number; // resolved in the date range
  };
  scores: {
    accessibility: number | null; // average of each website's latest finished scan
    uiHealth: number | null;
    performance: number | null; // null until Lighthouse exists (Phase 6)
    websitesMeasured: number;
  };
  openBySeverity: { severity: SeverityName; count: number }[];
  openByCategory: { category: IssueCategoryName; count: number }[];
  recentScans: {
    id: string;
    status: string;
    createdAt: string;
    durationMs: number | null;
    totalIssues: number;
    accessibilityScore: number | null;
    website: { id: string; name: string };
  }[];
  recentWebsites: {
    id: string;
    name: string;
    baseUrl: string;
    projectName: string;
    openIssues: number;
    lastScan: {
      id: string;
      status: string;
      createdAt: string;
      accessibilityScore: number | null;
    } | null;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    metadata: Record<string, unknown> | null;
    user: { id: string; name: string } | null;
    createdAt: string;
  }[];
}

export interface DashboardTrendPoint {
  date: string; // YYYY-MM-DD (UTC)
  completed: number;
  partial: number;
  failed: number;
  cancelled: number;
  other: number; // queued / running
  accessibilityScore: number | null; // average of scans finished that day
  uiHealthScore: number | null;
  newIssues: number;
  resolvedIssues: number;
}

export interface DashboardTrendsDto {
  range: { from: string; to: string };
  points: DashboardTrendPoint[];
}

// -------------------------------------------------------------------- reports

export interface ReportScanInfo {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  pagesScanned: number;
  previousScanId: string | null;
  accessibilityScore: number | null;
  uiHealthScore: number | null;
  myRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  website: { id: string; name: string; baseUrl: string };
  project: { id: string; name: string };
}

export interface ManualCheckState {
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | null;
  note?: string;
  by?: string;
  at?: string;
}

export interface AccessibilityReportDto {
  scan: ReportScanInfo;
  totals: {
    violations: number;
    needsReview: number;
    rules: number;
    pagesAffected: number;
    pagesScanned: number;
  };
  severity: { severity: SeverityName; count: number }[];
  criteria: {
    criterion: string;
    name: string | null;
    level: string | null;
    issues: number;
    pages: number;
  }[];
  rules: {
    ruleId: string;
    title: string;
    severity: SeverityName;
    issues: number;
    pages: number;
    wcag: string[];
    helpUrl: string | null;
  }[];
  pages: { url: string; issues: number; critical: number }[];
  checklist: Record<string, ManualCheckState>;
}

export interface UiHealthReportDto {
  scan: ReportScanInfo;
  checks: { checkType: string; count: number; highestSeverity: SeverityName }[];
  consoleErrors: { pageUrl: string; text: string }[];
  failedRequests: {
    pageUrl: string;
    url: string;
    resourceType: string;
    status: number | null;
    error: string | null;
  }[];
  pages: {
    url: string;
    status: string;
    consoleErrors: number;
    failedRequests: number;
    issues: number;
  }[];
}

export interface ResponsiveViewportDto {
  label: string;
  name: string;
  width: number;
  height: number;
  issues: number;
  bySeverity: Partial<Record<SeverityName, number>>;
  /** Compared with the previous finished scan (null when there is none). */
  comparison: { newIssues: number; resolvedIssues: number } | null;
  pages: {
    pageId: string;
    url: string;
    screenshotId: string | null;
    previousScreenshotId: string | null;
    issues: number;
  }[];
}

export interface ResponsiveReportDto {
  scan: ReportScanInfo;
  previousScan: { id: string; createdAt: string } | null;
  viewports: ResponsiveViewportDto[];
}

/** Performance / SEO / security: honest about what has been measured. */
export interface PendingReportDto {
  scan: ReportScanInfo;
  available: boolean;
  plannedPhase: number;
  message: string;
  /** Whatever real data exists (empty until the scanner produces it). */
  results: unknown[];
}

export const exportQuerySchema = z.object({
  format: z.enum(['pdf', 'csv', 'json']),
  category: z.enum(['ACCESSIBILITY', 'UI_HEALTH', 'RESPONSIVE']).optional(),
});

export const manualChecklistUpdateSchema = z.object({
  itemId: z.string().min(1).max(60),
  status: z.enum(['PASS', 'FAIL', 'NOT_APPLICABLE']).nullable(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Accessibility checks a PERSON must do: automated tools cannot judge these.
 * The state of each item is saved per scan (Scan.manualChecklist).
 */
export const MANUAL_CHECKLIST: { id: string; title: string; how: string; wcag: string }[] = [
  {
    id: 'keyboard',
    title: 'Everything works with the keyboard alone',
    how: 'Use Tab, Shift+Tab, Enter, Space and arrow keys; every control must be reachable and usable without a mouse, with no keyboard traps.',
    wcag: '2.1.1, 2.1.2',
  },
  {
    id: 'focus-visible',
    title: 'Keyboard focus is always visible and in a logical order',
    how: 'Tab through the page and check the focus indicator is clearly visible and moves in reading order.',
    wcag: '2.4.3, 2.4.7, 2.4.11',
  },
  {
    id: 'skip-link',
    title: 'A way to skip repeated content',
    how: 'Check for a "Skip to content" link or proper landmarks to jump past navigation.',
    wcag: '2.4.1',
  },
  {
    id: 'alt-quality',
    title: 'Alternative text is meaningful',
    how: "Read each image's alt text: does it convey the same information? Decorative images should have empty alt.",
    wcag: '1.1.1',
  },
  {
    id: 'screen-reader',
    title: 'Screen reader announces content correctly',
    how: 'Use NVDA (Windows) or VoiceOver (macOS): headings, landmarks, form labels, buttons and live updates should make sense.',
    wcag: '1.3.1, 4.1.2, 4.1.3',
  },
  {
    id: 'headings-labels',
    title: 'Headings and labels describe their content',
    how: 'Read headings and labels out of context; each should say what follows or what to enter.',
    wcag: '2.4.6',
  },
  {
    id: 'link-purpose',
    title: 'Link text makes sense',
    how: 'Avoid vague links like "click here"; the purpose should be clear from the text (or its context).',
    wcag: '2.4.4',
  },
  {
    id: 'color-only',
    title: 'Colour is not the only way information is shown',
    how: 'Check errors, statuses and charts also use text, icons or patterns.',
    wcag: '1.4.1',
  },
  {
    id: 'reflow-zoom',
    title: 'Usable at 200% zoom and 320px width',
    how: 'Zoom the browser to 200% and to 400%; content must reflow without loss or two-direction scrolling.',
    wcag: '1.4.4, 1.4.10',
  },
  {
    id: 'forms-errors',
    title: 'Form errors are identified and explained',
    how: 'Submit forms with mistakes: errors must be described in text, linked to the field and announced.',
    wcag: '3.3.1, 3.3.3',
  },
  {
    id: 'media',
    title: 'Video and audio have captions or transcripts',
    how: 'Check all media has captions, transcripts or audio description where needed.',
    wcag: '1.2.1–1.2.5',
  },
  {
    id: 'motion-timing',
    title: 'Moving content and time limits can be controlled',
    how: 'Carousels and animations can be paused; time limits can be extended; nothing flashes more than 3 times per second.',
    wcag: '2.2.1, 2.2.2, 2.3.1',
  },
];

/** WCAG 2.2 level A and AA success criteria (number → name). */
export const WCAG_CRITERIA: Record<string, { name: string; level: 'A' | 'AA' }> = {
  '1.1.1': { name: 'Non-text Content', level: 'A' },
  '1.2.1': { name: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  '1.2.2': { name: 'Captions (Prerecorded)', level: 'A' },
  '1.2.3': { name: 'Audio Description or Media Alternative', level: 'A' },
  '1.2.4': { name: 'Captions (Live)', level: 'AA' },
  '1.2.5': { name: 'Audio Description (Prerecorded)', level: 'AA' },
  '1.3.1': { name: 'Info and Relationships', level: 'A' },
  '1.3.2': { name: 'Meaningful Sequence', level: 'A' },
  '1.3.3': { name: 'Sensory Characteristics', level: 'A' },
  '1.3.4': { name: 'Orientation', level: 'AA' },
  '1.3.5': { name: 'Identify Input Purpose', level: 'AA' },
  '1.4.1': { name: 'Use of Color', level: 'A' },
  '1.4.2': { name: 'Audio Control', level: 'A' },
  '1.4.3': { name: 'Contrast (Minimum)', level: 'AA' },
  '1.4.4': { name: 'Resize Text', level: 'AA' },
  '1.4.5': { name: 'Images of Text', level: 'AA' },
  '1.4.10': { name: 'Reflow', level: 'AA' },
  '1.4.11': { name: 'Non-text Contrast', level: 'AA' },
  '1.4.12': { name: 'Text Spacing', level: 'AA' },
  '1.4.13': { name: 'Content on Hover or Focus', level: 'AA' },
  '2.1.1': { name: 'Keyboard', level: 'A' },
  '2.1.2': { name: 'No Keyboard Trap', level: 'A' },
  '2.1.4': { name: 'Character Key Shortcuts', level: 'A' },
  '2.2.1': { name: 'Timing Adjustable', level: 'A' },
  '2.2.2': { name: 'Pause, Stop, Hide', level: 'A' },
  '2.3.1': { name: 'Three Flashes or Below Threshold', level: 'A' },
  '2.4.1': { name: 'Bypass Blocks', level: 'A' },
  '2.4.2': { name: 'Page Titled', level: 'A' },
  '2.4.3': { name: 'Focus Order', level: 'A' },
  '2.4.4': { name: 'Link Purpose (In Context)', level: 'A' },
  '2.4.5': { name: 'Multiple Ways', level: 'AA' },
  '2.4.6': { name: 'Headings and Labels', level: 'AA' },
  '2.4.7': { name: 'Focus Visible', level: 'AA' },
  '2.4.11': { name: 'Focus Not Obscured (Minimum)', level: 'AA' },
  '2.5.1': { name: 'Pointer Gestures', level: 'A' },
  '2.5.2': { name: 'Pointer Cancellation', level: 'A' },
  '2.5.3': { name: 'Label in Name', level: 'A' },
  '2.5.4': { name: 'Motion Actuation', level: 'A' },
  '2.5.7': { name: 'Dragging Movements', level: 'AA' },
  '2.5.8': { name: 'Target Size (Minimum)', level: 'AA' },
  '3.1.1': { name: 'Language of Page', level: 'A' },
  '3.1.2': { name: 'Language of Parts', level: 'AA' },
  '3.2.1': { name: 'On Focus', level: 'A' },
  '3.2.2': { name: 'On Input', level: 'A' },
  '3.2.3': { name: 'Consistent Navigation', level: 'AA' },
  '3.2.4': { name: 'Consistent Identification', level: 'AA' },
  '3.2.6': { name: 'Consistent Help', level: 'A' },
  '3.3.1': { name: 'Error Identification', level: 'A' },
  '3.3.2': { name: 'Labels or Instructions', level: 'A' },
  '3.3.3': { name: 'Error Suggestion', level: 'AA' },
  '3.3.4': { name: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  '3.3.7': { name: 'Redundant Entry', level: 'A' },
  '3.3.8': { name: 'Accessible Authentication (Minimum)', level: 'AA' },
  '4.1.2': { name: 'Name, Role, Value', level: 'A' },
  '4.1.3': { name: 'Status Messages', level: 'AA' },
};

// ---------------------------------------------------------- issue management

export interface IssueHistoryDto {
  issue: import('./scans').IssueDto;
  scan: { id: string; createdAt: string; status: string };
  website: { id: string; name: string; baseUrl: string };
  project: { id: string; name: string };
  myRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  tracking: {
    id: string;
    status: 'OPEN' | 'RESOLVED' | 'IGNORED' | 'FALSE_POSITIVE';
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    firstSeenScanId: string | null;
    lastSeenScanId: string | null;
    resolvedInScanId: string | null;
  } | null;
  /** Newest first: every scan this problem appeared in, plus status changes. */
  timeline: {
    type: 'DETECTED' | 'STATUS_CHANGED' | 'RESOLVED';
    at: string;
    scanId?: string;
    scanStatus?: string;
    issueId?: string;
    severity?: string;
    from?: string;
    to?: string;
    user?: { id: string; name: string } | null;
  }[];
}

export interface TrackedIssueDto {
  id: string;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED' | 'FALSE_POSITIVE';
  category: IssueCategoryName;
  severity: SeverityName;
  ruleId: string;
  title: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  latest: {
    issueId: string;
    scanId: string;
    pageUrl: string | null;
    viewport: string | null;
    selector: string | null;
  } | null;
}

export const trackedIssueQuerySchema = listQuerySchema.extend({
  status: z.enum(['OPEN', 'RESOLVED', 'IGNORED', 'FALSE_POSITIVE']).optional(),
  category: z
    .enum(['ACCESSIBILITY', 'UI_HEALTH', 'RESPONSIVE', 'PERFORMANCE', 'SEO', 'SECURITY'])
    .optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
});

export interface WebsiteStatsDto {
  totalScans: number;
  latestScan: {
    id: string;
    status: string;
    createdAt: string;
    accessibilityScore: number | null;
    uiHealthScore: number | null;
    totalIssues: number;
  } | null;
  latestFinishedScanId: string | null;
  issues: { open: number; resolved: number; ignored: number; falsePositive: number };
}

// --------------------------------------------------------- settings / profile

export const notificationPreferencesSchema = z.object({
  scanCompleted: z.boolean(),
  scanFailed: z.boolean(),
  regressionDetected: z.boolean(),
  weeklySummary: z.boolean(),
  email: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  scanCompleted: true,
  scanFailed: true,
  regressionDetected: true,
  weeklySummary: false,
  email: false,
};

export interface SessionDto {
  id: string; // session family ID
  userAgent: string | null;
  ipAddress: string | null;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}
