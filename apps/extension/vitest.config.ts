import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // Unit tests that render the popup opt into jsdom with a file comment.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    // The end-to-end tests drive a real Chromium with the extension loaded.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
