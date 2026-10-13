import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluateCase } from './evaluate.mjs';
import goSyntaxModule from './goSyntax.cjs';

// Runner calibration, not model-quality questions.
const output = mkdtempSync(path.join(tmpdir(), 'droid-quality-go-'));
const sample = { id: 'go-calibration', category: 'runner-only', language: 'go', entryFile: 'main.go',
  prefix: 'package completion\nimport "example.invalid/autocomplete-eval/domain"\nfunc answer() int { ', suffix: ' }\n',
  references: [{ path: 'domain/value.go', content: 'package domain\nconst Value = 42\n' }],
  testImports: [], tests: [{ name: 'answer', body: 'check(answer() == 42, "wrong answer")' }] };

test('Go compiles local packages and separates correct, wrong and noncompiling code', async () => {
  const passing = await evaluateCase(sample, 'return domain.Value', path.join(output, 'pass'));
  assert.equal(passing.passed, true, JSON.stringify(passing));
  const wrong = await evaluateCase(sample, 'return domain.Value + 1', path.join(output, 'wrong'));
  assert.equal(wrong.compiled, true); assert.equal(wrong.passed, false);
  assert.equal(wrong.tests[0].assertions, 1);
  const invalid = await evaluateCase(sample, 'return domain.Value + "x"', path.join(output, 'compile'));
  assert.equal(invalid.compiled, false); assert.equal(invalid.tests.length, 0);
});

test('Go requires assertions and starts each hidden test in a fresh process', async () => {
  const fresh = { ...sample, prefix: 'package completion\nvar state int\nfunc answer() int { ', references: [],
    tests: [sample.tests[0], { name: 'fresh', body: 'check(answer() == 42, "state leaked")' }] };
  const result = await evaluateCase(fresh, 'state++; return 41 + state', path.join(output, 'fresh'));
  assert.equal(result.passed, true, JSON.stringify(result));
  const vacuous = await evaluateCase({ ...fresh, tests: [{ name: 'empty', body: '_ = answer()' }] },
    'return 42', path.join(output, 'vacuous'));
  assert.equal(vacuous.passed, false); assert.match(vacuous.tests[0].error, /no assertions/);
});

test('Go native syntax gate preserves Chinese and CRLF without executing init functions', () => {
  assert.equal(goSyntaxModule.goSyntax('package completion\r\n// 中文\r\nfunc init() { panic("must not run") }\r\n').compiled, true);
  assert.equal(goSyntaxModule.goSyntax('package completion\nfunc broken( {}').compiled, false);
});
