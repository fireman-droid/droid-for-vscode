import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { createThirdPartyNotices } from './scripts/thirdPartyNotices.mjs';
import { createMarkdownWorkerBuild } from './scripts/markdownWorkerBuild.mjs';
import { createSyntaxWorkerBuild } from './scripts/syntaxWorkerBuild.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'src');
const out = path.join(root, 'dist');
const require = createRequire(import.meta.url);
const notices = createThirdPartyNotices(process.cwd(), path.join(root, 'THIRD_PARTY_LICENSES.txt'));
await notices.addPreprocessedPackage(path.dirname(require.resolve('tailwindcss/package.json')));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const dependencies = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }));
const markdownWorker = createMarkdownWorkerBuild();
const entries = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.(ts|tsx)$/.test(file)) {
      entries[path.relative(source, file).replaceAll('\\', '/').replace(/\.(ts|tsx)$/, '')] = file;
    }
  }
}
await collect(source);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const result = await build({
  entryPoints: entries, outdir: out, bundle: true, splitting: true,
  packages: 'external', format: 'esm', platform: 'browser', target: 'es2022',
  metafile: true, legalComments: 'eof', logLevel: 'info',
  plugins: [markdownWorker.esbuild],
});
await notices.add(result.metafile);
await markdownWorker.addNotices(notices);
for (const input of Object.keys(result.metafile.inputs)) {
  const relative = path.relative(source, path.resolve(input));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`UI package imported project source: ${input}`);
  }
}
for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) {
    if (!imported.external) continue;
    if (/^(?:node:|vscode$|@factory\/)/.test(imported.path))
      throw new Error(`UI package imported host dependency: ${imported.path}`);
    const name = imported.path.split('/').slice(0, imported.path.startsWith('@') ? 2 : 1).join('/');
    if (!dependencies.has(name)) throw new Error(`UI package dependency is not declared: ${name}`);
  }
}
const cli = path.join(path.dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
const compiled = execFileSync(process.execPath, [cli, '-i', path.join(source, 'theme.css'), '--minify'], { cwd: root, encoding: 'utf8' });
// Scope utility classes and reset rules as well as semantic tokens. Portals live
// inside UiRoot, so isolated dialogs retain the same theme as their trigger.
const css = postcss.parse(compiled);
css.walkRules((rule) => {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'rule') return;
    if (parent.type === 'atrule' && /keyframes$/.test(parent.name)) return;
  }
  rule.selectors = rule.selectors.map((selector) =>
    /^:(?:root|host)(?=$|[\[:])/.test(selector) ? selector.replace(/^:(?:root|host)/, '.agent-chat-ui')
      : ['html', 'body'].includes(selector) ? '.agent-chat-ui'
      : selector.includes('.agent-chat-ui') ? selector : `:where(.agent-chat-ui) ${selector}`);
});
const cssResult = await build({
  stdin: { contents: css.toString(), resolveDir: source, loader: 'css' },
  outfile: path.join(out, 'styles.css'), bundle: true, minify: true,
  metafile: true, legalComments: 'eof',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'assets/[name]-[hash]', logLevel: 'info',
  plugins: [{
    name: 'local-math-fonts',
    setup(cssBuild) {
      cssBuild.onResolve({ filter: /^fonts\/KaTeX_[\w-]+\.(?:woff2?|ttf)$/ }, (args) => ({
        path: path.join(path.dirname(require.resolve('katex/dist/katex.min.css')), args.path),
      }));
    },
  }],
});
await notices.add(cssResult.metafile);
const syntaxWorker = createSyntaxWorkerBuild();
await writeFile(path.join(out, 'syntax/syntaxWorker.js'), await syntaxWorker.workerSource());
await syntaxWorker.addNotices(notices);
await notices.write(path.join(out, 'THIRD_PARTY_LICENSES.txt'));
