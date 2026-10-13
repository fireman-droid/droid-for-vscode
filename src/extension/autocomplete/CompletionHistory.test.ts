import { describe, expect, it } from 'vitest';
import { CompletionHistory } from './CompletionHistory';

describe('completion history availability', () => {
  it('expires an empty result after one second while retaining useful suggestions', () => {
    const history = new CompletionHistory();
    history.put('empty', 'if (ready)', '', '', 100);
    history.put('positive', 'const value = ', ';', 'compute()', 100);

    expect(history.find('empty', 'if (ready)', '', 1_099)).toBe('');
    expect(history.find('empty', 'if (ready)', '', 1_100)).toBeUndefined();
    expect(history.find('positive', 'const value = ', ';', 30_099)).toBe('compute()');
    expect(history.find('positive', 'const value = ', ';', 30_100)).toBeUndefined();
  });

  it('lets an explicit request bypass a negative result without discarding positive matches', () => {
    const history = new CompletionHistory();
    history.put('empty', 'return ', ';', '', 100);
    history.put('positive', 'const value = ', ';', 'compute()', 100);

    expect(history.find('empty', 'return ', ';', 101, true)).toBeUndefined();
    expect(history.find('empty', 'return ', ';', 101)).toBe('');
    expect(history.find('positive', 'const value = comp', ';', 101, true)).toBe('ute()');
  });

  it('allows a new continuation after a positive suggestion is fully typed', () => {
    const history = new CompletionHistory();
    history.put('file', 'const value = ', '', 'compute()', 100);

    expect(history.find('file', 'const value = compute(', '', 101)).toBe(')');
    expect(history.find('file', 'const value = compute()', '', 101)).toBeUndefined();
    history.put('file', 'const value = compute()', '', ';\nconsume(value);', 102);
    expect(history.find('file', 'const value = compute()', '', 103)).toBe(';\nconsume(value);');
  });
});
