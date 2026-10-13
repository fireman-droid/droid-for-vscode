import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const runner = fileURLToPath(new URL('./runCase.cjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

export function readCorpus(file) {
  const content = readFileSync(file, 'utf8');
  const corpus = JSON.parse(content);
  if (corpus.version !== 1 || !Array.isArray(corpus.cases) || corpus.cases.length === 0) throw new Error('Invalid evaluation corpus');
  const ids = new Set();
  for (const item of corpus.cases) {
    if (!/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate case ID');
    ids.add(item.id);
    if (item.language !== 'typescript' || typeof item.prefix !== 'string' || typeof item.suffix !== 'string'
      || !Array.isArray(item.references) || !Array.isArray(item.tests) || item.tests.length < 3
      || item.tests.some(test => typeof test.name !== 'string' || typeof test.body !== 'string' || !test.body.trim())) {
      throw new Error(`Incomplete TypeScript case: ${item.id}`);
    }
  }
  return { ...corpus, sha256: digest(content) };
}

function sourcePath(root, relative) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+\.ts$/.test(relative)
    || relative.split('/').some(part => part === '..' || !part)) throw new Error('Invalid fixture source path');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Fixture source escaped its case directory');
  return resolved;
}

function compileCase(item, code, root) {
  const inputs = [{ path: item.entryFile, content: code }, ...item.references];
  const files = new Set();
  for (const input of inputs) {
    const target = sourcePath(root, input.path);
    if (files.has(target)) throw new Error('Duplicate fixture source path');
    files.add(target);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, input.content);
  }
  const program = ts.createProgram([...files], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, strict: true,
    skipLibCheck: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    noEmitOnError: true, rootDir: root, outDir: path.join(root, 'compiled'),
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) return { compiled: false, diagnostics: diagnostics.map(issue => ({
    code: issue.code, message: ts.flattenDiagnosticMessageText(issue.messageText, '\n'),
    file: issue.file ? path.relative(root, issue.file.fileName) : undefined,
    line: issue.file && issue.start !== undefined ? issue.file.getLineAndCharacterOfPosition(issue.start).line + 1 : undefined,
  })) };
  const emitted = program.emit();
  if (emitted.emitSkipped) throw new Error('TypeScript refused to emit the evaluation program');
  return { compiled: true, diagnostics: [] };
}

async function executeCase(file, timeoutMs = 15_000) {
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Quality execution requires Node 26+ network permissions');
  const root = path.dirname(file);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${runner}`,
      '--max-old-space-size=128', runner, file], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
    });
    let stdout = '', stderr = '', timedOut = false, tooMuchOutput = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1_000_000) { tooMuchOutput = true; child.kill(); }
    });
    child.stderr.on('data', chunk => { if (stderr.length < 8000) stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', exitCode => {
      clearTimeout(timer);
      const tests = stdout.split(/\r?\n/).filter(line => line.startsWith('DROID_QUALITY_RESULT '))
        .map(line => JSON.parse(line.slice('DROID_QUALITY_RESULT '.length)));
      resolve({ tests, exitCode, timedOut, tooMuchOutput, stderr });
    });
  });
}

export async function evaluateCase(item, insertion, directory) {
  const root = path.resolve(directory, item.id);
  mkdirSync(root, { recursive: true });
  const code = item.prefix + insertion + item.suffix;
  const result = { id: item.id, category: item.category, sourceSha256: digest(code), ...compileCase(item, code, root) };
  if (!result.compiled) return { ...result, passed: false, tests: [], expectedTests: item.tests.length };
  const entry = path.join('compiled', item.entryFile.replace(/\.ts$/, '.js'));
  const input = path.join(root, 'execution.json');
  writeFileSync(input, JSON.stringify({ entry, tests: item.tests }));
  writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
  const execution = await executeCase(input);
  return { ...result, ...execution, expectedTests: item.tests.length, passed: execution.exitCode === 0
    && !execution.timedOut && !execution.tooMuchOutput && execution.tests.length === item.tests.length
    && execution.tests.every(test => test.passed) };
}
