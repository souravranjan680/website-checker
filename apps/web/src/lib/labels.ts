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
  FUNCTIONAL: 'Interactions',
};

/** Interaction and navigation checks of the safe explorer (Phase 9). */
export const FUNCTIONAL_CHECK_LABEL: Record<string, string> = {
  CONTROL_NO_EFFECT: 'Control does nothing',
  LAYER_CLIPPED: 'Opened menu cut off',
  LAYER_OCCLUDED: 'Menu items covered',
  LAYER_BLANK_AREA: 'Large empty area',
  LAYER_NOT_DISMISSIBLE: 'Menu cannot be closed',
  ESCAPE_NOT_SUPPORTED: 'Escape does not close',
  TAB_PANEL_NOT_SHOWN: 'Tab panel not shown',
  INTERACTION_ERROR: 'Error while interacting',
  BROKEN_ANCHOR: 'Link to missing section',
  NAV_CURRENT_MISMATCH: 'Wrong current page in navigation',
  FOCUS_NOT_VISIBLE: 'Focus not visible',
  FOCUS_ON_HIDDEN: 'Focus on hidden element',
  FOCUS_LOST: 'Focus lost',
  KEYBOARD_TRAP: 'Keyboard trap',
  KEY_ACTIVATION_FAILED: 'Not usable with keyboard',
  CLICK_NOT_FOCUSABLE: 'Clickable but not focusable',
  FORM_REQUIRED_NOT_INDICATED: 'Required field not marked',
  FORM_INDICATOR_WITHOUT_REQUIRED: 'Marked required, not required',
  FORM_DESCRIBEDBY_MISSING: 'Description id missing',
  FORM_PLACEHOLDER_ONLY_LABEL: 'Placeholder as only label',
  FORM_ERROR_NOT_ASSOCIATED: 'Error not linked to field',
  FORM_NO_BLUR_FEEDBACK: 'No feedback on leaving field',
};

export const BUG_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  CLOSED: 'Closed',
};
