import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps live/backend code out of preview and preview fixtures out of all production entry graphs', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const bundle = async (entries: string[]) => {
    const result = await build({
      absWorkingDir: root, entryPoints: entries, bundle: true, write: false, outdir: 'artifacts/preview-graph',
      packages: 'external', platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent',
      loader: { '.css': 'empty' },
    });
    return Object.keys(result.metafile!.inputs).map(input => input.replaceAll('\\', '/'));
  };
  const preview = await bundle(['src/webview-v2/dev/preview/main.tsx']);
  expect(preview.some(input => input.includes('chat/ChatApp.tsx'))).toBe(true);
  expect(preview.some(input => input.includes('management/ManagementApp.tsx'))).toBe(true);
  expect(preview.some(input => input.includes('review/ReviewApp.tsx'))).toBe(true);
  expect(preview.filter(input => /src\/(?:runtime|extension)\/|dev\/browserRuntime/.test(input))).toEqual([]);
  const production = await bundle(['chat', 'models', 'management', 'mission', 'viewer', 'review']
    .map(page => `src/webview-v2/${page}/main.tsx`));
  expect(production.filter(input => input.includes('src/webview-v2/dev/'))).toEqual([]);
});
