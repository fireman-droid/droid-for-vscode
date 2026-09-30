import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoundedEditPrompt, parseNextEditReplacement, requestNextEdit } from './nextEdit';
import { buildMercuryEditPrompt, type MercuryEditContext } from './kilo/editPrompt';
const context: MercuryEditContext = {
  currentFilePath:'main.ts', currentFileContent:'const oldName = 1;\nconsole.log(oldName);',
  cursorLine:0,cursorCharacter:13,editableRegionStartLine:0,editableRegionEndLine:1,
  recentlyViewedSnippets:[],editDiffHistory:[],
};
afterEach(()=>vi.unstubAllGlobals());
describe('Mercury Next Edit boundary',()=>{
  it('extracts the complete region while preserving indentation and rejects truncated output',()=>{
    expect(parseNextEditReplacement('```ts\n  let x = 1;\n```')).toBe('  let x = 1;');
    expect(parseNextEditReplacement('```\n<|code_to_edit|>\nx\n<|/code_to_edit|>\n```')).toBe('x');
    expect(()=>parseNextEditReplacement('```ts\nlet x')).toThrow();
    expect(()=>parseNextEditReplacement('explanation\n```ts\nx\n```')).toThrow();
    expect(()=>parseNextEditReplacement('```\nx<|cursor|>\n```')).toThrow();
  });
  it('bounds a large file without cutting the edit region or misplacing the cursor',()=>{
    const lines=Array.from({length:10000},(_,i)=>'line'+i);
    const prompt=buildBoundedEditPrompt({...context,currentFileContent:lines.join('\n'),
      cursorLine:5000,cursorCharacter:4,editableRegionStartLine:4995,editableRegionEndLine:5010},1600);
    expect(prompt.length).toBeLessThanOrEqual(1600);
    expect(prompt).toContain('line<|cursor|>5000');
    expect(prompt).toContain('<|code_to_edit|>\nline4995');
    expect(prompt).toContain('line5010\n<|/code_to_edit|>');
  });
  it('preserves recent complete changes before a long file consumes the context budget', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => `const value${index} = ${index};`);
    const older = '--- main.ts\n+++ main.ts\n@@ -1 +1 @@\n-oldName\n+displayName';
    const latest = '--- main.ts\n+++ main.ts\n@@ -2 +2 @@\n-user.name\n+user.displayName';
    const history = [older, latest].map(body => `Index: main.ts\n================\n${body}`);
    const prompt = buildBoundedEditPrompt({ ...context, currentFileContent: lines.join('\n'),
      cursorLine: 500, cursorCharacter: 6, editableRegionStartLine: 499, editableRegionEndLine: 501,
      editDiffHistory: history, recentlyViewedSnippets: [{ filepath: 'user.ts', content: 'interface User { displayName: string }' }],
    }, 1800);
    expect(prompt.length).toBeLessThanOrEqual(1800);
    expect(prompt).toContain(older);
    expect(prompt).toContain(latest);
    expect(prompt.indexOf(older)).toBeLessThan(prompt.indexOf(latest));
    expect(prompt).toContain('interface User { displayName: string }');
    expect(prompt).toContain('<|code_to_edit|>\nconst value499 = 499;');
    expect(prompt).toContain('const <|cursor|>value500 = 500;');
    expect(prompt).toContain('const value501 = 501;\n<|/code_to_edit|>');
    expect(prompt).toContain('const value498 = 498;');
    expect(prompt).toContain('const value502 = 502;');
  });
  it('skips an oversized newest patch and keeps the newest complete patch that fits', () => {
    const older = 'Index: main.ts\n====\n--- main.ts\n+++ main.ts\n@@ -1 +1 @@\n-older\n+old';
    const fitting = 'Index: main.ts\n====\n--- main.ts\n+++ main.ts\n@@ -1 +1 @@\n-oldName\n+displayName';
    const oversized = 'Index: main.ts\n====\n--- main.ts\n+++ main.ts\n@@ -1 +1 @@\n-' + 'oversized'.repeat(1000) + '\n+replacement';
    const minimal = { ...context, currentFileContent: 'user.name', cursorLine: 0, cursorCharacter: 5,
      editableRegionStartLine: 0, editableRegionEndLine: 0, editDiffHistory: [fitting] };
    const budget = buildMercuryEditPrompt(minimal).length;
    const prompt = buildBoundedEditPrompt({ ...minimal,
      currentFileContent: ['surrounding'.repeat(200), 'user.name', 'surrounding'.repeat(200)].join('\n'),
      cursorLine: 1, editableRegionStartLine: 1, editableRegionEndLine: 1,
      editDiffHistory: [older, fitting, oversized],
    }, budget);
    expect(prompt).toBe(buildMercuryEditPrompt(minimal));
    expect(prompt).not.toContain('oversized');
    expect(prompt).not.toContain('-older');
  });
  it('keeps Unicode lines, cursor and complete CRLF history at an exact budget boundary', () => {
    const code = 'const 状态 = "🌟";';
    const body = '--- main.ts\n+++ main.ts\n@@ -1 +1 @@\n-旧值\n+新值🌟';
    const diff = `Index: main.ts\n====\n${body}`;
    const minimal = { ...context, currentFileContent: code, cursorLine: 0, cursorCharacter: 6,
      editableRegionStartLine: 0, editableRegionEndLine: 0, editDiffHistory: [diff] };
    const expected = buildMercuryEditPrompt(minimal);
    const input = { ...minimal,
      currentFileContent: ['// before'.repeat(100), code, '// after'.repeat(100)].join('\r\n'),
      cursorLine: 1, editableRegionStartLine: 1, editableRegionEndLine: 1,
      editDiffHistory: [diff.replace(/\n/g, '\r\n')],
    };
    const prompt = buildBoundedEditPrompt(input, expected.length);
    expect(prompt).toBe(expected);
    expect(prompt).toContain('const <|cursor|>状态 = "🌟";');
    expect(prompt).toContain(body);
    const regionOnly = buildMercuryEditPrompt({ ...minimal, editDiffHistory: [] });
    expect(buildBoundedEditPrompt(input, regionOnly.length)).toBe(regionOnly);
    expect(() => buildBoundedEditPrompt(input, regionOnly.length - 1)).toThrow('Editable region');
  });
  it('refuses to truncate a region larger than the request budget',()=>{
    expect(()=>buildBoundedEditPrompt({...context,currentFileContent:'x'.repeat(2000)},1000)).toThrow();
  });
  it('uses the edit endpoint contract and rejects token-limited replies',async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',
      message:{content:'```ts\nconst name = 1;\nconsole.log(name);\n```'}}]}),{headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const req={endpoint:'https://api.inceptionlabs.ai/v1/edit/completions',apiKey:'synthetic',model:'mercury-edit-2',
      maxTokens:256,signal:new AbortController().signal,context,maxContextCharacters:5000};
    expect(await requestNextEdit(req)).toContain('const name');
    const body=JSON.parse((fetchMock.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
    expect(body.max_tokens).toBe(512);
    expect(body.messages).toHaveLength(1);expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('<|code_to_edit|>');expect(body.stream).toBe(false);
    fetchMock.mockImplementationOnce(async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',
      message:{content:'```ts\nx\n```'}}]}),{headers:{'content-type':'application/json'}}));
    await expect(requestNextEdit(req)).rejects.toThrow('complete replacement');
  });
});
