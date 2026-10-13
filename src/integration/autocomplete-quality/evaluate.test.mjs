import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluateCase } from './evaluate.mjs';

// Runner calibration only: these are not model-quality questions and never count in a score.
const output = mkdtempSync(path.join(tmpdir(), 'droid-quality-runner-'));
const sample = { id: 'calibration', category: 'runner-only', entryFile: 'main.ts',
  prefix: 'export function read() {', suffix: '}', references: [], tests: [{ name: 'result', body: 'assert.equal(subject.read(), 42);' }] };

test('executes assertions and reports correct and incorrect outputs separately', async () => {
  const passing = await evaluateCase(sample, 'return 42;', path.join(output, 'pass'));
  assert.equal(passing.passed, true);
  const failing = await evaluateCase(sample, 'return 7;', path.join(output, 'fail'));
  assert.equal(failing.compiled, true);
  assert.equal(failing.passed, false);
  assert.equal(failing.tests[0].passed, false);
});
test('reports TypeScript errors without executing the program', async () => {
  const result = await evaluateCase(sample, 'const n: number = "wrong"; return n;', path.join(output, 'type'));
  assert.equal(result.compiled, false);
  assert.equal(result.tests.length, 0);
  assert.ok(result.diagnostics.some(issue => issue.code === 2322));
});
test('clock advances without wall-time sleeps and records prohibited timer use', async () => {
  const result = await evaluateCase({ ...sample, tests: [{ name: 'fake clock', body:
    'clock.set(9000); assert.equal(subject.read(), 9000); await clock.advance(200); assert.equal(subject.read(), 9200); assert.equal(clock.timerCalls(), 2);' }] },
  'setTimeout(() => {}, 100000); return Date.now();', path.join(output, 'clock'));
  assert.equal(result.passed, true);
});
test('empty assertion bodies cannot pass', async () => {
  const result = await evaluateCase({ ...sample, tests: [{ name: 'vacuous', body: 'subject.read();' }] }, 'return 42;', path.join(output, 'empty'));
  assert.equal(result.passed, false);
  assert.match(result.tests[0].error, /no assertions/);
});
test('candidate process has no network, writes, or child-process permissions', async () => {
  const result = await evaluateCase({ ...sample, tests: [{ name: 'permissions', body:
    'assert.equal(process.permission.has("net"), false); assert.equal(process.permission.has("fs.write"), false); assert.equal(process.permission.has("child"), false);' }] },
  'return 42;', path.join(output, 'permissions'));
  assert.equal(result.passed, true);
});
