import { describe, expect, it } from 'vitest';

import { MAX_TOOL_ACTION_SUMMARY_LENGTH } from '../shared/toolActivity';
import { extractExecuteSummary, extractToolDetail } from './toolDetail';

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

describe('extractExecuteSummary', () => {
  it('extracts the summary only for execute tools', () => {
    expect(
      extractExecuteSummary('Execute', { summary: 'List repo files' }),
    ).toBe('List repo files');
    expect(
      extractExecuteSummary('Read', { summary: 'List repo files' }),
    ).toBeUndefined();
  });

  it('collapses control characters and whitespace runs', () => {
    expect(
      extractExecuteSummary('Execute', {
        summary: ' Check\u0007 the \n\n build ',
      }),
    ).toBe('Check the build');
  });

  it('rejects empty and non-string summaries', () => {
    expect(extractExecuteSummary('Execute', { summary: '   ' })).toBeUndefined();
    expect(extractExecuteSummary('Execute', { summary: 42 })).toBeUndefined();
    expect(extractExecuteSummary('Execute', null)).toBeUndefined();
  });

  it('clips overlong summaries to the action budget', () => {
    const summary = extractExecuteSummary('Execute', {
      summary: 'x'.repeat(500),
    });
    expect(summary?.length).toBe(MAX_TOOL_ACTION_SUMMARY_LENGTH);
  });
});
