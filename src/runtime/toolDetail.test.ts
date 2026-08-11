import { describe, expect, it } from 'vitest';

import { extractToolDetail } from './toolDetail';

describe('extractToolDetail', () => {
  it('captures the command for execute tools', () => {
    expect(extractToolDetail('Execute', { command: 'git status' })).toEqual(
      { kind: 'command', text: 'git status' },
    );
  });

  it('captures the plan text for task-plan tools', () => {
    expect(
      extractToolDetail('TodoWrite', {
        todos: '1. [in_progress] Do the thing',
      }),
    ).toEqual({ kind: 'plan', text: '1. [in_progress] Do the thing' });
  });

  it('normalizes the tool name before matching', () => {
    expect(
      extractToolDetail('  execute\u0007 ', { command: 'ls -la' }),
    ).toEqual({ kind: 'command', text: 'ls -la' });
  });

  it('keeps newlines and tabs but strips other control chars', () => {
    const detail = extractToolDetail('Execute', {
      command: 'echo one\n\techo two\u0000',
    });
    expect(detail?.text).toBe('echo one\n\techo two');
  });

  it('ignores unrelated tools and empty input', () => {
    expect(extractToolDetail('Read', { command: 'ignored' })).toBeUndefined();
    expect(extractToolDetail('Execute', { command: '   ' })).toBeUndefined();
    expect(extractToolDetail('Execute', null)).toBeUndefined();
  });

  it('bounds the detail length', () => {
    const long = 'a'.repeat(5_000);
    const detail = extractToolDetail('Execute', { command: long });
    expect(detail?.text.length).toBe(4_000);
  });
});
