const assert = require('node:assert/strict');

// Replays input around an independently authored question. The final prefix,
// suffix and hidden tests stay identical; no solution text enters these edits.
function typingTrajectory(prefix, variant) {
  const lf = prefix.replace(/\r\n/g, '\n');
  const lineEnd = lf.endsWith('\n') ? lf.length - 1 : lf.length;
  const lineStart = lf.lastIndexOf('\n', lineEnd - 1) + 1;
  // Typing a leading closer invokes the editor's electric indentation even with
  // autoIndent disabled. Keep that already-authored boundary in the fixture.
  const boundary = /^[\t ]*[}\])]+/.exec(lf.slice(lineStart, lineEnd))?.[0].length ?? 0;
  const start = Math.max(lineStart + boundary, lineEnd - 48);
  const tail = [...lf.slice(start)];
  assert.ok(tail.length > 0);
  const middle = Math.max(1, Math.floor(tail.length / 2));
  const actions = [];
  for (let index = 0; index < tail.length; index++) {
    if (index + 1 === middle && variant === 'corrected') {
      actions.push({ kind: 'type', text: 'x', pauseMs: 500 }, { kind: 'backspace', pauseMs: 60 });
    }
    actions.push({ kind: 'type', text: tail[index], pauseMs: index === tail.length - 1 ? 0 : 60 });
    if (index + 1 === middle && variant === 'resumed' && index < tail.length - 1) actions.at(-1).pauseMs = 500;
  }
  const eol = prefix.includes('\r\n') ? '\r\n' : '\n';
  const initialPrefix = lf.slice(0, start).replace(/\n/g, eol);
  let final = initialPrefix;
  for (const action of actions) final = applyTypingAction(final, action, eol);
  assert.equal(final, prefix, 'Typing trajectory changed the authored question');
  return { variant, initialPrefix, actions };
}

function applyTypingAction(prefix, action, eol) {
  if (action.kind === 'type') return prefix + action.text.replace(/\n/g, eol);
  assert.equal(action.kind, 'backspace');
  return prefix.endsWith('\r\n') ? prefix.slice(0, -2) : [...prefix].slice(0, -1).join('');
}

module.exports = { typingTrajectory, applyTypingAction };
