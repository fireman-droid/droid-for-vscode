/*! Kilo context flow adapted from Kilo Code 54de37a85dfef8feb828382d8a71f84139857121
 * (classic-auto-complete/getProcessedSnippets.ts and FillInTheMiddle.ts).
 * MIT; see third-party/KILO-LICENSE.txt.
 */
import * as vscode from 'vscode';
import { withParserResources } from '../kilo/continuedev/core/util/treeSitter';
import { ContextRetrievalService } from '../kilo/continuedev/core/autocomplete/context/ContextRetrievalService';
import { HelperVars } from '../kilo/continuedev/core/autocomplete/util/HelperVars';
import { DEFAULT_AUTOCOMPLETE_OPTS } from '../kilo/continuedev/core/util/parameters';
import { getAllSnippetsWithoutRace } from '../kilo/continuedev/core/autocomplete/snippets/getAllSnippets';
import { getSnippets } from '../kilo/continuedev/core/autocomplete/templating/filtering';
import { AutocompleteSnippetType, type AutocompleteSnippet } from '../kilo/continuedev/core/autocomplete/types';
import { codestralTemplate } from '../kilo/continuedev/core/autocomplete/templating/AutocompleteTemplate';
import { RecentlyVisitedRangesService } from '../kilo/continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService';
import { RecentlyEditedTracker } from '../kilo/continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited';
import { openedFilesLruCache } from '../kilo/continuedev/core/autocomplete/util/openedFilesLruCache';
import { buildCompletionContext } from '../completionText';
import { invalidateLspCaches } from '../kilo/continuedev/core/vscode-test-harness/src/autocomplete/lsp';
import { KiloContextIde } from './KiloContextIde';
import { buildCompletionPrompt } from './CompletionPrompt';
import type { CompletionSettings } from '../settings';
import type { ContextSnippet } from './CompletionContextService';
import type { LanguageComments } from './LanguageComments';

interface FimInput {
  document: vscode.TextDocument; text: string; offset: number; settings: CompletionSettings; signal: AbortSignal;
}

