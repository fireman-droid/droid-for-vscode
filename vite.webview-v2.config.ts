import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'node:module';
import { createMarkdownWorkerBuild } from './packages/chat-ui/scripts/markdownWorkerBuild.mjs';

const version = createRequire(import.meta.url)('./package.json').version as string;

export default defineConfig({
  root: 'src/webview-v2/dev',
  plugins: [tailwindcss(), createMarkdownWorkerBuild().vite],
  define: {
    __DVX_BUILD_ID__: JSON.stringify('v2-browser-dev'),
    __DVX_VERSION__: JSON.stringify(version),
  },
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
  esbuild: { jsx: 'automatic' },
});
