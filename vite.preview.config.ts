import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createMarkdownWorkerBuild } from './packages/chat-ui/scripts/markdownWorkerBuild.mjs';
import { createSyntaxWorkerBuild } from './packages/chat-ui/scripts/syntaxWorkerBuild.mjs';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const version = createRequire(import.meta.url)('./package.json').version as string;
const syntax = createSyntaxWorkerBuild();

export default defineConfig({
  root: local('./src/webview-v2/dev/preview'),
  base: './',
  cacheDir: local('./artifacts/vite-preview-cache'),
  resolve: { alias: [
    { find: /^@droidvisx\/chat-ui$/, replacement: local('./packages/chat-ui/src/index.ts') },
    { find: /^@droidvisx\/chat-ui\/(.*)$/, replacement: `${local('./packages/chat-ui/src')}/$1` },
  ] },
  plugins: [
    tailwindcss(), createMarkdownWorkerBuild().vite, syntax.vite,
    {
      name: 'offline-preview-boundary',
      generateBundle() {
        for (const id of this.getModuleIds()) {
          const normalized = id.replaceAll('\\', '/');
          if (/\/src\/(?:runtime|extension)\//.test(normalized) || normalized.includes('/dev/browserRuntime'))
            this.error(`Offline preview imported a backend transport: ${id}`);
        }
      },
    },
    {
      name: 'preview-syntax-asset',
      async generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'syntax.js', source: await syntax.webviewAsset() });
      },
    },
  ],
  define: { __DVX_BUILD_ID__: JSON.stringify('offline-ui-preview'), __DVX_VERSION__: JSON.stringify(version) },
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
  preview: { host: '127.0.0.1', port: 4178, strictPort: true },
  build: { outDir: local('./dist/ui-preview'), emptyOutDir: true },
  esbuild: { jsx: 'automatic' },
});
