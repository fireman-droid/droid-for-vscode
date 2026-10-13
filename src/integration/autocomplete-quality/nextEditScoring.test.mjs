import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluateTrajectory } from './nextEditScoring.mjs';

// Grader calibration, never counted as independent model exam questions.
const output = mkdtempSync(path.join(tmpdir(), 'droid-next-edit-scoring-'));
const source = 'export function read() { return 42; }';
const item = { id: 'calibration', language: 'typescript', entryFile: 'main.ts', expectedChange: false,
  initialFiles: [{ path: 'main.ts', content: source.replace('42', '41') }],
  edits: [{ path: 'main.ts', before: '41', after: '42' }], referenceSource: source,
  tests: [{ name: 'value', body: 'const mod = require(entry); assert.equal(mod.read(), 42);' }] };
const answer = { beforeSource: source, source, references: [], automaticRequested: true, historyVerified: true,
  requests: [{ responded: true, finishReason: 'stop', raw: '```\n' + source + '\n```' }], accepts: [] };

test('a complete unchanged prediction passes an already-finished edit', async () => {
  const result = await evaluateTrajectory(item, answer, path.join(output, 'unchanged'));
  assert.equal(result.responseHealthy, true);
  assert.equal(result.changed, false);
  assert.equal(result.passed, true);
});

test('a failed service cannot pass by leaving correct code untouched', async () => {
  const result = await evaluateTrajectory(item, { ...answer, requests: [], transportError: 'unavailable' }, path.join(output, 'unavailable'));
  assert.equal(result.behaviorPassed, true);
  assert.equal(result.responseHealthy, false);
  assert.equal(result.passed, false);
});

test('a token-limited or malformed no-change reply is not a successful prediction', async () => {
  for (const [name, request] of [
    ['truncated', { ...answer.requests[0], finishReason: 'length' }],
    ['malformed', { ...answer.requests[0], raw: 'no change needed' }],
  ]) {
    const result = await evaluateTrajectory(item, { ...answer, requests: [request] }, path.join(output, name));
    assert.equal(result.behaviorPassed, true);
    assert.equal(result.passed, false);
  }
});

test('an unnecessary rewrite is reported separately from semantic correctness', async () => {
  const rewrite = source.replace('return 42;', 'return 6 * 7;');
  const result = await evaluateTrajectory(item, { ...answer, source: rewrite, accepts: [{ step: 0, source: rewrite }] }, path.join(output, 'rewrite'));
  assert.equal(result.behaviorPassed, true);
  assert.equal(result.unnecessaryEdit, true);
  assert.equal(result.passed, false);
});

test('the last accepted edit is scored even when an earlier acceptance was correct', async () => {
  const unfinished = source.replace('42', '0'), wrong = source.replace('42', '7');
  const pending = { ...item, expectedChange: true, edits: [{ path: 'main.ts', before: '41', after: '0' }] };
  const result = await evaluateTrajectory(pending, { ...answer, beforeSource: unfinished, source: wrong,
    accepts: [{ step: 0, source }, { step: 1, source: wrong }] }, path.join(output, 'final'));
  assert.equal(result.compiled, true);
  assert.equal(result.acceptanceScores[0].behaviorPassed, true);
  assert.equal(result.acceptanceScores[1].behaviorPassed, false);
  assert.equal(result.passed, false);
});
