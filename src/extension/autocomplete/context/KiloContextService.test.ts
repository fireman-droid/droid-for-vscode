import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vscode from 'vscode';

const state = vi.hoisted(() => ({
  documents: [] as vscode.TextDocument[], roots: [] as vscode.Uri[], editor: undefined as vscode.TextEditor | undefined,
  config: {} as Record<string, unknown>, events: new Map<string, Set<(event: any) => void>>(),
  definitions: vi.fn(), clipboard: vi.fn(), matches: vi.fn(() => 0), files: [] as vscode.Uri[],
}));
vi.mock('vscode', () => {
  const listen = (name: string) => (callback: (event: any) => void) => {
    const set = state.events.get(name) ?? new Set(); state.events.set(name, set); set.add(callback);
    return { dispose: () => set.delete(callback) };
  };
  class Position { constructor(public line: number, public character: number) {} }
  class Range {
    constructor(public start: Position, public end: Position) {}
    intersection(other: Range) { return this.end.line < other.start.line || other.end.line < this.start.line ? undefined : this; }
    union(other: Range) { return new Range(this.start.line < other.start.line ? this.start : other.start, this.end.line > other.end.line ? this.end : other.end); }
  }
  return {
    Uri: { parse: (value: string) => makeUri(value.startsWith('file:') ? fileURLToPath(value) : value), file: (file: string) => makeUri(file) },
    Position, Range, RelativePattern: class { constructor(public base: any, public pattern: string) {} },
    workspace: {
      isTrusted: true, notebookDocuments: [],
      get textDocuments() { return state.documents; },
      getWorkspaceFolder: (uri: vscode.Uri) => { const root = state.roots.find(r => uri.fsPath.startsWith(r.fsPath + path.sep)); return root ? { uri: root } : undefined; },
      asRelativePath: (uri: vscode.Uri) => path.relative(state.roots[0].fsPath, uri.fsPath).replace(/\\/g, '/'),
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => state.config[key] ?? fallback, inspect: (key: string) => ({ globalValue: state.config[key] }) }),
      onDidChangeTextDocument: listen('text'), onDidOpenTextDocument: listen('open'), onDidCloseTextDocument: listen('close'),
      findFiles: async () => state.files,
    },
    window: { get activeTextEditor() { return state.editor; }, onDidChangeActiveTextEditor: listen('active'), onDidChangeTextEditorSelection: listen('selection') },
    languages: { match: (...args: unknown[]) => state.matches(...args as []) },
    commands: { executeCommand: (...args: unknown[]) => state.definitions(...args) },
    env: { clipboard: { readText: state.clipboard } },
  };
});
import { KiloContextService } from './KiloContextService';
import { KiloContextIde } from './KiloContextIde';
import type { ContextSnippet } from './CompletionContextService';
import { configureParserAssets, withParserResources } from '../kilo/continuedev/core/util/treeSitter';
import { getAst } from '../kilo/continuedev/core/autocomplete/util/ast';
import { readCompletionSettings } from '../settings';

