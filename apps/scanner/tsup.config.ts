import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'tsup';

export default defineConfig({
  // browser-check: operator check of the other browsers (Phase 9, Milestone 3).
  entry: ['src/main.ts', 'src/browser-check.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@whc\//],
  external: [
    '@prisma/client',
    '@prisma/adapter-pg',
    'pg',
    'zod',
    'playwright',
    'axe-core',
    'bullmq',
    'ioredis',
    'pino',
    // Loads its audits and locale files dynamically, so it must not be bundled.
    'lighthouse',
  ],
  // The in-page checks run inside web pages, so they ship as a separate script file.
  onSuccess: async () => {
    copyFileSync(
      createRequire(import.meta.url).resolve('@whc/dom-checks/bundle'),
      'dist/dom-checks.js',
    );
  },
});
