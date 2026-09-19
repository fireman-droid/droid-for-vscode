import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/webview-v2/dev',
  plugins: [tailwindcss()],
  define: { __DVX_BUILD_ID__: JSON.stringify('v2-browser-dev') },
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
  esbuild: { jsx: 'automatic' },
});
