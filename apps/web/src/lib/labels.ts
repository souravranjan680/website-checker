/** Human-readable names for enum values shown in several places. */
export const TRACKED_LABEL: Record<string, string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  IGNORED: 'Ignored',
  FALSE_POSITIVE: 'False positive',
};

/** What each automated classification means, in plain words (Phase 9). */
export const CLASSIFICATION_HELP: Record<string, string> = {
  DETECTED:
    'A rule failed with objective evidence (for example an accessibility rule or a confirmed broken link).',
  POTENTIAL_DEFECT:
    'The evidence suggests something may be broken. It becomes a defect only when someone on your team confirms it.',
  OBSERVATION: 'Worth a look, but there is no sign that anything is broken.',
  INCONCLUSIVE: 'The tool could not verify this automatically. A person needs to check it.',
};

export const REVIEW_LABEL: Record<string, string> = {
  UNREVIEWED: 'Not reviewed',
  CONFIRMED: 'Confirmed defect',
  INTENTIONAL: 'Intentional',
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
