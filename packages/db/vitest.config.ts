import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Applies migrations to the test database once before any test file runs.
    globalSetup: ['./test/global-setup.ts'],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
