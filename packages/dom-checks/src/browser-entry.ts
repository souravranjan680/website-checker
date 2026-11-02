// Entry for the browser bundle (dist/dom-checks.js): exposes the checks on window,
// so the scanner can call  window.__whcDomChecks.run({...})  inside the page.
import { runDomChecks } from './checks';

(window as unknown as { __whcDomChecks: unknown }).__whcDomChecks = { run: runDomChecks };
