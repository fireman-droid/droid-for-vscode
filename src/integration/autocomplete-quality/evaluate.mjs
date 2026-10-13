import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { evaluateGo } from './goEvaluate.mjs';

const runner = fileURLToPath(new URL('./runCase.cjs', import.meta.url));
const pythonRunner = fileURLToPath(new URL('./runCase.py', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

export function readCorpus(file) {
  const content = readFileSync(file, 'utf8');
  const corpus = JSON.parse(content);
  if (corpus.version !== 1 || !Array.isArray(corpus.cases) || corpus.cases.length === 0) throw new Error('Invalid evaluation corpus');
  const ids = new Set();
  for (const item of corpus.cases) {
    if (!/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate case ID');
    ids.add(item.id);
    if (!['typescript', 'python', 'go'].includes(item.language) || typeof item.prefix !== 'string' || typeof item.suffix !== 'string'
      || !Array.isArray(item.references) || !Array.isArray(item.tests) || item.tests.length < 3
      || item.tests.some(test => typeof test.name !== 'string' || typeof test.body !== 'string' || !test.body.trim())) {
      throw new Error(`Incomplete evaluation case: ${item.id}`);
    }
  }
  return { ...corpus, sha256: digest(content) };
}

function sourcePath(root, relative, language) {
  const extension = language === 'python' ? '.py' : language === 'go' ? '.go' : '.ts';
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(relative) || !relative.endsWith(extension)
    || relative.split('/').some(part => part === '..' || !part)) throw new Error('Invalid fixture source path');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Fixture source escaped its case directory');
  return resolved;
}

function compileCase(item, code, root) {
  const inputs = [{ path: item.entryFile, content: code }, ...item.references];
  const files = new Set();
  for (const input of inputs) {
    const target = sourcePath(root, input.path, item.language);
    if (files.has(target)) throw new Error('Duplicate fixture source path');
    files.add(target);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, input.content);
  }
  if (item.language === 'python' || item.language === 'go') return { sourceFiles: [...files] };
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

async function executeCase(file, language, timeoutMs = 15_000) {
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Quality execution requires Node 26+ network permissions');
  const root = path.dirname(file);
  return new Promise((resolve, reject) => {
    const python = language === 'python';
    const executable = python ? process.env.DROID_AUTOCOMPLETE_PYTHON ?? 'python' : process.execPath;
    const args = python ? ['-X', 'utf8', '-I', '-S', '-B', pythonRunner, file]
      : ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${runner}`, '--max-old-space-size=128', runner, file];
    const child = spawn(executable, args, {
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
      const lines = stdout.split(/\r?\n/);
      const tests = lines.filter(line => line.startsWith('DROID_QUALITY_RESULT '))
        .map(line => JSON.parse(line.slice('DROID_QUALITY_RESULT '.length)));
      const syntax = lines.find(line => line.startsWith('DROID_QUALITY_SYNTAX '));
      resolve({ tests, exitCode, timedOut, tooMuchOutput, stderr,
        ...(python ? syntax ? JSON.parse(syntax.slice('DROID_QUALITY_SYNTAX '.length))
          : { compiled: false, diagnostics: [{ message: 'Python worker did not report syntax validation' }] } : {}) });
    });
  });
}

export async function evaluateCase(item, insertion, directory) {
  const root = path.resolve(directory, item.id);
  mkdirSync(root, { recursive: true });
  const code = item.prefix + insertion + item.suffix;
  const result = { id: item.id, category: item.category, language: item.language,
    validation: item.language === 'python' ? 'syntax-and-behavior' : item.language === 'go' ? 'compile-and-behavior' : 'strict-types-and-behavior',
    sourceSha256: digest(code), ...compileCase(item, code, root) };
  if (item.language === 'go') return { ...result, ...await evaluateGo(item, root), expectedTests: item.tests.length };
  if (result.compiled === false) return { ...result, passed: false, tests: [], expectedTests: item.tests.length };
  const entry = item.language === 'python' ? item.entryFile : path.join('compiled', item.entryFile.replace(/\.ts$/, '.js'));
  const input = path.join(root, 'execution.json');
  writeFileSync(input, JSON.stringify({ entry, tests: item.tests, sourceFiles: result.sourceFiles }));
  writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
  const execution = await executeCase(input, item.language);
  return { ...result, ...execution, expectedTests: item.tests.length, passed: execution.exitCode === 0
    && !execution.timedOut && !execution.tooMuchOutput && execution.tests.length === item.tests.length
    && execution.tests.every(test => test.passed) };
}
