// Node.js code (the scanner) and the Chrome extension import from here: the shared
// axe configuration, the issue presentation and the types. The in-page checks
// themselves run inside web pages: the scanner injects the browser bundle
// ("@whc/dom-checks/bundle"); the extension bundles "@whc/dom-checks/checks".
export type * from './types';
export * from './axe-config';
export * from './presentation';
