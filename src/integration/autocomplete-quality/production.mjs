import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function loadProductionPostprocess() {
  const directory = fileURLToPath(new URL('../../extension/autocomplete/', import.meta.url));
  const output = path.join(mkdtempSync(path.join(tmpdir(), 'droid-eval-production-')), 'postprocess.mjs');
  await build({ stdin: { contents: "export { prepareCompletionWithOutcome } from './completionText';",
    resolveDir: directory }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
  return { prepare: (await import(pathToFileURL(output).href)).prepareCompletionWithOutcome,
    sha256: createHash('sha256').update(readFileSync(output)).digest('hex') };
}
