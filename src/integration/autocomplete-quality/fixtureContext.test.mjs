import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertFixtureContext } from './fixtureContext.cjs';

test('another task with the same entry filename cannot enter an independent FIM request', () => {
  const prompt = '<|fim_prefix|>// Reference file: previous-task/main.ts\n// export const oldValue = 1;\n\n'
    + '// Reference file: current-task/types.ts\n// export type Value = number;\nconst answer = ';
  assert.throws(() => assertFixtureContext(prompt, ['current-task/main.ts', 'current-task/types.ts']),
    /Unrelated fixture entered model context: previous-task\/main.ts/);
});

test('native context checks preserve allowed dependencies across supported fixture templates', () => {
  const allowed = ['current-task/types.ts', 'current-task/helpers.py', 'current-task/main.go'];
  for (const [header, file] of [
    ['// Reference file: current-task/types.ts\r\n', allowed[0]],
    ['# Reference file: current-task/helpers.py\n', allowed[1]],
    ['+++++ current-task/main.go\n', allowed[2]],
  ]) {
    assert.deepEqual(assertFixtureContext(header + 'source', allowed), [file]);
    assert.throws(() => assertFixtureContext(header + 'source', ['other-task/' + file.split('/').at(-1)]), /Unrelated fixture/);
  }
});
