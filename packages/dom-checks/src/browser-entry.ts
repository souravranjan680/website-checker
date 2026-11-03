// Entry for the browser bundle (dist/dom-checks.js): exposes the checks on window,
// so the scanner can call  window.__whcDomChecks.run({...})  inside the page, the
// safe explorer (Phase 9) can call  window.__whcDomChecks.explore.*, and the
// Milestone 2 checks, side-effect watch and probes are  .extra(...),  .sideEffects.*
// and  .probes.*.
import { runDomChecks } from './checks';
import * as explore from './explore';
import { runExtraChecks } from './extra';
import * as probes from './probes';
import * as sideEffects from './side-effects';

(window as unknown as { __whcDomChecks: unknown }).__whcDomChecks = {
  run: runDomChecks,
  explore,
  extra: runExtraChecks,
  sideEffects,
  probes,
};
