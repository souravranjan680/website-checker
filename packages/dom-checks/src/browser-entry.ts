// Entry for the browser bundle (dist/dom-checks.js): exposes the checks on window,
// so the scanner can call  window.__whcDomChecks.run({...})  inside the page, and the
// safe explorer (Phase 9) can call  window.__whcDomChecks.explore.*.
import { runDomChecks } from './checks';
import * as explore from './explore';

(window as unknown as { __whcDomChecks: unknown }).__whcDomChecks = {
  run: runDomChecks,
  explore,
};