let root: string, service: KiloContextService | undefined;
let assets: string;
function makeUri(file: string): vscode.Uri {
  const full = path.resolve(file);
  return { scheme: 'file', fsPath: full, path: full.replace(/\\/g, '/'), toString: () => pathToFileURL(full).toString() } as vscode.Uri;
}
function emit(name: string, value: unknown) { state.events.get(name)?.forEach(callback => callback(value)); }
async function document(name: string, text: string, languageId = 'typescript', open = true) {
  const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text);
  const doc = { uri: makeUri(file), fileName: file, isUntitled: false, version: 1, isClosed: false, languageId,
    lineCount: text.split('\n').length, getText: () => text } as vscode.TextDocument;
  if (open) state.documents.push(doc);
  state.files.push(doc.uri);
  return doc;
}
async function build(doc: vscode.TextDocument, offset = doc.getText().length, signal = new AbortController().signal) {
  state.editor = { document: doc } as vscode.TextEditor;
  service ??= new KiloContextService();
  return service.build({ document: doc, text: doc.getText(), offset, settings: readCompletionSettings(), signal,
    filepath: path.basename(doc.uri.fsPath), snippets: [], comments: { line: '//' } });
}
beforeAll(async () => {
  assets = await mkdtemp(path.join(tmpdir(), 'droid-parser-assets-'));
  const require = createRequire(import.meta.url);
  cpSync(path.join(path.dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm'), path.join(assets, 'tree-sitter.wasm'));
  cpSync(path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out'), path.join(assets, 'grammars'), { recursive: true });
  cpSync('src/extension/autocomplete/kilo/continuedev/tree-sitter', path.join(assets, 'queries'), { recursive: true });
  configureParserAssets(assets);
  return async () => { if (path.dirname(assets) !== path.resolve(tmpdir())) throw Error('unexpected temp path'); await rm(assets, { recursive: true, force: true }); };
});
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'droid-kilo-context-'));
  state.documents = []; state.roots = [makeUri(root)]; state.editor = undefined; state.events.clear(); state.files = [];
  state.config = { enabled: true, relatedFiles: true, excludePatterns: [], model: 'codestral-latest' };
  state.definitions.mockReset().mockImplementation(async name => name === "vscode.executeSignatureHelpProvider" ? undefined : []); state.clipboard.mockReset().mockResolvedValue('clipboardOnlyExample'); state.matches.mockReset().mockReturnValue(0);
});
afterEach(async () => {
  service?.dispose(); service = undefined;
  if (path.dirname(root) !== path.resolve(tmpdir())) throw Error('unexpected temp path');
  await rm(root, { recursive: true, force: true });
});

describe('Kilo production context pipeline', () => {
  it.each([
    ['go', 'package main\nfunc greet() {\n}\n'],
    ['java', 'class Example { void greet() {} }'],
    ['ts', 'function greet(): string { return "hello"; }'],
  ])('loads the bundled %s grammar and parses source', async (extension, text) => {
    await withParserResources(async () => {
      const ast = await getAst('example.' + extension, text);
      expect(ast?.rootNode.hasError).toBe(false);
      expect(ast?.rootNode.text).toBe(text);
    });
  });
  it('retrieves a closed imported definition through AST queries and preserves unsaved current text', async () => {
    const text = "import { User } from './types';\nfunction greet(user: User) {\n  return \n}";
    const doc = await document('main.ts', text);
    const target = await document('types.ts', 'export type User = { name: string };', 'typescript', false);
    state.definitions.mockResolvedValue([{ uri: target.uri, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } }]);
    const prompt = await build(doc, text.indexOf('return ') + 7);
    expect(state.definitions).toHaveBeenCalled();
    expect(prompt.prefix).toContain('export type User = { name: string };');
    expect(prompt.prefix).toContain('+++++ types.ts');
    expect(prompt.prefix.endsWith('  return ')).toBe(true);
    expect(prompt.suffix).toBe('\n}');
  });
  it('applies ignore rules before selecting opened files and rechecks after unsaved ignore edits', async () => {
    const main = await document('main.ts', 'const answer = \n');
    await document('private.ts', 'privateWorkspaceValue');
    await document('safe.ts', 'safeWorkspaceValue');
    const ignore = await document('.droidignore', 'private.ts', 'plaintext');
    const first = await build(main, 15);
    expect(first.prefix).toContain('safeWorkspaceValue'); expect(first.prefix).not.toContain('privateWorkspaceValue');
    Object.assign(ignore, { getText: () => 'private.ts\nsafe.ts', version: 2 });
    emit('text', { document: ignore, contentChanges: [{ range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)) }] });
    const second = await build(main, 15);
    expect(second.prefix).not.toContain('safeWorkspaceValue');
  });
  it('keeps Mercury template markers intact under the full character budget', async () => {
    state.config.model = 'mercury-edit-2'; state.config.maxContextCharacters = 1000;
    const text = 'let padding = 1;\n'.repeat(300) + '// insert here\n\n';
    const doc = await document('main.ts', text);
    const prompt = await build(doc, text.length - 1);
    expect(prompt.prefix.startsWith('<|fim_prefix|>')).toBe(true);
    expect(prompt.prefix.endsWith('// insert here\n')).toBe(true);
    expect(prompt.prefix.length + prompt.suffix.length).toBeLessThanOrEqual(1000);
  });
  it('only reads and includes clipboard context after explicit user opt-in', async () => {
    const doc = await document('main.ts', 'const answer = \n');
    expect((await build(doc, 15)).prefix).not.toContain('clipboardOnlyExample'); expect(state.clipboard).not.toHaveBeenCalled();
    state.config.includeClipboard = true;
    expect((await build(doc, 15)).prefix).toContain('clipboardOnlyExample'); expect(state.clipboard).toHaveBeenCalledOnce();
  });
  it('cancels a pending language server lookup without waiting for that provider', async () => {
    const doc = await document('main.ts', "import { User } from './types';\nconst user: User = \n");
    let resolveLookup!: () => void;
    const entered = new Promise<void>(resolve => { resolveLookup = resolve; });
    state.definitions.mockImplementation(() => { resolveLookup(); return new Promise(() => {}); });
    const controller = new AbortController();
    const pending = build(doc, doc.getText().length - 1, controller.signal);
    await entered; controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps recent edits from different files separate and rejects excluded static candidates', async () => {
    const main = await document('main.ts', 'const answer = \n');
    const a = await document('a.ts', 'alphaEditedContext'); const b = await document('b.ts', 'betaEditedContext');
    await build(main, 15);
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 2));
    emit('text', { document: a, contentChanges: [{ range }] });
    emit('text', { document: b, contentChanges: [{ range }] });
    await new Promise(resolve => setImmediate(resolve));
    const ide = new KiloContextIde();
    state.matches.mockImplementation((...args: unknown[]) => (args[1] as vscode.TextDocument).uri.toString() === b.uri.toString() ? 10 : 0);
    state.config.excludePatterns = ['**/b.ts'];
    expect(await ide.findWorkspaceFiles('**/*.ts')).not.toContain(b.uri.toString());
    expect(await ide.readFile(b.uri.toString())).toBe(''); ide.dispose();
    const prompt = await build(main, 15); expect(prompt.prefix).toContain('alphaEditedContext'); expect(prompt.prefix).not.toContain('betaEditedContext');
  });
});

