import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Brings the test database (DATABASE_URL_TEST) up to date before any test runs.
    globalSetup: ['./test/global-setup.ts'],
    // Test files share one database, so run them one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
