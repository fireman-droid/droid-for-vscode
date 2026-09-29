import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoundedEditPrompt, parseNextEditReplacement, requestNextEdit } from './nextEdit';
import type { MercuryEditContext } from './kilo/editPrompt';
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
  it('refuses to truncate a region larger than the request budget',()=>{
    expect(()=>buildBoundedEditPrompt({...context,currentFileContent:'x'.repeat(2000)},1000)).toThrow();
  });
  it('uses the edit endpoint contract and rejects token-limited replies',async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',
      message:{content:'```ts\nconst name = 1;\nconsole.log(name);\n```'}}]}),{headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const req={endpoint:'https://api.inceptionlabs.ai/v1/edit/completions',apiKey:'synthetic',model:'mercury-edit-2',
      maxTokens:512,signal:new AbortController().signal,context,maxContextCharacters:5000};
    expect(await requestNextEdit(req)).toContain('const name');
    const body=JSON.parse((fetchMock.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
    expect(body.messages).toHaveLength(1);expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('<|code_to_edit|>');expect(body.stream).toBe(false);
    fetchMock.mockImplementationOnce(async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',
      message:{content:'```ts\nx\n```'}}]}),{headers:{'content-type':'application/json'}}));
    await expect(requestNextEdit(req)).rejects.toThrow('complete replacement');
  });
});
