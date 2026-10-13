import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { evaluateCase } from './evaluate.mjs';

let parser;
async function replacementParser() {
  parser ??= (async () => {
    const output = path.join(mkdtempSync(path.join(tmpdir(), 'droid-next-edit-parser-')), 'parser.cjs');
    await build({ entryPoints: [fileURLToPath(new URL('../../runtime/autocomplete/nextEdit.ts', import.meta.url))],
      outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    return createRequire(import.meta.url)(output).parseNextEditReplacement;
  })();
  return parser;
}

export function trajectoryInput(item) {
  const files = new Map(item.initialFiles.map(file => [file.path, file.content]));
  assert.equal(files.size, item.initialFiles.length, 'Duplicate initial fixture');
  assert.ok(item.edits.length && item.edits.at(-1).path === item.entryFile);
  for (const edit of item.edits) {
    const source = files.get(edit.path);
    assert.equal(typeof source, 'string');
    const offset = source.indexOf(edit.before);
    assert.ok(edit.before && offset >= 0 && source.indexOf(edit.before, offset + 1) === -1, 'Ambiguous authored edit');
    files.set(edit.path, source.slice(0, offset) + edit.after + source.slice(offset + edit.before.length));
  }
  const source = files.get(item.entryFile);
  assert.equal(typeof source, 'string');
  if (item.expectedChange === false) assert.equal(item.referenceSource, source, 'No-change oracle must preserve the completed edit');
  return { source, references: [...files].filter(([name]) => name !== item.entryFile).map(([path, content]) => ({ path, content })) };
}

/** Judge final behavior AND response health: an unavailable model must not pass
 * a no-change case just because the editor retained already-correct code. */
export async function evaluateTrajectory(item, answer, directory, { reference = false } = {}) {
  const input = trajectoryInput(item);
  const tests = item.tests.map(test => {
    assert.ok(test.body.startsWith('const mod = require(entry);'));
    return { ...test, body: test.body.replace('const mod = require(entry);', 'const mod = subject;') };
  });
  const fixture = { ...item, prefix: '', suffix: '', references: input.references, tests };
  if (reference) {
    const result = await evaluateCase(fixture, item.referenceSource, directory);
    if (item.expectedChange === true) {
      const unfinished = await evaluateCase(fixture, input.source, path.join(directory, 'before-prediction'));
      assert.equal(unfinished.passed, false, 'A positive case must require a behavioral repair after user edits');
    }
    return result;
  }
  assert.equal(answer?.beforeSource, input.source, 'Native input differs from the authored edits');
  assert.deepEqual(answer.references, input.references, 'Native dependencies differ from the authored edits');
  assert.equal(answer.source, answer.accepts.at(-1)?.source ?? input.source, 'Final source must be the actual last acceptance');
  const result = await evaluateCase(fixture, answer.source, directory);
  const parse = await replacementParser();
  const usable = answer.requests.filter(attempt => attempt.responded && !attempt.cancelled);
  const complete = usable.length > 0 && usable.every(attempt => {
    if (attempt.finishReason !== 'stop' || typeof attempt.raw !== 'string') return false;
    try { parse(attempt.raw); return true; }
    catch (error) { if (error.code !== 'protocol') throw error; return false; }
  });
  const healthy = answer.automaticRequested === true && answer.historyVerified === true
    && !answer.error && !answer.transportError && complete;
  result.expectedChange = item.expectedChange ?? true;
  result.responseHealthy = Boolean(healthy);
  result.behaviorPassed = result.passed;
  result.changed = answer.source !== input.source;
  result.unnecessaryEdit = item.expectedChange === false && answer.accepts.length > 0;
  result.passed = result.behaviorPassed && result.responseHealthy && !result.unnecessaryEdit;
  result.acceptanceScores = [];
  for (const accepted of answer.accepts) {
    const score = accepted.source === answer.source ? result
      : await evaluateCase(fixture, accepted.source, path.join(directory, 'steps', String(accepted.step)));
    result.acceptanceScores.push({ step: accepted.step, compiled: score.compiled,
      behaviorPassed: score.behaviorPassed ?? score.passed,
      failed: score.tests.filter(test => !test.passed).map(test => test.name) });
  }
  return result;
}
