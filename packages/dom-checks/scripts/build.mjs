// Bundles the in-page checks into ONE self-contained script (dist/dom-checks.js).
// The scanner injects this text into each page; the Chrome extension (Phase 7)
// will inject the same file. No module loader exists inside a web page, so all
// code must be in one plain script.
import { build } from 'esbuild';

await build({
  entryPoints: [
    new URL('../src/browser-entry.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  ],
  outfile: new URL('../dist/dom-checks.js', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('dom-checks bundle written to dist/dom-checks.js');
