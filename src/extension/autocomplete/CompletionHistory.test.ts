import { describe, expect, it } from 'vitest';
import { CompletionHistory } from './CompletionHistory';

describe('Kilo classic completion history', () => {
  it('returns exact, typed and backspaced matches only for the same scope and suffix', () => {
    const history = new CompletionHistory();
    history.put({ scope: 'file', prefix: 'const x = ', suffix: ';', text: 'calculate()' });
    expect(history.find('file', 'const x = ', ';')).toMatchObject({ text: 'calculate()', matchType: 'exact' });
    expect(history.find('file', 'const x = cal', ';')).toMatchObject({ text: 'culate()', matchType: 'partial_typing' });
    expect(history.find('file', 'const x =', ';')).toMatchObject({ text: ' calculate()', matchType: 'backward_deletion' });
    expect(history.find('another-file', 'const x = ', ';')).toBeNull();
    expect(history.find('file', 'const x = ', 'another suffix')).toBeNull();
  });

  it('retains exact empty results, but does not reuse them elsewhere', () => {
    const history = new CompletionHistory();
    history.put({ scope: 'file', prefix: 'if (ready)', suffix: '', text: '' });
    expect(history.find('file', 'if (ready)', '')).toMatchObject({ text: '', matchType: 'exact' });
    expect(history.find('file', 'if (ready', '')).toBeNull();
  });
});
