import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Lets us write `import { Button } from '@/components/ui/button'` from anywhere.
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    // In development the browser calls http://localhost:5173/api/...; Vite forwards it
    // to the API. Same origin for the browser = no CORS problems, cookies just work.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
