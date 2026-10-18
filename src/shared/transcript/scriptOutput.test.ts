import { expect, it } from 'vitest';
import { readableScriptOutput, scriptOutputParts } from './scriptOutput';

it('unpacks both string and Execute-object results without losing exit codes or unknown fields', () => {
  const text = [JSON.stringify({ part: 0, result: 'TODO List Updated' }),
    JSON.stringify({ part: 1, result: { output: 'fetch failed\n', exitCode: 1 } }),
    JSON.stringify({ part: 2, result: { output: 'PASS\n', exitCode: 0 } }),
    JSON.stringify({ part: 3, result: { unusual: 'retained' } })].join('\n');
  expect(readableScriptOutput(text)).toBe('[1]\nfetch failed\n[Process exited with code 1]\n\n[2]\nPASS\n[Process exited with code 0]\n\n[3]\n{\n  "unusual": "retained"\n}');
  expect(readableScriptOutput('Plain supplemental text')).toBe('Plain supplemental text');
});

it('shows complete parts and the safely decoded prefix when the final JSON string was truncated', () => {
  const text = '{"part":0,"result":"first\\nline"}\n{"part":1,"result":{"output":"second\\n\\u4f60\\u597d\\u4f';
  expect(readableScriptOutput(text, true)).toBe('[0]\nfirst\nline\n\n[1]\nsecond\n你好');
  expect(scriptOutputParts(text, true)?.at(-1)).toMatchObject({ partial: true, text: 'second\n你好' });
  expect(readableScriptOutput(text)).toBe(text);
  const quote = JSON.stringify({ part: 0, result: 'say "hello"' }).slice(0, -3);
  expect(readableScriptOutput(quote, true)).toBe('[0]\nsay "hello');
});

it('handles unfiltered completion trailers and preserves complete entries before a truncated search hit', () => {
  const first = JSON.stringify({ path: 'src/a.ts', line: 5, text: 'const value = 1;', kind: 'match' });
  const complete = `{"part":0,"result":[${first}]}\n[Script completed · 1.6 s elapsed · 6 calls · 2.8 KiB passed through unfiltered · log: C:/log]`;
  expect(readableScriptOutput(complete)).toBe('[0]\nsrc/a.ts:5\nconst value = 1;');
  const partial = `{"part":0,"result":"Useful note"}\n{"part":1,"result":[${first},{"path":"src/b`;
  expect(readableScriptOutput(partial, true)).toBe('[0]\nUseful note\n\n[1]\nsrc/a.ts:5\nconst value = 1;\n{"path":"src/b');
});
