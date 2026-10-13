import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Reviewed fixture code only. Time/output limits and Go's soft memory target do
// not make a malicious-code sandbox; compilation and execution are separate.
export async function evaluateGo(item, root) {
  const imports = [...new Set(['testing', 'fmt', ...(item.testImports ?? [])])];
  if (imports.some(name => !/^[a-z][a-z0-9/]*$/.test(name))) throw new Error('Invalid Go test import');
  const tests = item.tests.map((test, index) => `func TestCase${index}(t *testing.T) {
    checks := 0
    check := func(condition bool, message string) { t.Helper(); checks++; if !condition { t.Error(message) } }
    _ = check
    defer func() {
      if checks == 0 { t.Error("test made no assertions") }
      fmt.Printf("DROID_QUALITY_ASSERTIONS %d\\n", checks)
    }()
    ${test.body}
  }`).join('\n');
  writeFileSync(path.join(root, 'go.mod'), 'module example.invalid/autocomplete-eval\n\ngo 1.23\n');
  writeFileSync(path.join(root, 'quality_test.go'), `package completion\nimport (\n${imports.map(name => JSON.stringify(name)).join('\n')}\n)\n${tests}\n`);
  const executable = path.join(root, process.platform === 'win32' ? 'quality.test.exe' : 'quality.test');
  const cache = path.join(tmpdir(), 'droid-quality-go-cache');
  mkdirSync(cache, { recursive: true });
  const env = { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    PATH: process.env.PATH, GOCACHE: cache, GOMODCACHE: path.join(cache, 'modules'),
    GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOWORK: 'off', GOENV: 'off', CGO_ENABLED: '0' };
  const compilation = await run(process.env.DROID_AUTOCOMPLETE_GO ?? 'go',
    ['test', '-c', '-vet=off', '-o', executable, '.'], root, env, 60_000);
  if (compilation.exitCode !== 0 || compilation.timedOut || compilation.tooMuchOutput) return {
    compiled: false, passed: false, tests: [], diagnostics: [{ message: compilation.stderr || compilation.stdout || 'Go compilation failed' }],
    timedOut: compilation.timedOut, tooMuchOutput: compilation.tooMuchOutput,
  };
  const results = [];
  for (const [index, test] of item.tests.entries()) {
    // A fresh process for each hidden test prevents fixture globals leaking.
    const execution = await run(executable, ['-test.v', `-test.run=^TestCase${index}$`, '-test.count=1', '-test.timeout=10s'],
      root, { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, GOMEMLIMIT: '128MiB' }, 12_000);
    const assertions = Number(execution.stdout.match(/^DROID_QUALITY_ASSERTIONS (\d+)$/m)?.[1] ?? 0);
    const passed = execution.exitCode === 0 && assertions > 0 && !execution.timedOut && !execution.tooMuchOutput
      && execution.stdout.includes(`--- PASS: TestCase${index} `);
    results.push({ name: test.name, passed, assertions,
      ...(passed ? {} : { error: (execution.stderr || execution.stdout || 'Go test did not report assertions').slice(0, 8000) }),
      timedOut: execution.timedOut, tooMuchOutput: execution.tooMuchOutput });
  }
  return { compiled: true, diagnostics: [], tests: results, passed: results.every(test => test.passed),
    timedOut: results.some(test => test.timedOut), tooMuchOutput: results.some(test => test.tooMuchOutput) };
}

function run(executable, args, root, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, tooMuchOutput = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const collect = (name, chunk) => {
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > 1_000_000) { tooMuchOutput = true; child.kill(); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', exitCode => { clearTimeout(timer); resolve({ exitCode, stdout, stderr, timedOut, tooMuchOutput }); });
  });
}
