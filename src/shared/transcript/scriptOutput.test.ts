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

it('decodes file/result bundles and the final truncated file without inventing a result', () => {
  const first = JSON.stringify({ file: 'package.json', result: '{\n  "name": "sample"\n}' });
  const text = `${first}\n{"file":"src/main.ts","result":"first\\n\\u4f60\\u597d\\u4f`;
  expect(readableScriptOutput(text, true)).toBe('[package.json]\n{\n  "name": "sample"\n}\n\n[src/main.ts]\nfirst\n你好');
  expect(scriptOutputParts(text, true)?.at(-1)).toEqual({ file: 'src/main.ts', text: 'first\n你好', partial: true });
  expect(readableScriptOutput(text)).toBe(text);
  const extra = JSON.stringify({ file: 'src/a.ts', result: 'body', note: 'unique metadata' });
  expect(readableScriptOutput(extra)).toBe(extra);
  expect(readableScriptOutput(JSON.stringify({ file: 'readme.txt', result: 'TODO List Updated' })))
    .toBe('[readme.txt]\nTODO List Updated');
});

it('decodes observed i/result labels including bounded prefixes without accepting extra fields or invalid indices', () => {
  const text = [JSON.stringify({ i: 0, result: 'TODO List Updated' }),
    JSON.stringify({ i: 1, result: [{ path: 'src/a.ts', line: 2, text: 'match' }] }),
    JSON.stringify({ i: 2, result: '# Unique note\nRetained body' })].join('\n');
  expect(readableScriptOutput(text)).toBe('[1]\nsrc/a.ts:2\nmatch\n\n[2]\n# Unique note\nRetained body');
  expect(readableScriptOutput('{"i":3,"result":"partial\\ntext\\u4f', true)).toBe('[3]\npartial\ntext');
  for (const value of [{ i: -1, result: 'keep' }, { i: 0.5, result: 'keep' }, { i: '0', result: 'keep' }, { i: 0, result: 'keep', note: 'keep metadata' }]) {
    const raw = JSON.stringify(value);
    expect(readableScriptOutput(raw)).toBe(raw);
  }
});

it.each([
  '2.8 KiB passed through unfiltered · 1 background execute running',
  '1 background execute running · 2.8 KiB passed through unfiltered',
])('strips the known CLI diagnostic fields in either observed order: %s', fields => {
  const body = JSON.stringify({ file: 'src/main.ts', result: 'const answer = 42;\n' });
  const footer = `[Script completed · 1.6 s elapsed · 6 calls · ${fields} · log: C:/sample.log]`;
  expect(readableScriptOutput(`${body}\n${footer}`)).toBe('[src/main.ts]\nconst answer = 42;');
  const unknown = `${body}\n[Script completed · 1.6 s elapsed · 6 calls · supplemental data · log: C:/sample.log]`;
  expect(readableScriptOutput(unknown)).toBe(unknown);
});
