import { defineConfig } from 'tsup';

// Bundles the API into one file: dist/server.js.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Our workspace packages (@whc/db, @whc/shared) are TypeScript source, so they are
  // compiled INTO the bundle...
  noExternal: [/^@whc\//],
  // ...while npm packages they use stay as normal imports, loaded from node_modules.
  external: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'zod'],
});
