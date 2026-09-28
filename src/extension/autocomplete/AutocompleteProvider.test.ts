import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { setImmediate } from 'node:timers/promises';

const mocks = vi.hoisted(() => ({
  editor: undefined as unknown,
  listeners: new Map<string, (event?: unknown) => void>(),
  config: {} as Record<string, unknown>,
  request: vi.fn(),
  secretGet: vi.fn(),
  record: vi.fn(),
  contextRevision: 0,
  allowed: vi.fn(),
  collect: vi.fn(),
  comments: vi.fn(),
  contextDispose: vi.fn(),
}));

vi.mock('vscode', () => {
  const listen = (name: string) => (listener: (event?: unknown) => void) => {
    mocks.listeners.set(name, listener);
    return { dispose: vi.fn() };
  };
  return {
    workspace: {
      isTrusted: true,
      getWorkspaceFolder: () => ({ uri: { toString: () => 'file:///' } }),
      asRelativePath: (uri: vscode.Uri) => uri.toString().replace(/^file:\/\/\//, ''),
      onDidChangeTextDocument: listen('text'),
      onDidChangeConfiguration: listen('configuration'),
      getConfiguration: (section: string) => ({
        get: (key: string, fallback: unknown) => section === 'editor'
          ? true : mocks.config[key] ?? fallback,
        inspect: (key: string) => ({ globalValue: mocks.config[key] }),
      }),
    },
    window: {
      get activeTextEditor() { return mocks.editor; },
      onDidChangeActiveTextEditor: listen('editor'),
      onDidChangeTextEditorSelection: listen('selection'),
    },
    languages: { match: () => 0 },
    EndOfLine: { LF: 1, CRLF: 2 },
    InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
    EventEmitter: class {
      private readonly listeners = new Set<(event?: unknown) => void>();
      event = (listener: (event?: unknown) => void) => {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
      };
      fire(value?: unknown) { for (const listener of this.listeners) listener(value); }
      dispose() { this.listeners.clear(); }
    },
    Position: class {
      constructor(public line: number, public character: number) {}
      isEqual(other: vscode.Position) { return this.line === other.line && this.character === other.character; }
    },
    Range: class {
      constructor(public start: vscode.Position, public end: vscode.Position) {}
    },
    InlineCompletionItem: class {
      constructor(public insertText: string, public range: vscode.Range) {}
    },
  };
});

vi.mock('../../runtime/autocomplete/requestCompletion', () => ({ requestCompletion: mocks.request }));
vi.mock('./context/CompletionContextService', () => ({
  CompletionContextService: class {
    onDidChangeContext(listener: () => void) {
      mocks.listeners.set('context', listener);
      return { dispose: () => { mocks.listeners.delete('context'); } };
    }
    revisionFor() { return mocks.contextRevision; }
    isAllowed = mocks.allowed;
    collect = mocks.collect;
    dispose = mocks.contextDispose;
  },
}));
vi.mock('./context/LanguageComments', () => ({ readLanguageComments: mocks.comments }));

import { AutocompleteProvider } from './AutocompleteProvider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function position(line: number, character: number): vscode.Position {
  return {
    line, character,
    isEqual: (other: vscode.Position) => line === other.line && character === other.character,
  } as vscode.Position;
}

function document(text = 'const answer = ', uri = 'file:///sample.ts', eol = 1) {
  const state = { text };
  const value = {
    version: 1,
    isClosed: false,
    eol,
    languageId: 'typescript',
    uri: { scheme: 'file', toString: () => uri },
    getText: () => state.text,
    lineAt: (point: vscode.Position) => ({ text: state.text.split(/\r?\n/)[point.line] }),
    offsetAt: (point: vscode.Position) => {
      const lines = state.text.split('\n');
      return lines.slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) + point.character;
    },
  } as unknown as vscode.TextDocument;
  const at = (offset = state.text.length) => {
    const lines = state.text.slice(0, offset).split('\n');
    return position(lines.length - 1, lines[lines.length - 1].length);
  };
  return { value, state, at };
}

