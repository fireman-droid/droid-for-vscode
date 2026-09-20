import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/markdown/markdownWorker.ts', import.meta.url));
const sourcePattern = /[\\/]markdownWorkerSource\.ts$/;

export function createMarkdownWorkerBuild() {
  let result;
  const bundle = () => result ??= build({
    entryPoints: [source], bundle: true, write: false, minify: true,
    // The browser export of the entity decoder uses document.createElement;
    // workers need the DOM-free default implementation of these universal libs.
    platform: 'neutral', mainFields: ['module', 'main'], conditions: ['worker'],
    format: 'iife', target: 'es2022', metafile: true,
    legalComments: 'eof', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const contents = async () => `export const markdownWorkerSource = ${JSON.stringify((await bundle()).outputFiles[0].text)};`;
  return {
    esbuild: { name: 'self-contained-markdown-worker', setup(builder) {
      builder.onLoad({ filter: sourcePattern }, async () => ({ contents: await contents(), loader: 'ts', resolveDir: path.dirname(source) }));
    } },
    vite: { name: 'self-contained-markdown-worker', enforce: 'pre', async load(id) {
      if (sourcePattern.test(id)) {
        for (const input of Object.keys((await bundle()).metafile.inputs)) this.addWatchFile(path.resolve(input));
        return contents();
      }
    }, handleHotUpdate(context) {
      if (context.file.includes('/packages/chat-ui/src/markdown/')) result = undefined;
    } },
    async addNotices(notices) { if (result) await notices.add((await result).metafile); },
  };
}
