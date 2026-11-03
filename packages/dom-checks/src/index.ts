// Node.js code (the scanner) and the Chrome extension import from here: the shared
// axe configuration, the issue presentation and the types. The in-page checks
// themselves run inside web pages: the scanner injects the browser bundle
// ("@whc/dom-checks/bundle"); the extension bundles "@whc/dom-checks/checks".
export type * from './types';
export * from './axe-config';
export * from './presentation';
// The safe explorer's pure decisions (eligibility, geometry) and result types, for
// the scanner and for unit tests. Its in-page functions ship in the browser bundle.
export { clippedPixels, eligibility, emptyBand, STATE_CHANGING_WORDS } from './explore-rules';
export type {
  BrokenAnchor,
  ControlFacts,
  ControlInventory,
  ControlKind,
  Eligibility,
  ExploreControl,
  InteractionChange,
  Layer,
  LayerReport,
  NavMismatch,
  SkipReason,
  SkippedControl,
} from './explore-rules';
// Milestone 2 (Phase 9): pure rules and result types of the layout, font, icon and
// consistency checks, and the side-effect watch's report type.
export {
  consistencyOutliers,
  contentText,
  crossPageDeviations,
  formatStyleValue,
  isPrivateUse,
  parseUnicodeRange,
  primaryFamily,
  propertyLabel,
  rangeCoversText,
  styleDistance,
  summarizeComponents,
  usualValue,
} from './extra-rules';
export type {
  ComponentContext,
  ComponentDeviation,
  ComponentKind,
  ComponentMember,
  ComponentStyle,
  ComponentSummaryEntry,
  ConsistencyOutlier,
  CrossPageDeviation,
  ExternalUseFact,
  ExtraCheckOptions,
  ExtraFinding,
  ExtraResult,
  FallbackFact,
  FindingStrength,
  FontFaceFact,
  GlyphIconFact,
  SideEffectBucket,
  SideEffectReport,
  StyleProperty,
} from './extra-rules';