function activate(file: vscode.TextDocument, point: vscode.Position) {
  const selection = { isEmpty: true, active: point };
  mocks.editor = { document: file, selection, selections: [selection] };
}

function cancellation() {
  let listener: (() => void) | undefined;
  const token: vscode.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: (callback: (event: unknown) => unknown) => {
      listener = () => { callback(undefined); };
      return { dispose: vi.fn() };
    },
  };
  return {
    token,
    cancel: () => {
      Object.assign(token, { isCancellationRequested: true });
      listener?.();
    },
  };
}

const context = { triggerKind: 0, selectedCompletionInfo: undefined } as vscode.InlineCompletionContext;
let provider: AutocompleteProvider;

beforeEach(() => {
  mocks.listeners.clear();
  mocks.editor = undefined;
  mocks.config = { enabled: true, relatedFiles: true, excludePatterns: [], debounceMs: 100 };
  mocks.contextRevision = 0;
  mocks.allowed.mockReset().mockResolvedValue(true);
  mocks.collect.mockReset().mockResolvedValue([]);
  mocks.comments.mockReset().mockResolvedValue({ line: '//' });
  mocks.contextDispose.mockReset();
  mocks.request.mockReset();
  mocks.record.mockReset();
  mocks.secretGet.mockReset().mockResolvedValue('synthetic-provider-key');
  provider = new AutocompleteProvider({
    get: mocks.secretGet,
    onDidChange: (listener: (event: unknown) => void) => {
      mocks.listeners.set('secret', listener);
      return { dispose: vi.fn() };
    },
  } as unknown as vscode.SecretStorage, { record: mocks.record });
});

afterEach(() => provider.dispose());

async function requesting(
  file: ReturnType<typeof document>, offset?: number, completionContext = context,
) {
  const point = file.at(offset);
  activate(file.value, point);
  const cancel = cancellation();
  const pending = provider.provideInlineCompletionItems(file.value, point, completionContext, cancel.token);
  // Flush asynchronous policy, SecretStorage and context work without relying on wall-clock delays.
  await setImmediate();
  return { pending, cancel, point };
}

