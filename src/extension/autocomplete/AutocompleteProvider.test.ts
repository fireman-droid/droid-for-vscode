import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
  editor: undefined as unknown,
  listeners: new Map<string, (event?: unknown) => void>(),
  config: {} as Record<string, unknown>,
  request: vi.fn(),
  secretGet: vi.fn(),
}));

vi.mock('vscode', () => {
  const listen = (name: string) => (listener: (event?: unknown) => void) => {
    mocks.listeners.set(name, listener);
    return { dispose: vi.fn() };
  };
  return {
    workspace: {
      isTrusted: true,
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
      event = () => ({ dispose: vi.fn() });
      fire() {}
      dispose() {}
    },
    Range: class {
      constructor(public start: vscode.Position, public end: vscode.Position) {}
    },
    InlineCompletionItem: class {
      constructor(public insertText: string, public range: vscode.Range) {}
    },
  };
});

vi.mock('../../runtime/autocomplete/FimClient', () => ({
  requestFimCompletion: mocks.request,
  FimCompletionError: class extends Error {},
}));

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
    uri: { scheme: 'file', toString: () => uri },
    getText: () => state.text,
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
  mocks.config = { enabled: true, excludePatterns: [], debounceMs: 100 };
  mocks.request.mockReset();
  mocks.secretGet.mockReset().mockResolvedValue('synthetic-provider-key');
  provider = new AutocompleteProvider({
    get: mocks.secretGet,
    onDidChange: (listener: (event: unknown) => void) => {
      mocks.listeners.set('secret', listener);
      return { dispose: vi.fn() };
    },
  } as unknown as vscode.SecretStorage);
});

afterEach(() => provider.dispose());

async function requesting(file: ReturnType<typeof document>, offset?: number) {
  const point = file.at(offset);
  activate(file.value, point);
  const cancel = cancellation();
  const pending = provider.provideInlineCompletionItems(file.value, point, context, cancel.token);
  // SecretStorage lookup is the only asynchronous step before the mocked FIM request.
  await Promise.resolve();
  return { pending, cancel, point };
}

describe('AutocompleteProvider', () => {
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
    mocks.listeners.get('text')?.({ document: file.value });
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
});