describe('optional Kilo static context', () => {
  it('retrieves matching typed headers through the same file policy', async () => {
    state.config.staticContext = true;
    const text = 'function answer(): number {\n  return \n}\n';
    const main = await document('main.ts', text);
    await document('helpers.ts', 'export const numberAnswer: number = 42;\nexport const textAnswer: string = "no";\n', 'typescript', false);
    const prompt = await build(main, text.indexOf('return ') + 7);
    expect(prompt.prefix).toContain('numberAnswer');
    expect(prompt.prefix).not.toContain('textAnswer');
  });
});

describe('recursive static types', () => {
  it('finishes context retrieval for a recursive callback return type', async () => {
    state.config.staticContext = true;
    const text = "import { Handler } from './types';\nfunction next(): Handler {\n  return \n}\n";
    const main = await document('main.ts', text);
    const types = await document('types.ts', 'export type Handler = () => Handler;', 'typescript', false);
    state.definitions.mockImplementation(async name => name === 'vscode.executeSignatureHelpProvider' ? undefined
      : [{ uri: types.uri, range: { start: { line: 0, character: 12 }, end: { line: 0, character: 36 } } }]);
    const prompt = await build(main, text.indexOf('return ') + 7);
    expect(prompt.prefix).toContain('Handler');
    expect(prompt.prefix.endsWith('  return ')).toBe(true);
  });
});

