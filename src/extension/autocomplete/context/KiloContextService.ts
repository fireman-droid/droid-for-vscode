import * as vscode from 'vscode';
import { withParserResources } from '../kilo/continuedev/core/util/treeSitter';
import { ContextRetrievalService } from '../kilo/continuedev/core/autocomplete/context/ContextRetrievalService';
import { HelperVars } from '../kilo/continuedev/core/autocomplete/util/HelperVars';
import { DEFAULT_AUTOCOMPLETE_OPTS } from '../kilo/continuedev/core/util/parameters';
import { getAllSnippetsWithoutRace } from '../kilo/continuedev/core/autocomplete/snippets/getAllSnippets';
import { getSnippets } from '../kilo/continuedev/core/autocomplete/templating/filtering';
import { AutocompleteSnippetType, type AutocompleteSnippet } from '../kilo/continuedev/core/autocomplete/types';
import { getTemplateForModel } from '../kilo/continuedev/core/autocomplete/templating/AutocompleteTemplate';
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

/** Uses Kilo's full retrieval, pruning and model templates behind the host file boundary. */
export class KiloContextService implements vscode.Disposable {
  private readonly ide: KiloContextIde;
  private retrieval: ContextRetrievalService;
  private readonly visited: RecentlyVisitedRangesService;
  private readonly edited: RecentlyEditedTracker;
  private readonly subscriptions: vscode.Disposable[];
  constructor(onRead?: (uri: string) => void) {
    this.ide = new KiloContextIde(onRead);
    this.retrieval = new ContextRetrievalService(this.ide);
    this.visited = new RecentlyVisitedRangesService(this.ide);
    this.edited = new RecentlyEditedTracker(this.ide);
    const remember = (doc: vscode.TextDocument) => { if (doc.uri.scheme === 'file') openedFilesLruCache.set(doc.uri.toString(), doc.uri.toString()); };
    vscode.workspace.textDocuments.forEach(remember);
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument(remember),
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) remember(editor.document); }),
      vscode.workspace.onDidCloseTextDocument(doc => openedFilesLruCache.delete(doc.uri.toString())),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.invalidate(); }),
    ];
  }
  invalidate(): void {
    invalidateLspCaches(); this.ide.invalidate(); this.retrieval.dispose(); this.retrieval = new ContextRetrievalService(this.ide);
  }
  async build(input: { document: vscode.TextDocument; text: string; offset: number; filepath: string;
    settings: CompletionSettings; signal: AbortSignal; snippets: readonly ContextSnippet[]; comments?: LanguageComments }) {
    return this.ide.run(input.signal, () => withParserResources(async () => {
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
      const supplemental = settings.relatedFiles ? input.snippets : [];
      const asKilo = (snippet: ContextSnippet): AutocompleteSnippet => ({
        filepath: snippet.uri, content: snippet.content, type: AutocompleteSnippetType.Code,
      });
      // Keep direct definitions and recent edits ahead of general opened-file context.
      const candidates = [
        ...supplemental.filter(s => s.source !== 'openFile').map(asKilo),
        ...getSnippets(helper, payload),
        ...supplemental.filter(s => s.source === 'openFile').map(asKilo),
      ];
      const access = await Promise.all(candidates.map(s => 'filepath' in s && s.filepath ? this.ide.allowed(s.filepath) : Promise.resolve(settings.includeClipboard === true)));
      const snippets: AutocompleteSnippet[] = [];
      for (const [index, candidate] of candidates.entries()) {
        const content = candidate.content.trim();
        if (!access[index] || !content) continue;
        const filepath = 'filepath' in candidate ? candidate.filepath : undefined;
        const duplicate = snippets.some(existing => ('filepath' in existing ? existing.filepath : undefined) === filepath
          && (existing.content.trim().includes(content) || content.includes(existing.content.trim())));
        if (!duplicate) snippets.push(candidate);
      }
      if (signal.aborted) throw signal.reason;
      const kiloModel = /codestral/i.test(settings.model);
      if (kiloModel) {
        const template = getTemplateForModel(settings.model);
        // Kilo applies the provider's multifile template when there is suffix context.
        const usable = [...snippets];
        const render = (budget: number) => {
          const main = buildCompletionContext(helper.prunedPrefix + helper.prunedSuffix, helper.prunedPrefix.length, budget);
          const [prefix, suffix] = template.compilePrefixSuffix && helper.prunedSuffix
            ? template.compilePrefixSuffix(main.prefix, main.suffix, filepath, '', usable, helper.workspaceUris)
            : [main.prefix, main.suffix];
          return { prefix, suffix };
        };
        const budget = settings.maxContextCharacters;
        while (usable.length && (() => { const p = render(Math.ceil(budget * 0.6)); return p.prefix.length + p.suffix.length > budget; })()) usable.pop();
        let low = 0, high = budget;
        while (low < high) {
          const candidate = Math.ceil((low + high) / 2), p = render(candidate);
          if (p.prefix.length + p.suffix.length <= budget) low = candidate; else high = candidate - 1;
        }
        return { ...render(low), relatedFiles: helper.prunedSuffix ? usable.length : 0 };
      }
      const contextSnippets: ContextSnippet[] = snippets.map(s => 'filepath' in s
        ? { uri: s.filepath, filepath: this.ide.relative(s.filepath), content: s.content, source: 'definition' }
        : { uri: 'clipboard', filepath: 'Clipboard', content: s.content, source: 'definition' });
      const prompt = buildCompletionPrompt({ text: input.text, offset: input.offset, maxCharacters: settings.maxContextCharacters,
        filepath: input.filepath, model: settings.model, snippets: contextSnippets, comments: input.comments });
      return { ...prompt, relatedFiles: contextSnippets.length };
    }));
  }
  dispose(): void {
    this.ide.dispose(); this.retrieval.dispose(); this.visited.dispose(); this.edited.dispose();
    this.subscriptions.forEach(subscription => subscription.dispose()); openedFilesLruCache.clear();
  }
}
