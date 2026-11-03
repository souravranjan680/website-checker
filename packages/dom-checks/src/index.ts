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
