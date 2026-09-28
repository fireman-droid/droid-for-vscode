import { describe, expect, it } from 'vitest';
import { buildCompletionContext } from '../completionText';
import { buildCompletionPrompt } from './CompletionPrompt';
import type { ContextSnippet } from './CompletionContextService';

function snippet(content: string, filepath = 'src/types.ts'): ContextSnippet {
  return { uri: `file:///project/${filepath}`, filepath, content, source: 'openFile' };
}

const input = {
  text: 'function run() {\n  return \n}', offset: 26, maxCharacters: 500,
  filepath: 'src/main.ts', model: 'codestral-latest', snippets: [] as ContextSnippet[],
};

describe('buildCompletionPrompt', () => {
  it('preserves plain FIM context without relevant snippets, including empty files', () => {
    for (const text of [input.text, '', 'x'.repeat(1000)]) {
      expect(buildCompletionPrompt({ ...input, text }))
        .toEqual(buildCompletionContext(text, input.offset, input.maxCharacters));
    }
  });

  it('uses Codestral multi-file delimiters while preserving suffix and EOF completion', () => {
    const options = { ...input, snippets: [snippet('export type User = { id: string }')] };
    const result = buildCompletionPrompt(options);
    expect(result.prefix).toBe('+++++ src/types.ts\nexport type User = { id: string }\n\n'
      + '+++++ src/main.ts\n' + input.text.slice(0, input.offset));
    expect(result.suffix).toBe(input.text.slice(input.offset));
    const eof = buildCompletionPrompt({ ...options, offset: input.text.length });
    expect(eof.prefix).toContain('export type User');
    expect(eof.suffix).toBe('');
  });

  it('reserves at least 60% for the current document and counts all file headers', () => {
    const result = buildCompletionPrompt({
      ...input, text: 'a'.repeat(2000), offset: 1500, maxCharacters: 200,
      snippets: [snippet('b'.repeat(500))],
    });
    const main = result.prefix.split('+++++ src/main.ts\n')[1] + result.suffix;
    expect(main.length).toBeGreaterThanOrEqual(120);
    expect(result.prefix.length + result.suffix.length).toBeLessThanOrEqual(200);
  });

  it('returns unused reference budget to the current document', () => {
    const result = buildCompletionPrompt({
      ...input, text: 'a'.repeat(2000), offset: 1500, maxCharacters: 300,
      snippets: [snippet('type X = 1')],
    });
    const main = result.prefix.split('+++++ src/main.ts\n')[1] + result.suffix;
    expect(main.length).toBeGreaterThan(180);
    expect(result.prefix.length + result.suffix.length).toBe(300);
  });

  it.each(['//', '#', '--'])('uses provided %s line comments without language-specific rules', (line) => {
    const result = buildCompletionPrompt({
      ...input, model: 'other-fim-model', comments: { line },
      snippets: [snippet('first\r\nsecond\nthird')],
    });
    expect(result.prefix).toBe(`${line} Reference file: src/types.ts\n`
      + `${line} first\r\n${line} second\n${line} third\n\n` + input.text.slice(0, input.offset));
  });

  it('closes block comments after truncation and escapes embedded closers', () => {
    const result = buildCompletionPrompt({
      ...input, model: 'other-fim-model', comments: { block: ['<!--', '-->'] },
      snippets: [snippet('<section><!-- close -->body</section>'.repeat(100), 'views/a-->b.html')],
    });
    expect(result.prefix.match(/-->/g)).toHaveLength(1);
    expect(result.prefix).toContain('a-- >b.html');
    expect(result.prefix).toContain('<!-- close -- >');
    expect(result.prefix).toContain('-->\n\n' + input.text.slice(0, input.offset));
    expect(result.prefix.length + result.suffix.length).toBeLessThanOrEqual(input.maxCharacters);
  });

  it('uses readable separators for unrecognized languages without inventing comment syntax', () => {
    const result = buildCompletionPrompt({
      ...input, model: 'other-fim-model', snippets: [snippet('reference content', 'custom.data')],
    });
    expect(result.prefix).toContain('--- Reference file: custom.data ---\nreference content\n--- End reference file ---');
    expect(result.prefix).toContain('--- Current file: src/main.ts ---\n');
    expect(result.prefix).not.toContain('//');
  });

  it('filters newlines from paths and never emits absolute filesystem paths', () => {
    const result = buildCompletionPrompt({
      ...input, filepath: 'C:\\Users\\name\\main.ts',
      snippets: [snippet('type A = 1', '/home/name/types\n.ts')],
    });
    expect(result.prefix).toContain('+++++ types.ts\n');
    expect(result.prefix).toContain('+++++ main.ts\n');
    expect(result.prefix).not.toMatch(/Users|home|name/);
  });

  it('skips oversized headers instead of truncating markers or starving the main file', () => {
    expect(buildCompletionPrompt({
      ...input, maxCharacters: 30, snippets: [snippet('reference', 'a'.repeat(100))],
    })).toEqual(buildCompletionContext(input.text, input.offset, 30));
  });

  it('never splits surrogate pairs or CRLF at reference clipping edges', () => {
    for (const content of ['\u{1F600}'.repeat(300), 'a\r\n'.repeat(300)]) {
      for (const maxCharacters of [99, 100, 101, 102, 103]) {
        const result = buildCompletionPrompt({
          ...input, text: 'a'.repeat(500), offset: 250, maxCharacters,
          filepath: 'a.ts', snippets: [snippet(content, 'b.ts')],
        });
        const body = result.prefix.split('+++++ b.ts\n')[1]?.split('\n\n+++++ a.ts')[0];
        expect(body).toBeDefined();
        expect(body).not.toMatch(/[\ud800-\udbff]$|\r$/);
        expect(result.prefix.length + result.suffix.length).toBeLessThanOrEqual(maxCharacters);
      }
    }
  });

  it('counts repeated comment prefixes and complete terminators for every reference', () => {
    const result = buildCompletionPrompt({
      ...input, model: 'other', maxCharacters: 160, comments: { line: '--' },
      snippets: [snippet('x\n'.repeat(100), 'a.sql'), snippet('y\n'.repeat(100), 'b.sql')],
    });
    expect(result.prefix.length + result.suffix.length).toBeLessThanOrEqual(160);
    expect(result.prefix.endsWith(input.text.slice(0, input.offset))).toBe(true);
  });
});
