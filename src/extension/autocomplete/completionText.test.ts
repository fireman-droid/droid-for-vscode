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

  it('preserves code indentation and CRLF without rewriting either', () => {
    const body = '  const value = 1;\r\n  return value;';
    expect(prepareCompletion(body, 'function run() {\r\n', '}', 'typescript')).toBe(body);
  });

  it.each(['markdown', 'mdx', 'plaintext'])('preserves complete and standalone fences in %s', (languageId) => {
    const fenced = '```typescript\r\n  const value = 1;\r\n```';
    expect(prepareCompletion(fenced, 'Example:\r\n', '', languageId)).toBe(fenced);
    expect(prepareCompletion('```\n', 'End example\n', '', languageId)).toBe('```\n');
  });

  it.each([
    ['java', 'String sample = "```";'],
    ['typescript', '  const sample = "```";'],
    ['go', 'sample := "```"'],
    ['java', '// Example: ```java'],
    ['typescript', '/* Inline ``` code marker */'],
  ])('preserves inline fence text in %s code or comments (%#)', (languageId, text) => {
    expect(prepareCompletion(text, '', '', languageId)).toBe(text);
  });

  it('rejects the recorded Java response with a dangling fence after its loop', () => {
    const raw = "    for (int i = 0; i < values.length; i++) {\n      total += (i + 1) * values[i];\n    }\n    \n```";
    const prefix = "public class CompletionSample {\n  // Sum values multiplied by their one-based array position.\n  static int weightedScore(int[] values) {\n    int total = 0;\n";
    const suffix = "    return total;\n  }\n  public static void main(String[] args) {\n    if (weightedScore(new int[]{4, 6, 9}) != 43) throw new AssertionError(\"expected score 43\");\n    if (weightedScore(new int[]{7, -2, 5}) != 18) throw new AssertionError(\"expected score 18\");\n    if (weightedScore(new int[]{}) != 0) throw new AssertionError(\"expected score 0\");\n    System.out.println(\"PASS java-function-body 43 18 0\");\n  }\n}\n";
    expect(prepareCompletion(raw, prefix, suffix, 'java')).toBeUndefined();
  });

  it.each(['java', 'go', 'typescript', 'python', 'rust', 'custom-language'])('uses the same isolated-fence gate for %s', (languageId) => {
    expect(prepareCompletion('```code\nvalue\n```', '', '', languageId)).toBeUndefined();
    expect(prepareCompletion('value\n\n```', '', '', languageId)).toBeUndefined();
    expect(prepareCompletion('value\r\n\t  ````code\r\n', '', '', languageId)).toBeUndefined();
  });

  it.each([
    ['java', 'String example = """\n', '\n""";'],
    ['typescript', 'const example = String.raw`\n', '\n`;'],
    ['go', 'var example = `\n', '\n`'],
    ['java', '/* Example:\n', '\n*/'],
  ])('suppresses ambiguous standalone fences without altering possible %s string/comment contents', (languageId, prefix, suffix) => {
    // These contexts cannot be distinguished safely without lexical evidence. A missing
    // suggestion is preferable to removing a fence from a possible literal or comment.
    expect(prepareCompletion('```java\nexample\n```', prefix, suffix, languageId)).toBeUndefined();
  });

  it('distinguishes empty/already-present output from rejected formatting and preserves nested closing tokens', () => {
    expect(prepareCompletion('\n  ', '', '', 'java')).toBe('');
    expect(prepareCompletion('return value;', '', 'return value;\n}', 'java')).toBe('');
    expect(prepareCompletion('run())', 'outer(', ')', 'typescript')).toBe('run())');
    expect(prepareCompletion('```', '', '', 'java')).toBeUndefined();
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
