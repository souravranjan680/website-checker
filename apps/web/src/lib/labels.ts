/** Human-readable names for enum values shown in several places. */
export const TRACKED_LABEL: Record<string, string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  IGNORED: 'Ignored',
  FALSE_POSITIVE: 'False positive',
};

export const CATEGORY_LABEL: Record<string, string> = {
  ACCESSIBILITY: 'Accessibility',
  UI_HEALTH: 'UI health',
  RESPONSIVE: 'Responsive',
  PERFORMANCE: 'Performance',
  SEO: 'SEO',
  SECURITY: 'Security',
};

export const BUG_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  CLOSED: 'Closed',
};
