import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    // Real browser scans take a while.
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
