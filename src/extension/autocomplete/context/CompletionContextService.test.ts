import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
  documents: [] as vscode.TextDocument[], roots: [] as vscode.Uri[],
  listeners: new Map<string, (event: any) => void>(),
  definition: vi.fn(), match: vi.fn(() => 0), deniedPaths: new Set<string>(),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: (file: string) => mocks.deniedPaths.has(String(file).replace(/\\/g, '/'))
    ? Promise.reject(Object.assign(new Error('Denied'), { code: 'EACCES' })) : actual.realpath(file) };
});
vi.mock('vscode', () => {
  const listen = (name: string) => (callback: (event: any) => void) => {
    mocks.listeners.set(name, callback);
    return { dispose: vi.fn() };
  };
  return {
    EventEmitter: class {
      private readonly listeners = new Set<() => void>();
      event = (listener: () => void) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
      fire() { this.listeners.forEach((listener) => listener()); }
      dispose() { this.listeners.clear(); }
    },
    workspace: {
      isTrusted: true,
      get textDocuments() { return mocks.documents; },
      getWorkspaceFolder: (uri: vscode.Uri) => {
        const root = mocks.roots.find((item) => uri.fsPath.startsWith(item.fsPath + '/'));
        return root ? { uri: root } : undefined;
      },
      createFileSystemWatcher: () => ({ dispose: vi.fn(), onDidCreate: listen('create'), onDidChange: listen('disk'), onDidDelete: listen('delete') }),
      onDidChangeTextDocument: listen('text'), onDidOpenTextDocument: listen('open'),
      onDidCloseTextDocument: listen('close'), onDidChangeWorkspaceFolders: listen('workspace'),
    },
    window: { activeTextEditor: undefined, onDidChangeActiveTextEditor: listen('active'), onDidChangeTextEditorSelection: listen('selection') },
    commands: { executeCommand: (...args: unknown[]) => mocks.definition(...args) },
    languages: { match: (...args: unknown[]) => mocks.match(...args as []) },
  };
});
import { CompletionContextService } from './CompletionContextService';

let root: string;
let service: CompletionContextService;
const position = { line: 0, character: 2, translate: (_line: number, character: number) => ({ line: 0, character: 2 + character }) } as vscode.Position;
function uri(file: string): vscode.Uri {
  const normalized = file.replace(/\\/g, '/');
  return { scheme: 'file', fsPath: normalized, toString: () => pathToFileURL(file).toString() } as vscode.Uri;
}
async function document(relative: string, text: string, languageId = 'typescript', open = true): Promise<vscode.TextDocument> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  const result = {
    uri: uri(file), languageId, version: 1, isClosed: false,
    getText: () => text,
    getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: position }),
  } as unknown as vscode.TextDocument;
  if (open) mocks.documents.push(result);
  return result;
}
function location(document: vscode.TextDocument, start = 0, end = start + 2) {
  return { uri: document.uri, range: { start: { line: start }, end: { line: end } } };
}
function collect(document: vscode.TextDocument, maxCharacters = 8000, excludePatterns: string[] = [], signal = new AbortController().signal) {
  return service.collect(document, position, { maxCharacters, excludePatterns, signal });
}
function changed(document: vscode.TextDocument, line = 0) {
  mocks.listeners.get('text')!({ document, contentChanges: [{ range: { start: { line } } }] });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'droid-context-'));
  mocks.documents = []; mocks.roots = [uri(root)]; mocks.listeners.clear(); mocks.deniedPaths.clear();
  mocks.definition.mockReset().mockResolvedValue([]); mocks.match.mockReset().mockReturnValue(0);
});
afterEach(async () => { service?.dispose(); await rm(root, { recursive: true, force: true }); vi.useRealTimers(); });