/** Uses Kilo's full retrieval, pruning and model templates behind the host file boundary. */
export class KiloContextService implements vscode.Disposable {
  private readonly ide: KiloContextIde;
  private retrieval: ContextRetrievalService;
  private readonly visited: RecentlyVisitedRangesService;
  private readonly edited: RecentlyEditedTracker;
  private readonly subscriptions: vscode.Disposable[];
  constructor(onRead?: (uri: string) => void, onTimeout?: () => void) {
    this.ide = new KiloContextIde(onRead, onTimeout);
    this.retrieval = new ContextRetrievalService(this.ide);
    this.visited = new RecentlyVisitedRangesService(this.ide);
    this.edited = new RecentlyEditedTracker(this.ide);
    const remember = (doc: vscode.TextDocument) => { if (doc.uri.scheme === 'file') openedFilesLruCache.set(doc.uri.toString(), doc.uri.toString()); };
    vscode.workspace.textDocuments.forEach(remember);
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument(remember),
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) remember(editor.document); }),
      vscode.workspace.onDidCloseTextDocument(doc => openedFilesLruCache.delete(doc.uri.toString())),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.contentChanges.length) this.invalidate(event.document.uri.toString());
      }),
    ];
  }
  invalidate(changedFile?: string): void {
    // Definitions can point into any edited file, so their ranges and contents
    // must expire together. Ordinary source edits do not change ignore rules.
    invalidateLspCaches(); this.retrieval.invalidate(changedFile);
    if (!changedFile || /(?:^|\/)\.(?:gitignore|droidignore)$/.test(changedFile)) this.ide.invalidate();
  }
  private retrieveFimContext(input: FimInput) {
    return withParserResources(async () => {
      const { settings, signal, document } = input;
      if (signal.aborted) throw signal.reason;
      const filepath = document.uri.toString();
      if (settings.relatedFiles) await this.retrieval.initializeForFile(filepath);
      const cursorLines = input.text.slice(0, input.offset).split('\n');
      const helper = await HelperVars.create({
        filepath, completionId: String(document.version), isUntitledFile: document.isUntitled, languageId: document.languageId,
        pos: { line: cursorLines.length - 1, character: cursorLines.at(-1)!.length }, manuallyPassFileContents: input.text,
        recentlyVisitedRanges: settings.relatedFiles ? this.visited.getSnippets() : [],
        recentlyEditedRanges: settings.relatedFiles ? await this.edited.getRecentlyEditedRanges() : [],
      }, { ...DEFAULT_AUTOCOMPLETE_OPTS, useImports: settings.relatedFiles, useRecentlyOpened: settings.relatedFiles,
        experimental_enableStaticContextualization: settings.relatedFiles && settings.staticContext === true,
        experimental_includeClipboard: settings.includeClipboard === true }, settings.model, this.ide);
      const payload = await getAllSnippetsWithoutRace({ helper, ide: this.ide, contextRetrievalService: this.retrieval });
      // The current buffer already supplies these edits. Stale snapshots of it
      // waste reference space and can disagree with the actual cursor context.
      payload.recentlyEditedRangeSnippets = payload.recentlyEditedRangeSnippets.filter(s => s.filepath !== filepath);
      payload.recentlyVisitedRangesSnippets = payload.recentlyVisitedRangesSnippets.filter(s => s.filepath !== filepath);
      const { prunedPrefix, prunedSuffix, prunedCaretWindow, workspaceUris } = helper;
      return { filepath, prunedPrefix, prunedSuffix, prunedCaretWindow, workspaceUris, snippets: getSnippets(helper, payload) };
    });
  }
  async build(input: FimInput & { filepath: string; snippets: readonly ContextSnippet[] | Promise<ContextSnippet[]>;
    comments?: LanguageComments | Promise<LanguageComments | undefined> }) {
    return this.ide.run(input.signal, async () => {
      const { settings, signal } = input;
      // Both sources use the same request signal; rank and check access only after both are ready.
      const [kilo, editorSnippets, comments] = await Promise.all([this.retrieveFimContext(input), input.snippets, input.comments]);
      signal.throwIfAborted();
      const supplemental = settings.relatedFiles ? editorSnippets : [];
      const asKilo = (snippet: ContextSnippet): AutocompleteSnippet => ({
        filepath: snippet.uri, content: snippet.content, type: AutocompleteSnippetType.Code,
      });
      // Keep direct definitions and recent edits ahead of general opened-file context.
      const candidates = [
        ...supplemental.filter(s => s.source === 'definition').map(asKilo),
        ...kilo.snippets,
        ...supplemental.filter(s => s.source !== 'definition').map(asKilo),
      ];
      const access = await Promise.all(candidates.map(s => 'filepath' in s && s.filepath ? this.ide.allowed(s.filepath) : Promise.resolve(settings.includeClipboard === true)));
      const snippets: AutocompleteSnippet[] = [];
      for (const [index, candidate] of candidates.entries()) {
        const content = candidate.content.trim();
        if (!access[index] || !content) continue;
        const filepath = 'filepath' in candidate ? candidate.filepath : undefined;
        if (filepath === kilo.filepath && kilo.prunedCaretWindow.includes(content)) continue;
        const duplicate = snippets.some(existing => ('filepath' in existing ? existing.filepath : undefined) === filepath
          && (existing.content.trim().includes(content) || content.includes(existing.content.trim())));
        if (!duplicate) snippets.push(candidate);
      }
      if (signal.aborted) throw signal.reason;
      if (/codestral/i.test(settings.model)) {
        // Reference definitions are also required when completing at EOF.
        const usable = [...snippets];
        const render = (budget: number) => {
          const main = buildCompletionContext(kilo.prunedPrefix + kilo.prunedSuffix, kilo.prunedPrefix.length, budget);
          const [prefix, suffix] = codestralTemplate.compilePrefixSuffix(main.prefix, main.suffix, kilo.filepath, '', usable, kilo.workspaceUris);
          return { prefix, suffix };
        };
        const budget = settings.maxContextCharacters;
        while (usable.length && (() => { const p = render(Math.ceil(budget * 0.6)); return p.prefix.length + p.suffix.length > budget; })()) usable.pop();
        let low = 0, high = budget;
        while (low < high) {
          const candidate = Math.ceil((low + high) / 2), p = render(candidate);
          if (p.prefix.length + p.suffix.length <= budget) low = candidate; else high = candidate - 1;
        }
        const relatedFiles = new Set(usable.flatMap((snippet) =>
          'filepath' in snippet && snippet.filepath ? [snippet.filepath] : [],
        )).size;
        return { ...render(low), relatedFiles };
      }
      const contextSnippets: ContextSnippet[] = snippets.map(s => 'filepath' in s
        ? { uri: s.filepath, filepath: this.ide.relative(s.filepath), content: s.content, source: 'definition' }
        : { uri: 'clipboard', filepath: 'Clipboard', content: s.content, source: 'definition' });
      const prompt = buildCompletionPrompt({ text: input.text, offset: input.offset, maxCharacters: settings.maxContextCharacters,
        filepath: input.filepath, model: settings.model, snippets: contextSnippets, comments });
      return prompt;
    });
  }
  dispose(): void {
    this.ide.dispose(); this.retrieval.dispose(); this.visited.dispose(); this.edited.dispose();
    this.subscriptions.forEach(subscription => subscription.dispose()); openedFilesLruCache.clear();
  }
}
