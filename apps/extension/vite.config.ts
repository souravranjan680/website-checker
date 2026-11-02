import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the popup only (popup.html + assets). scripts/build.mjs adds the in-page
// runner, the manifest and the icons.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths: the popup is loaded from chrome-extension://<id>/popup.html.
  base: '',
  build: {
    outDir: process.env.EXTENSION_OUT_DIR ?? 'dist',
    emptyOutDir: true,
    // No inline scripts: extension pages only allow scripts from the extension itself.
    modulePreload: false,
    rollupOptions: { input: 'popup.html' },
  },
});