describe('CompletionContextService', () => {
  it.each(['go', 'java', 'typescript', 'vue'])('uses native %s definitions and prefers unsaved text', async (language) => {
    const main = await document('main.' + language, 'target', language);
    const target = await document('target.' + language, 'saved version', language);
    Object.assign(target, { version: 3, getText: () => 'unsaved definition' });
    mocks.definition.mockResolvedValue([location(target)]);
    service = new CompletionContextService();
    const snippets = await collect(main);
    expect(snippets).toEqual([expect.objectContaining({ content: 'unsaved definition', source: 'definition', version: 3 })]);
    expect(mocks.definition).toHaveBeenCalledWith('vscode.executeDefinitionProvider', main.uri, { line: 0, character: 0 });
  });

  it('prioritizes definitions then recent edits over opened files and deduplicates', async () => {
    const main = await document('main.ts', 'target');
    const definition = await document('types.ts', 'type Definition = string');
    const edited = await document('edited.go', 'package main');
    await document('opened.java', 'class Opened {}');
    service = new CompletionContextService();
    changed(edited);
    mocks.definition.mockResolvedValue([location(definition), location(definition)]);
    const snippets = await collect(main);
    expect(snippets.map((item) => item.filepath)).toEqual(['types.ts', 'edited.go', 'opened.java']);
    expect(snippets.map((item) => item.source)).toEqual(['definition', 'recentEdit', 'openFile']);
  });

  it.each(['foo.', 'foo.partial'])('finds the receiver definition for %s without language-specific parsing', async (text) => {
    const main = await document('main.ts', text);
    const receiver = await document('receiver.ts', 'export class Receiver {}', 'typescript', false);
    Object.assign(main, { getWordRangeAtPosition: (at: vscode.Position) => {
      if (at.character >= 0 && at.character < 3) return { start: { line: 0, character: 0 } };
      if (at.character >= 4 && text.length > 4) return { start: { line: 0, character: 4 } };
      return undefined;
    } });
    mocks.definition.mockImplementation((_command: string, _uri: vscode.Uri, at: vscode.Position) =>
      Promise.resolve(at.character === 0 ? [location(receiver)] : []));
    const point = { line: 0, character: text.length, translate: (_line: number, delta: number) => ({ line: 0, character: text.length + delta }) } as vscode.Position;
    service = new CompletionContextService();
    const snippets = await service.collect(main, point, { maxCharacters: 8000, excludePatterns: [], signal: new AbortController().signal });
    expect(snippets[0]).toEqual(expect.objectContaining({ source: 'definition', filepath: 'receiver.ts' }));
    expect(mocks.definition.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('reads a closed related definition from disk and accepts LocationLink', async () => {
    const main = await document('main.ts', 'target');
    const target = await document('lib/type.ts', 'export type Target = string;', 'typescript', false);
    mocks.definition.mockResolvedValue([{ targetUri: target.uri, targetRange: location(target).range }]);
    service = new CompletionContextService();
    expect(await collect(main)).toEqual([expect.objectContaining({ filepath: 'lib/type.ts', content: 'export type Target = string;', source: 'definition' })]);
  });

  it('does not fail when a language server is absent', async () => {
    const main = await document('main.unknown', 'target', 'plaintext');
    await document('context.go', 'package example');
    mocks.definition.mockRejectedValue(new Error('No provider'));
    service = new CompletionContextService();
    expect((await collect(main))[0].source).toBe('openFile');
  });

  it('enforces shared character budget and six-file limit', async () => {
    const main = await document('main.ts', 'target');
    for (let i = 0; i < 9; i++) await document(`file${i}.ts`, 'x'.repeat(800));
    service = new CompletionContextService();
    const short = await collect(main, 1800);
    expect(short.reduce((total, item) => total + item.content.length, 0)).toBe(1800);
    expect((await collect(main, 12000)).length).toBe(6);
  });

  it('excludes secrets, binary content, configured patterns and other workspace roots', async () => {
    const main = await document('main.ts', 'target');
    for (const [file, text] of [['.env', 'secret'], ['private.key', 'secret'], ['binary.bin', 'bad\0data'], ['skip.ts', 'excluded']]) {
      await document(file, text);
    }
    const outside = await document('second/external.ts', 'external');
    mocks.roots.unshift(uri(path.join(root, 'second')));
    mocks.match.mockImplementation((...args: unknown[]) => {
      const doc = args[1] as vscode.TextDocument;
      return doc.uri.fsPath.endsWith('skip.ts') ? 10 : 0;
    });
    mocks.definition.mockResolvedValue([location(outside)]);
    service = new CompletionContextService();
    expect(await collect(main, 8000, ['**/skip.ts'])).toEqual([]);
  });

  it('honors root and nested ignore rules, negation and unsaved ignore changes', async () => {
    const main = await document('main.ts', 'target');
    await document('root-secret.ts', 'excluded root');
    await document('sub/skip.ts', 'excluded nested');
    await document('sub/keep.ts', 'allowed exception');
    await writeFile(path.join(root, '.gitignore'), 'root-secret.ts\n');
    await writeFile(path.join(root, 'sub/.gitignore'), '*.ts\n!keep.ts\n');
    const droidIgnore = await document('.droidignore', '', 'plaintext');
    service = new CompletionContextService();
    expect((await collect(main)).map((item) => item.filepath)).toEqual(['sub/keep.ts']);
    Object.assign(droidIgnore, { getText: () => 'sub/keep.ts' });
    changed(droidIgnore);
    expect(await collect(main)).toEqual([]);
  });

  it('allows nested file negation but not resurrection through an ignored parent', async () => {
    const main = await document('main.go', 'target');
    await document('sub/keep.ts', 'keep');
    await document('sub/drop.ts', 'drop');
    await document('ignored/keep.ts', 'excluded directory');
    await writeFile(path.join(root, '.gitignore'), '*.ts\nignored/\n');
    await writeFile(path.join(root, 'sub/.gitignore'), '!keep.ts\n');
    await writeFile(path.join(root, 'ignored/.gitignore'), '!keep.ts\n');
    service = new CompletionContextService();
    expect((await collect(main)).map((snippet) => snippet.filepath)).toEqual(['sub/keep.ts']);
  });

  it('keeps Git and Droid exclusions independent when either rule file has negations', async () => {
    const main = await document('main.go', 'target');
    await document('sub/git-blocked.ts', 'git exclusion');
    await document('sub/droid-blocked.ts', 'droid exclusion');
    await writeFile(path.join(root, '.gitignore'), 'git-blocked.ts\n');
    await writeFile(path.join(root, '.droidignore'), 'droid-blocked.ts\n');
    await writeFile(path.join(root, 'sub/.gitignore'), '!droid-blocked.ts\n');
    await writeFile(path.join(root, 'sub/.droidignore'), '!git-blocked.ts\n');
    service = new CompletionContextService();
    expect(await collect(main)).toEqual([]);
  });

  it('distinguishes a missing new file from an existing file with denied access', async () => {
    const denied = await document('denied.ts', 'sensitive');
    const created = await document('new.ts', 'unsaved new file');
    await rm(created.uri.fsPath);
    mocks.deniedPaths.add(denied.uri.fsPath);
    service = new CompletionContextService();
    const signal = new AbortController().signal;
    expect(await service.isAllowed(denied, [], signal)).toBe(false);
    expect(await service.isAllowed(created, [], signal)).toBe(true);
  });

  it('does not read open secrets or symlink targets outside the active root', async () => {
    await mkdir(path.join(root, 'workspace'));
    mocks.roots = [uri(path.join(root, 'workspace'))];
    const main = await document('workspace/main.ts', 'target');
    const secret = await document('workspace/.env.local', 'secret');
    const external = await document('external/type.ts', 'outside content', 'typescript', false);
    await symlink(path.join(root, 'external'), path.join(root, 'workspace/linked'), 'junction');
    const link = { ...external, uri: uri(path.join(root, 'workspace/linked/type.ts')), getText: vi.fn() } as vscode.TextDocument;
    mocks.documents.push(link);
    const readSecret = vi.fn();
    Object.assign(secret, { getText: readSecret });
    mocks.definition.mockResolvedValue([location(link)]);
    service = new CompletionContextService();
    expect(await collect(main)).toEqual([]);
    expect(readSecret).not.toHaveBeenCalled();
    expect(link.getText).not.toHaveBeenCalled();
  });

  it('centers recently visited snippets around the editor selection', async () => {
    const main = await document('main.ts', 'target');
    const related = await document('context.ts', Array.from({ length: 180 }, (_, i) => `line ${i}`).join('\n'));
    service = new CompletionContextService();
    mocks.listeners.get('selection')!({ textEditor: { document: related }, selections: [{ active: { line: 140 } }] });
    const snippets = await collect(main);
    expect(snippets[0].content).toContain('line 140');
    expect(snippets[0].content).not.toContain('line 0\n');
  });

  it('shares ignore and sensitive file gating with the primary document', async () => {
    const main = await document('ignored.ts', 'target');
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
    service = new CompletionContextService();
    expect(await service.isAllowed(main, [], new AbortController().signal)).toBe(false);
    const key = await document('token.pem', 'private');
    expect(await service.isAllowed(key, [], new AbortController().signal)).toBe(false);
  });

  it('returns no context after cancellation even if the language server resolves late', async () => {
    const main = await document('main.ts', 'target');
    const related = await document('context.ts', 'safe');
    let resolve!: (value: unknown) => void;
    mocks.definition.mockReturnValue(new Promise((done) => { resolve = done; }));
    service = new CompletionContextService();
    const abort = new AbortController();
    const result = collect(main, 8000, [], abort.signal);
    abort.abort();
    expect(await result).toEqual([]);
    resolve([location(related)]);
    await Promise.resolve();
  });

  it('limits stalled definition lookup and still uses recent context', async () => {
    const main = await document('main.ts', 'target');
    await document('context.ts', 'available');
    mocks.definition.mockReturnValue(new Promise(() => {}));
    service = new CompletionContextService();
    const started = Date.now();
    expect((await collect(main))[0]?.content).toBe('available');
    expect(Date.now() - started).toBeLessThan(600);
  });

  it('invalidates related-file changes without invalidating reuse for continued local typing', async () => {
    const main = await document('main.ts', 'target');
    const related = await document('context.ts', 'available');
    service = new CompletionContextService();
    const original = service.revisionFor(main.uri);
    changed(main);
    expect(service.revisionFor(main.uri)).toBe(original);
    changed(related);
    expect(service.revisionFor(main.uri)).toBeGreaterThan(original);
    const beforeClose = service.revisionFor(main.uri);
    mocks.listeners.get('close')!(related);
    expect(service.revisionFor(main.uri)).toBeGreaterThan(beforeClose);
  });

  it('notifies consumers after related file and ignore changes advance the context revision', async () => {
    const main = await document('main.ts', 'target');
    const related = await document('context.ts', 'available', 'typescript', false);
    mocks.definition.mockResolvedValue([location(related)]);
    service = new CompletionContextService();
    await collect(main);
    const revisions: number[] = [];
    const subscription = service.onDidChangeContext(() => revisions.push(service.revisionFor(main.uri)));
    const original = service.revisionFor(main.uri);
    mocks.listeners.get('disk')!(related.uri);
    expect(revisions).toEqual([service.revisionFor(main.uri)]);
    expect(revisions[0]).toBeGreaterThan(original);
    mocks.listeners.get('disk')!(uri(path.join(root, '.gitignore')));
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toBeGreaterThan(revisions[0]);
    // Own typing is observable, but consumers can retain the cached remainder.
    changed(main);
    expect(revisions).toHaveLength(3);
    expect(revisions[2]).toBe(revisions[1]);
    subscription.dispose();
  });

  it('invalidates cached context when a collected closed file changes on disk', async () => {
    const main = await document('main.ts', 'target');
    const related = await document('context.ts', 'available', 'typescript', false);
    mocks.definition.mockResolvedValue([location(related)]);
    service = new CompletionContextService();
    await collect(main);
    const revision = service.revisionFor(main.uri);
    mocks.listeners.get('disk')!(related.uri);
    expect(service.revisionFor(main.uri)).toBeGreaterThan(revision);
  });
});


function view(document: vscode.TextDocument, line = 0) {
  mocks.listeners.get('active')!({ document, selection: { active: { line } } });
}
function collectViewed(document: vscode.TextDocument, maxCharacters = 8000, excludePatterns: string[] = [], signal = new AbortController().signal) {
  return service.collectRecentlyViewed(document, { maxCharacters, excludePatterns, signal });
}

describe('Mercury recently viewed context', () => {
  it('uses the five most recently viewed other files oldest to newest, centered at their viewed lines', async () => {
    const main = await document('main.ts', 'target');
    const viewed = [];
    for (let i = 0; i < 7; i++) viewed.push(await document(`view${i}.ts`, Array.from({ length: 80 }, (_, line) => `file ${i} line ${line}`).join('\n')));
    const openedOnly = await document('opened-only.ts', 'not visited');
    const definition = await document('definition.ts', 'definition context', 'typescript', false);
    service = new CompletionContextService();
    viewed.forEach(doc => view(doc, 40));
    // Editing an older file does not turn it into the newest viewed file.
    changed(viewed[0], 60); changed(openedOnly);
    mocks.definition.mockResolvedValue([location(definition)]);
    view(main);
    const result = await collectViewed(main);
    expect(result.map(snippet => snippet.filepath)).toEqual(['view2.ts', 'view3.ts', 'view4.ts', 'view5.ts', 'view6.ts']);
    for (const [index, snippet] of result.entries()) {
      expect(snippet.source).toBe('openFile');
      expect(snippet.content.split('\n')).toHaveLength(20);
      expect(snippet.content.split('\n')[0]).toBe(`file ${index + 2} line 30`);
      expect(snippet.content.split('\n')[19]).toBe(`file ${index + 2} line 49`);
    }
    expect(mocks.definition).not.toHaveBeenCalled();
    // Revisiting the same location still advances its actual viewing recency.
    view(viewed[2], 40);
    expect((await collectViewed(main)).map(snippet => snippet.filepath)).toEqual(['view3.ts', 'view4.ts', 'view5.ts', 'view6.ts', 'view2.ts']);
  });

  it('honors the total character budget without cutting a viewed line', async () => {
    const main = await document('main.ts', 'target');
    const older = await document('older.ts', 'olderLine');
    const latest = await document('latest.ts', Array.from({ length: 40 }, (_, i) => `L${String(i).padStart(2, '0')}`).join('\r\n'));
    service = new CompletionContextService(); view(older); view(latest, 20);
    const result = await collectViewed(main, 11);
    expect(result).toEqual([expect.objectContaining({ filepath: 'latest.ts', content: 'L19\nL20\nL21' })]);
    expect(result.reduce((sum, snippet) => sum + snippet.content.length, 0)).toBeLessThanOrEqual(11);
    expect(await collectViewed(main, 2)).toEqual([]);
  });

  it('applies ignore rules, configured exclusions and workspace boundaries to viewed files', async () => {
    const main = await document('main.ts', 'target');
    const allowed = await document('allowed.ts', 'visible');
    const blocked = await document('blocked.ts', 'ignored');
    const excluded = await document('exclude.ts', 'excluded');
    const external = await document('second/external.ts', 'external');
    const secret = await document('.env.local', 'secret');
    mocks.roots.unshift(uri(path.join(root, 'second')));
    await writeFile(path.join(root, '.droidignore'), 'blocked.ts\n');
    mocks.match.mockImplementation((...args: unknown[]) => (args[1] as vscode.TextDocument).uri.fsPath.endsWith('exclude.ts') ? 10 : 0);
    service = new CompletionContextService();
    [allowed, blocked, excluded, external, secret].forEach(doc => view(doc));
    const result = await collectViewed(main, 8000, ['**/exclude.ts']);
    expect(result.map(snippet => snippet.filepath)).toEqual(['allowed.ts']);
    const revision = service.revisionFor(main.uri);
    mocks.listeners.get('disk')!(allowed.uri);
    expect(service.revisionFor(main.uri)).toBeGreaterThan(revision);
  });

  it('keeps recently viewed closed files but reads saved content after unsaved changes are discarded', async () => {
    const main = await document('main.ts', 'target');
    const saved = Array.from({ length: 40 }, (_, line) => `saved line ${line}`).join('\n');
    const related = await document('related.ts', saved);
    Object.assign(related, { getText: () => saved.replace('saved line 20', 'discarded unsaved line 20') });
    service = new CompletionContextService(); view(related, 20);
    expect((await collectViewed(main))[0].content).toContain('discarded unsaved line 20');
    Object.assign(related, { isClosed: true });
    mocks.documents = mocks.documents.filter(doc => doc !== related);
    mocks.listeners.get('close')!(related);
    const result = await collectViewed(main);
    expect(result).toEqual([expect.objectContaining({ filepath: 'related.ts', source: 'openFile' })]);
    expect(result[0].content).toContain('saved line 20');
    expect(result[0].content).not.toContain('discarded unsaved');
    expect(result[0].content.split('\n')).toHaveLength(20);
  });

  it('returns no viewed context when cancelled during collection', async () => {
    const main = await document('main.ts', 'target');
    const related = await document('related.ts', 'visible');
    const abort = new AbortController();
    Object.assign(related, { getText: () => { abort.abort(); return 'visible'; } });
    service = new CompletionContextService(); view(related);
    expect(await collectViewed(main, 8000, [], abort.signal)).toEqual([]);
  });
});
