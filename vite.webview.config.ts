import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/webview/dev',
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
