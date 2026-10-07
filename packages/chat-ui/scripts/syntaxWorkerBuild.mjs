import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/syntax/syntaxWorker.ts', import.meta.url));
export function createSyntaxWorkerBuild() {
  let result;
  const bundle = () => result ??= build({
    entryPoints: [source], bundle: true, write: false, minify: true,
    platform: 'neutral', mainFields: ['module', 'main'], conditions: ['worker'],
    format: 'iife', target: 'es2022', metafile: true,
    legalComments: 'eof', logLevel: 'silent',
  });
  const workerSource = async () => (await bundle()).outputFiles[0].text;
  const webviewAsset = async () => `window.__dvxSyntaxWorkerSource = ${JSON.stringify(await workerSource())};`;
  return {
    workerSource, webviewAsset,
    async addNotices(notices) { await notices.add((await bundle()).metafile); },
    vite: { name: 'lazy-syntax-worker', configureServer(server) {
      server.middlewares.use('/syntax.js', (_request, response, next) => {
        void webviewAsset().then(body => {
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          response.end(body);
        }, next);
      });
    }, handleHotUpdate(context) {
      if (context.file.replaceAll('\\', '/').includes('/packages/chat-ui/src/syntax/')) result = undefined;
    } },
  };
}
