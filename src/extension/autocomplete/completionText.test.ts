import { describe, expect, it } from 'vitest';
import { buildCompletionContext, prepareCompletion, prepareCompletionWithOutcome } from './completionText';

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

  it('returns the code body of the recorded Java completion despite a trailing fence', () => {
    const expected = '    for (int i = 0; i < values.length; i++) {\n      total += (i + 1) * values[i];\n    }\n    ';
    const prefix = 'public class CompletionSample {\n  // Sum values multiplied by their one-based array position.\n  static int weightedScore(int[] values) {\n    int total = 0;\n';
    const suffix = '    return total;\n  }\n}\n';
    expect(prepareCompletionWithOutcome(expected + '\n```', prefix, suffix, 'java', 'Qwen/Qwen3-Coder-30B-A3B-Instruct'))
      .toEqual({ text: expected, outcome: 'suggestion-returned' });
  });

  it('strips edge fences but leaves inline backticks in normal code', () => {
    expect(prepareCompletion('```java\r\nString sample = "```";\r\n```', 'void run() {\r\n', '\r\n}', 'java'))
      .toBe('String sample = "```";');
  });

  it('filters repeated output without conflating it with an empty model response', () => {
    const result = prepareCompletionWithOutcome('  System.out.println("hello");', '  System.out.println("hello");\n', '', 'java');
    expect(result).toEqual({ text: '', outcome: 'repetition-filtered' });
    expect(prepareCompletionWithOutcome('  \n', '', '', 'java')).toEqual({ text: '', outcome: 'empty' });
  });
});
