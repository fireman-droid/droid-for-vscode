const assert = require('node:assert/strict');
const { test } = require('node:test');
const { typingTrajectory, applyTypingAction } = require('./typingTrajectory.cjs');

test('burst, resumed and typo-corrected typing restore the same LF/CRLF and Unicode question', () => {
  for (const prefix of ['const value = ', 'fn() {\n  if (', 'const 输出 = "😀";\n', 'fn() {\r\n  return ', 'a\r\n']) {
    for (const variant of ['burst', 'resumed', 'corrected']) {
      const trajectory = typingTrajectory(prefix, variant), eol = prefix.includes('\r\n') ? '\r\n' : '\n';
      const final = trajectory.actions.reduce((text, action) => applyTypingAction(text, action, eol), trajectory.initialPrefix);
      assert.equal(final, prefix);
      assert.equal(trajectory.actions.at(-1).pauseMs, 0);
      assert.equal(trajectory.actions.some(action => action.kind === 'backspace'), variant === 'corrected');
      assert.equal(trajectory.actions.some(action => action.pauseMs === 500), variant !== 'burst');
    }
  }
});

test('keeps existing leading braces so electric indentation cannot rewrite the question', () => {
  for (const prefix of ['function f() {\n    } else {\n', 'function f() {\n    }\n']) {
    const trajectory = typingTrajectory(prefix, 'corrected');
    assert.equal(trajectory.initialPrefix, 'function f() {\n    }');
    assert.equal(trajectory.actions.at(-1).kind, 'type');
    assert.equal(trajectory.actions.at(-1).pauseMs, 0);
  }
});
