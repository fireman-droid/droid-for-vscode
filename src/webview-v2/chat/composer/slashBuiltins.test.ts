import { describe, expect, it } from 'vitest';

import { resolveBuiltinSlash } from './slashBuiltins';

const btwOn = { btwEnabled: true };
const btwOff = { btwEnabled: false };

describe('resolveBuiltinSlash', () => {
  it.each(['/compact', '/compress', '/handoff', '/COMPRESS', ' /handoff '])(
    'maps %s onto the compaction pipeline',
    (text) => {
      expect(resolveBuiltinSlash(text, btwOff)).toEqual({
        kind: 'compact',
      });
    },
  );

  it.each(['/new', '/clear', '/Clear'])('maps %s onto session.new', (text) => {
    expect(resolveBuiltinSlash(text, btwOff)).toEqual({ kind: 'new' });
  });

  it.each([
    ['/model', 'model'],
    ['/mcp', 'mcp'],
    ['/skills', 'skills'],
    ['/sessions', 'sessions'],
    ['/context', 'context'],
  ])('maps %s onto navigation', (text, target) => {
    expect(resolveBuiltinSlash(text, btwOff)).toEqual({
      kind: 'navigate',
      target,
    });
  });

  it('keeps commands with arguments as normal prompt text', () => {
    expect(resolveBuiltinSlash('/compress everything', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('/clear the table', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('/model gpt', btwOff)).toBeNull();
  });

  it('keeps unknown slugs and plain text as prompt text', () => {
    expect(resolveBuiltinSlash('/deploy', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('compress', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('what does /clear do?', btwOff)).toBeNull();
  });

  it('resolves /btw with and without a question when enabled', () => {
    expect(resolveBuiltinSlash('/btw', btwOn)).toEqual({
      kind: 'btw',
      question: '',
    });
    expect(resolveBuiltinSlash('/btw what does this error mean?', btwOn)).toEqual({
      kind: 'btw',
      question: 'what does this error mean?',
    });
  });

  it('fails closed on /btw when the host did not advertise support', () => {
    expect(resolveBuiltinSlash('/btw hello', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('/btw', btwOff)).toBeNull();
  });

  it('consumes the removed Mission slash forms without sending them as prompts', () => {
    expect(resolveBuiltinSlash(' /mission ', btwOff)).toEqual({
      kind: 'removed',
    });
    expect(resolveBuiltinSlash('/mission  Keep  punctuation: a/b?  ', btwOff)).toEqual({
      kind: 'removed',
    });
    expect(resolveBuiltinSlash('/missionary nope', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('@/mission', btwOff)).toBeNull();
    expect(resolveBuiltinSlash('explain /mission', btwOff)).toBeNull();
  });

  it('turns /canvas forms into local template requests', () => {
    expect(resolveBuiltinSlash('/canvas', btwOff)).toEqual({
      kind: 'canvas',
      request: '',
    });
    expect(resolveBuiltinSlash('/canvas  A review dashboard ', btwOff)).toEqual({
      kind: 'canvas',
      request: 'A review dashboard',
    });
  });
});
