import { describe, expect, it } from 'vitest';
import { buildCompletionContext, prepareCompletion, reuseCompletion, type CachedCompletion } from './completionText';

describe('completion text', () => {
  it.each([
    ['Go', 'func main() {\n\tfmt.', 'Println("hello")\n}'],
    ['Java', 'class Example {\n  void run() {\n    System.out.', 'println("hello");\n  }\n}'],
    ['TypeScript', 'const greet = () => {\n  console.', 'log("hello");\n};'],
  ])('preserves %s code around the insertion point', (_language, prefix, suffix) => {
    expect(buildCompletionContext(prefix + suffix, prefix.length, 1000)).toEqual({ prefix, suffix });
  });

  it('spends unused suffix budget on the prefix at EOF and unused prefix budget on suffix', () => {
    expect(buildCompletionContext('abcdefghij', 10, 8)).toEqual({ prefix: 'cdefghij', suffix: '' });
    expect(buildCompletionContext('abcdefghij', 1, 8)).toEqual({ prefix: 'a', suffix: 'bcdefgh' });
  });

  it('keeps the cursor-nearest context within its budget', () => {
    expect(buildCompletionContext('abcdefghijklmnopqrst', 10, 8)).toEqual({ prefix: 'efghij', suffix: 'kl' });
  });

  it('does not split emoji or CRLF at a truncation edge', () => {
    expect(buildCompletionContext('a😀bcXYZ', 5, 4)).toEqual({ prefix: 'bc', suffix: 'X' });
    expect(buildCompletionContext('abcd😀XYZ', 4, 5)).toEqual({ prefix: 'abcd', suffix: '' });
    expect(buildCompletionContext('a\r\nbcXYZ', 5, 4)).toEqual({ prefix: 'bc', suffix: 'X' });
    expect(buildCompletionContext('abcd\r\nXYZ', 4, 5)).toEqual({ prefix: 'abcd', suffix: '' });
  });

  it('preserves indentation, inner fences, and CRLF within code', () => {
    const body = '  const value = 1;\r\n  return value;';
    expect(prepareCompletion(body, 'function run() {\r\n', '}')).toBe(body);
    expect(prepareCompletion('```typescript\r\n' + body + '\r\n```', '', '')).toBe(body);
    expect(prepareCompletion('  const sample = "```";', '', '')).toBe('  const sample = "```";');
  });

  it('rejects empty and already-present text without removing legitimate nested closing tokens', () => {
    expect(prepareCompletion('\n  ', '', '')).toBe('');
    expect(prepareCompletion('return value;', '', 'return value;\n}')).toBe('');
    expect(prepareCompletion('run())', 'outer(', ')')).toBe('run())');
  });

  const cached: CachedCompletion = {
    uri: 'file:///sample.ts', prefix: 'const value = ', suffix: ';', text: 'calculate()', createdAt: 1000,
  };

  it('reuses the same suggestion and its remaining text after forward typing', () => {
    expect(reuseCompletion(cached, cached.uri, cached.prefix, ';', 1001)).toBe('calculate()');
    expect(reuseCompletion(cached, cached.uri, cached.prefix + 'calc', ';', 1002)).toBe('ulate()');
  });

  it('distinguishes an exhausted or empty cached answer from a cache miss', () => {
    expect(reuseCompletion(cached, cached.uri, cached.prefix + cached.text, ';', 1002)).toBe('');
    expect(reuseCompletion({ ...cached, text: '' }, cached.uri, cached.prefix, ';', 1002)).toBe('');
  });

  it('does not reuse for another file, changed suffix, divergence, deletion, or expired context', () => {
    expect(reuseCompletion(cached, 'file:///other.ts', cached.prefix, ';', 1001)).toBeUndefined();
    expect(reuseCompletion(cached, cached.uri, cached.prefix, '\n', 1001)).toBeUndefined();
    expect(reuseCompletion(cached, cached.uri, cached.prefix + 'x', ';', 1001)).toBeUndefined();
    expect(reuseCompletion(cached, cached.uri, cached.prefix.slice(0, -1), ';', 1001)).toBeUndefined();
    expect(reuseCompletion(cached, cached.uri, cached.prefix, ';', 31_001)).toBeUndefined();
  });
});