describe('AutocompleteProvider', () => {

  it.each([['LF', '\n', 1], ['CRLF', '\r\n', 2]] as const)(
    'keeps a multiline %s suggestion on the empty cursor line, including cache reuse', async (_name, eol, endOfLine) => {
      const file = document('# sort values' + eol + eol + 'print(values)', 'file:///sample.py', endOfLine);
      const at = '# sort values'.length + eol.length;
      const body = 'def sort(values):' + eol + '    return sorted(values)';
      mocks.request.mockResolvedValue(body + eol + eol);
      const first = (await (await requesting(file, at)).pending)[0];
      const cached = (await (await requesting(file, at)).pending)[0];
      for (const item of [first, cached]) {
        expect(item.insertText).toBe(body);
        expect(item.range?.start.isEqual(file.at(at))).toBe(true);
        expect(item.range?.end.isEqual(file.at(at))).toBe(true);
        expect(file.state.text.slice(0, at) + item.insertText + file.state.text.slice(at))
          .toBe('# sort values' + eol + body + eol + 'print(values)');
      }
      expect(mocks.request).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['v', 'values.sort()'])('does not restore discarded terminal blank lines after typing %s', async (typed) => {
    const prefix = '# sort values\n';
    const suffix = '\nprint(values)';
    const file = document(prefix + suffix, 'file:///sample.py');
    mocks.request.mockResolvedValue('values.sort()\n');
    const item = (await (await requesting(file, prefix.length)).pending)[0];
    expect(item.insertText).toBe('values.sort()');
    file.state.text = prefix + typed + suffix;
    Object.assign(file.value, { version: 2 });
    const remaining = await (await requesting(file, prefix.length + typed.length)).pending;
    expect(remaining.map((entry) => entry.insertText)).toEqual(typed.length === 1 ? ['alues.sort()'] : []);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('preserves following code using a same-line replacement for a newline-terminated insertion', async () => {
    const file = document('# insert function\nprint(values)', 'file:///sample.py');
    const offset = file.state.text.indexOf('print');
    const body = 'def sort(values):\n    return sorted(values)\n';
    mocks.request.mockResolvedValue(body);
    const item = (await (await requesting(file, offset)).pending)[0];
    expect(item.range?.start.isEqual(file.at(offset))).toBe(true);
    expect(item.range?.end?.line).toBe(1);
    expect(item.range?.end?.character).toBe('print(values)'.length);
    expect(item.insertText).toBe(body + 'print(values)');
  });

  it('omits only terminal line breaks at an empty EOF, preserving interior blank lines', async () => {
    const file = document('# insert function\n', 'file:///sample.py');
    mocks.request.mockResolvedValue('def run():\n\n    return 1\n');
    const item = (await (await requesting(file)).pending)[0];
    expect(item.insertText).toBe('def run():\n\n    return 1');
  });

  it.each(['\nprint(values)\n', 'print(values)', '    return 1\n'])(
    'leaves nonmatching newline or indented insertions unchanged (%#)', async (body) => {
      const file = document('def run():\n    ', 'file:///sample.py');
      mocks.request.mockResolvedValue(body);
      expect((await (await requesting(file)).pending)[0].insertText).toBe(body);
    },
  );

  it('keeps the selected candidate range and text while adapting an empty-line completion', async () => {
    const file = document('# function\n', 'file:///sample.py');
    const at = file.at();
    const range = new vscode.Range(at, at);
    mocks.request.mockResolvedValue('():\n    return 1\n');
    const item = (await (await requesting(file, undefined, { ...context, selectedCompletionInfo: { range, text: 'def run' } })).pending)[0];
    expect(item.range).toBe(range);
    expect(item.insertText).toBe('def run():\n    return 1');
  });

  it.each(['metadata-only', 'another document'])('keeps the current request alive after a %s document event', async (kind) => {
    const response = deferred<string>();
    const file = document();
    mocks.request.mockReturnValue(response.promise);
    const first = await requesting(file);
    mocks.listeners.get('text')?.({
      document: kind === 'another document' ? document('log data', 'output:///diagnostics').value : file.value,
      contentChanges: kind === 'another document' ? [{ text: 'log updated' }] : [],
    });
    expect(mocks.request.mock.calls[0][0].signal.aborted).toBe(false);
    response.resolve('42');
    expect((await first.pending)[0].insertText).toBe('42');
  });

  it.each([
    ['value', 'suggestion-returned'], ['', 'empty'], ['\n  ', 'empty'], ['value\n' + '```', 'format-rejected'],
  ])('records the actual result decision without retaining completion contents (%#)', async (response, outcome) => {
    mocks.request.mockResolvedValue(response);
    await (await requesting(document('sensitiveSource = '))).pending;
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      name: 'autocomplete.result', attributes: expect.objectContaining({ outcome, receivedCharacters: response.length }),
    }));
    const log = JSON.stringify(mocks.record.mock.calls);
    expect(log).not.toContain('sensitiveSource');
    expect(log).not.toContain('synthetic-provider-key');
    expect(log).not.toContain('value');
  });

  it('distinguishes an already-present response from a new suggestion in diagnostics', async () => {
    mocks.request.mockResolvedValue('existing()');
    expect(await (await requesting(document('return existing()'), 7)).pending).toEqual([]);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      name: 'autocomplete.result', attributes: expect.objectContaining({ outcome: 'already-present' }),
    }));
  });

  it('records transport cancellation with its stage and cause', async () => {
    const response = deferred<string>();
    mocks.request.mockReturnValue(response.promise);
    const first = await requesting(document());
    first.cancel.cancel();
    response.resolve('late');
    expect(await first.pending).toEqual([]);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      name: 'autocomplete.cancelled', attributes: expect.objectContaining({ phase: 'request', reason: 'editor-token' }),
    }));
  });

  it('sends both sides of the cursor and inserts only at the cursor in the middle of a line', async () => {
    const file = document('run();');
    mocks.request.mockResolvedValue('value');
    const { pending, point } = await requesting(file, 4);
    const items = await pending;
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'run(', suffix: ');' }));
    expect(items[0].insertText).toBe('value');
    expect(items[0].range?.start).toBe(point);
    expect(items[0].range?.end).toBe(point);
  });

  it('aborts a stale request after typing and does not let it overwrite the new suggestion', async () => {
    const old = deferred<string>();
    const file = document();
    mocks.request.mockReturnValueOnce(old.promise).mockResolvedValueOnce('42');
    const first = await requesting(file);
    file.state.text += '4';
    Object.assign(file.value, { version: 2 });
    mocks.listeners.get('text')?.({ document: file.value, contentChanges: [{ text: '4' }] });
    expect(mocks.request.mock.calls[0][0].signal.aborted).toBe(true);
    const next = await requesting(file);
    expect((await next.pending)[0].insertText).toBe('42');
    old.resolve('old answer');
    expect(await first.pending).toEqual([]);
    expect((await (await requesting(file)).pending)[0].insertText).toBe('42');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('aborts for cancellation and rejects a response even if the transport ignores abort', async () => {
    const response = deferred<string>();
    mocks.request.mockReturnValue(response.promise);
    const request = await requesting(document());
    request.cancel.cancel();
    expect(mocks.request.mock.calls[0][0].signal.aborted).toBe(true);
    response.resolve('late');
    expect(await request.pending).toEqual([]);
    expect(provider.isLoading).toBe(false);
  });

  it('does not start a request when cancelled during SecretStorage lookup', async () => {
    const secret = deferred<string>();
    mocks.secretGet.mockReturnValue(secret.promise);
    const request = await requesting(document());
    request.cancel.cancel();
    secret.resolve('synthetic-provider-key');
    expect(await request.pending).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(['editor switch', 'document version', 'selection move', 'document close'])('discards a response after %s', async (change) => {
    const response = deferred<string>();
    const file = document();
    mocks.request.mockReturnValue(response.promise);
    const request = await requesting(file);
    if (change === 'editor switch') {
      const other = document('let b = ', 'file:///other.ts');
      activate(other.value, other.at());
      mocks.listeners.get('editor')?.();
    }
    if (change === 'document version') Object.assign(file.value, { version: 2 });
    if (change === 'selection move') {
      activate(file.value, file.at(0));
      const editor = mocks.editor as { selections: unknown[] };
      mocks.listeners.get('selection')?.({ textEditor: editor, selections: editor.selections });
    }
    if (change === 'document close') Object.assign(file.value, { isClosed: true });
    response.resolve('late');
    expect(await request.pending).toEqual([]);
  });

  it('reuses remaining suggestion text after forward typing without another model request', async () => {
    const file = document();
    mocks.request.mockResolvedValue('calculate()');
    await (await requesting(file)).pending;
    file.state.text += 'calc';
    Object.assign(file.value, { version: 2 });
    expect((await (await requesting(file)).pending)[0].insertText).toBe('ulate()');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('reuses a multiline suggestion after its first line was typed in a CRLF document', async () => {
    const file = document('function run() {\r\n', 'file:///windows.ts', 2);
    mocks.request.mockResolvedValue('  first();\n  second();');
    expect((await (await requesting(file)).pending)[0].insertText).toBe('  first();\r\n  second();');
    file.state.text += '  first();\r\n';
    Object.assign(file.value, { version: 2 });
    expect((await (await requesting(file)).pending)[0].insertText).toBe('  second();');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('hides the Java trailing-fence response, caches its rejection and recovers after a manual reset', async () => {
    const prefix = 'class CompletionSample {\n  static int weightedScore(int[] values) {\n    int total = 0;\n';
    const suffix = '    return total;\n  }\n}';
    const valid = '    for (int i = 0; i < values.length; i++) {\n      total += (i + 1) * values[i];\n    }\n';
    const file = document(prefix + suffix, 'file:///CompletionSample.java');
    Object.assign(file.value, { languageId: 'java' });
    mocks.collect.mockResolvedValue([{
      uri: 'file:///Score.java', filepath: 'Score.java', content: 'class Score {}', source: 'openFile',
    }]);
    mocks.request.mockResolvedValueOnce(valid + '\n```').mockResolvedValueOnce(valid);
    expect(await (await requesting(file, prefix.length)).pending).toEqual([]);
    expect(provider.lastMessage).toBe('Autocomplete response included ambiguous code fences. Suggestion hidden; use Request suggestion / retry.');
    expect(provider.lastContextFileCount).toBe(1);
    expect(provider.lastLatencyMs).toEqual(expect.any(Number));
    expect(await (await requesting(file, prefix.length, { ...context, triggerKind: 1 })).pending).toEqual([]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    provider.reset();
    const item = (await (await requesting(file, prefix.length)).pending)[0];
    expect(item.range?.start.line).toBe(item.range?.end.line);
    expect(file.state.text.slice(0, file.value.offsetAt(item.range!.start)) + item.insertText +
      file.state.text.slice(file.value.offsetAt(item.range!.end))).toBe(prefix + valid + suffix);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(provider.lastMessage).toBeUndefined();
  });

  it.each(['changed text', 'another document'])('does not impose a global cooldown after a rejected fence for %s', async (change) => {
    const original = document('int result = ', 'file:///Sample.java');
    Object.assign(original.value, { languageId: 'java' });
    mocks.request.mockResolvedValueOnce('42;\n```').mockResolvedValueOnce('42;');
    expect(await (await requesting(original)).pending).toEqual([]);
    const next = change === 'another document' ? document('int result = ', 'file:///Other.java') : original;
    Object.assign(next.value, { languageId: 'java' });
    if (change === 'changed text') {
      original.state.text = 'int updatedResult = ';
      Object.assign(original.value, { version: 2 });
      mocks.listeners.get('text')?.({ document: original.value, contentChanges: [{ text: 'updated' }] });
    }
    expect((await (await requesting(next, undefined, { ...context, triggerKind: 1 })).pending)[0].insertText).toBe('42;');
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(provider.lastMessage).toBeUndefined();
  });

  it('preserves a closing code fence when completing an actual Markdown code block', async () => {
    const file = document('## Example\n\n```java\n', 'file:///example.md');
    Object.assign(file.value, { languageId: 'markdown' });
    const completion = 'for (int i = 0; i < values.length; i++) {\n  total += (i + 1) * values[i];\n}\n```';
    mocks.request.mockResolvedValue(completion);
    expect((await (await requesting(file)).pending)[0].insertText).toBe(completion);
    expect(provider.lastMessage).toBeUndefined();
  });

  it('does not repeat requests for a cached empty result', async () => {
    const file = document();
    mocks.request.mockResolvedValue('');
    expect(await (await requesting(file)).pending).toEqual([]);
    expect(await (await requesting(file)).pending).toEqual([]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it.each(['configuration', 'secret'])('invalidates cached suggestions when %s changes', async (change) => {
    const file = document();
    mocks.request.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    await (await requesting(file)).pending;
    mocks.listeners.get(change)?.(change === 'configuration'
      ? { affectsConfiguration: () => true }
      : { key: 'droidvisx.autocomplete.key.test' });
    expect((await (await requesting(file)).pending)[0].insertText).toBe('new');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending suggestion when disabled', async () => {
    const response = deferred<string>();
    const file = document();
    mocks.request.mockReturnValue(response.promise);
    const request = await requesting(file);
    mocks.config.enabled = false;
    mocks.listeners.get('configuration')?.({ affectsConfiguration: () => true });
    response.resolve('old');
    expect(await request.pending).toEqual([]);
    expect(await (await requesting(file)).pending).toEqual([]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('shows an error and backs off automatic requests while allowing a manual retry', async () => {
    const file = document();
    mocks.request.mockRejectedValueOnce(new Error('private provider payload'));
    expect(await (await requesting(file)).pending).toEqual([]);
    expect(provider.lastMessage).toContain('Autocomplete failed');
    const point = file.at();
    expect(await provider.provideInlineCompletionItems(file.value, point, { ...context, triggerKind: 1 }, cancellation().token)).toEqual([]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.request.mockResolvedValue('42');
    expect((await (await requesting(file)).pending)[0].insertText).toBe('42');
    expect(provider.lastMessage).toBeUndefined();
  });

  it('passes related-file snippets into the model prompt and reports their count', async () => {
    const file = document('const total = calculate(');
    mocks.collect.mockResolvedValue([{
      uri: 'file:///math.ts', filepath: 'lib/math.ts',
      content: 'export function calculate(value: number): number { return value * 2; }',
      source: 'definition', version: 4,
    }]);
    mocks.request.mockResolvedValue('amount)');
    const { pending, point } = await requesting(file);
    expect((await pending)[0].insertText).toBe('amount)');
    const sent = mocks.request.mock.calls[0][0];
    expect(sent.prefix).toContain('+++++ lib/math.ts\nexport function calculate');
    expect(sent.prefix).toContain('+++++ sample.ts\nconst total = calculate(');
    expect(sent.suffix).toBe('');
    expect(mocks.collect).toHaveBeenCalledWith(file.value, point, expect.objectContaining({
      maxCharacters: 4800, excludePatterns: [], signal: expect.any(AbortSignal),
    }));
    expect(provider.lastContextFileCount).toBe(1);
  });

  it('uses installed language comment metadata when sending references to a non-Codestral model', async () => {
    mocks.config.model = 'code-completion-model';
    mocks.comments.mockResolvedValue({ line: '--' });
    mocks.collect.mockResolvedValue([{
      uri: 'file:///table.lua', filepath: 'table.lua', content: 'local answer = 42', source: 'openFile',
    }]);
    const file = document('return answer');
    Object.assign(file.value, { languageId: 'lua' });
    mocks.request.mockResolvedValue(' + 1');
    await (await requesting(file)).pending;
    expect(mocks.comments).toHaveBeenCalledWith('lua', mocks.request.mock.calls[0][0].signal);
    expect(mocks.request.mock.calls[0][0].prefix).toContain('-- Reference file: table.lua\n-- local answer = 42');
  });

  it('does not collect related source files or language metadata when relatedFiles is disabled', async () => {
    mocks.config.relatedFiles = false;
    mocks.collect.mockResolvedValue([{
      uri: 'file:///other.ts', filepath: 'other.ts', content: 'unrequested source', source: 'openFile',
    }]);
    mocks.request.mockResolvedValue('42');
    await (await requesting(document())).pending;
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.comments).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls[0][0].prefix).toBe('const answer = ');
    expect(provider.lastContextFileCount).toBe(0);
  });

  it('discards a pending model response if another source file changes the context revision', async () => {
    const response = deferred<string>();
    const file = document();
    mocks.request.mockReturnValueOnce(response.promise).mockResolvedValueOnce('fresh');
    const first = await requesting(file);
    mocks.contextRevision += 1;
    response.resolve('stale');
    expect(await first.pending).toEqual([]);
    expect((await (await requesting(file)).pending)[0].insertText).toBe('fresh');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('invalidates a cached suggestion when the related context revision changes', async () => {
    const file = document();
    mocks.request.mockResolvedValueOnce('oldDefinition()').mockResolvedValueOnce('newDefinition()');
    expect((await (await requesting(file)).pending)[0].insertText).toBe('oldDefinition()');
    mocks.contextRevision += 1;
    expect((await (await requesting(file)).pending)[0].insertText).toBe('newDefinition()');
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.collect).toHaveBeenCalledTimes(2);
  });

  it('does not send a model request when the context changes while snippets are being collected', async () => {
    const snippets = deferred<[]>();
    mocks.collect.mockReturnValue(snippets.promise);
    const first = await requesting(document());
    mocks.contextRevision += 1;
    snippets.resolve([]);
    expect(await first.pending).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('extends the selected language-server item on its range and requests code after the replacement', async () => {
    const file = document('console.lo();');
    const selected = { range: new vscode.Range(position(0, 8), position(0, 10)), text: 'log' };
    mocks.request.mockResolvedValue('Info');
    const result = await (await requesting(file, 10, { ...context, selectedCompletionInfo: selected })).pending;
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'console.log', suffix: '();' }));
    expect(result[0].insertText).toBe('logInfo');
    expect(result[0].range).toBe(selected.range);
  });

  it('allows an unauthenticated local Ollama model without a stored key', async () => {
    mocks.config.protocol = 'ollama';
    mocks.config.endpoint = 'http://localhost:11434/api/generate';
    mocks.config.model = 'qwen2.5-coder:7b-base';
    mocks.secretGet.mockResolvedValue(undefined);
    mocks.request.mockResolvedValue('42');
    expect((await (await requesting(document())).pending)[0].insertText).toBe('42');
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      protocol: 'ollama', endpoint: 'http://localhost:11434/api/generate',
      model: 'qwen2.5-coder:7b-base', apiKey: '',
    }));
    expect(provider.lastMessage).toBeUndefined();
  });

  it('does not read credentials, collect context or send ignored main-file contents to the model', async () => {
    mocks.allowed.mockResolvedValue(false);
    expect(await (await requesting(document())).pending).toEqual([]);
    expect(mocks.secretGet).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(provider.lastMessage).toContain('excluded');
  });

  it('immediately aborts an in-flight request when external context changes', async () => {
    const response = deferred<string>();
    const invalidated = vi.fn();
    provider.onDidInvalidateSuggestion(invalidated);
    mocks.request.mockReturnValue(response.promise);
    const first = await requesting(document());
    const signal = mocks.request.mock.calls[0][0].signal as AbortSignal;
    mocks.contextRevision += 1;
    mocks.listeners.get('context')?.();
    expect(signal.aborted).toBe(true);
    expect(provider.isLoading).toBe(false);
    expect(invalidated).toHaveBeenCalledOnce();
    response.resolve('obsolete code');
    expect(await first.pending).toEqual([]);
  });

  it('invalidates an already-issued suggestion immediately when its external context changes', async () => {
    const invalidated = vi.fn();
    provider.onDidInvalidateSuggestion(invalidated);
    const file = document();
    mocks.request.mockResolvedValueOnce('oldDefinition()').mockResolvedValueOnce('freshDefinition()');
    expect((await (await requesting(file)).pending)[0].insertText).toBe('oldDefinition()');
    mocks.contextRevision += 1;
    mocks.listeners.get('context')?.();
    expect(invalidated).toHaveBeenCalledOnce();
    expect((await (await requesting(file)).pending)[0].insertText).toBe('freshDefinition()');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('keeps the suggestion remainder when only the current file advances through it', async () => {
    const invalidated = vi.fn();
    provider.onDidInvalidateSuggestion(invalidated);
    const file = document();
    mocks.request.mockResolvedValue('calculate()');
    await (await requesting(file)).pending;
    file.state.text += 'calc';
    Object.assign(file.value, { version: 2 });
    // revisionFor(currentFile) excludes this file's own edit; the context event still fires.
    mocks.listeners.get('context')?.();
    mocks.listeners.get('text')?.({ document: file.value, contentChanges: [{ text: '4' }] });
    expect(invalidated).not.toHaveBeenCalled();
    expect((await (await requesting(file)).pending)[0].insertText).toBe('ulate()');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