describe('Mercury reference context', () => {
  it('preserves allowed related definitions inside the FIM prefix instead of dropping them', async () => {
    state.config.model = 'mercury-edit-2';
    const main = await document('main.go', 'package main\nfunc main() { Quote(\n}\n', 'go');
    await document('shipping.go', 'type Zone int\nconst RemoteZone Zone = 7\nfunc Quote(weight int, zone Zone, insured bool) int { return 0 }', 'go');
    const prompt = await build(main, main.getText().indexOf('Quote(') + 6);
    expect(prompt.prefix.startsWith('<|fim_prefix|>')).toBe(true);
    expect(prompt.prefix).toContain('RemoteZone'); expect(prompt.prefix).toContain('zone Zone');
    expect(prompt.prefix.length + prompt.suffix.length).toBeLessThanOrEqual(12000);
  });
});


describe('merged Kilo and editor context', () => {
  it.each(['codestral-latest', 'mercury-edit-2'])('keeps direct definitions and recent edits alongside Kilo results for %s', async model => {
    state.config.model = model;
    const text = 'function answer() {\n  return \n}';
    const main = await document('main.ts', text);
    const definition = await document('definition.ts', 'export type Target = { fromDefinition: string };', 'typescript', false);
    const edited = await document('edited.ts', 'export const fromRecentEdit = 7;', 'typescript', false);
    const opened = await document('opened.ts', 'export const fromKiloOpened = 3;');
    const supplemental: ContextSnippet[] = [
      { uri: definition.uri.toString(), filepath: 'definition.ts', content: definition.getText(), source: 'definition' },
      { uri: edited.uri.toString(), filepath: 'edited.ts', content: edited.getText(), source: 'recentEdit' },
      { uri: opened.uri.toString(), filepath: 'opened.ts', content: opened.getText(), source: 'openFile' },
      { uri: definition.uri.toString(), filepath: 'definition.ts', content: 'fromDefinition: string', source: 'definition' },
    ];
    state.editor = { document: main } as vscode.TextEditor;
    service = new KiloContextService();
    const prompt = await service.build({ document: main, text, offset: text.indexOf('return ') + 7,
      filepath: 'main.ts', settings: readCompletionSettings(), signal: new AbortController().signal,
      snippets: supplemental, comments: { line: '//' },
    });
    expect(prompt.prefix).toContain('fromDefinition');
    expect(prompt.prefix).toContain('fromRecentEdit');
    expect(prompt.prefix).toContain('fromKiloOpened');
    expect(prompt.prefix.indexOf('fromDefinition')).toBeLessThan(prompt.prefix.indexOf('fromKiloOpened'));
    expect(prompt.prefix.match(/fromDefinition/g)).toHaveLength(1);
    expect(prompt.prefix.match(/fromKiloOpened/g)).toHaveLength(1);
  });

  it('rechecks supplemental access and preserves the full prompt budget', async () => {
    state.config.model = 'mercury-edit-2'; state.config.maxContextCharacters = 1000;
    const text = 'const current = 1;\n'.repeat(120) + 'const answer = \n';
    const main = await document('main.ts', text);
    const allowed = await document('allowed.ts', 'export const allowedDefinition = 1;\n' + '// padding\n'.repeat(300), 'typescript', false);
    const forbidden = await document('blocked.ts', 'forbiddenDefinition', 'typescript', false);
    await document('.droidignore', 'blocked.ts', 'plaintext');
    await document('opened.ts', 'kiloAvailableContext');
    state.editor = { document: main } as vscode.TextEditor;
    service = new KiloContextService();
    const snippets: ContextSnippet[] = [allowed, forbidden].map(doc => ({ uri: doc.uri.toString(), filepath: path.basename(doc.uri.fsPath),
      content: doc.getText(), source: 'definition' }));
    const input = { document: main, text, offset: text.length - 1, filepath: 'main.ts', settings: readCompletionSettings(),
      signal: new AbortController().signal, snippets, comments: { line: '//' } };
    const prompt = await service.build(input);
    expect(prompt.prefix).toContain('allowedDefinition');
    expect(prompt.prefix).not.toContain('forbiddenDefinition');
    expect(prompt.prefix.length + prompt.suffix.length).toBeLessThanOrEqual(1000);
    const disabled = await service.build({ ...input, settings: { ...input.settings, relatedFiles: false } });
    expect(disabled.prefix).not.toContain('allowedDefinition');
  });
});
