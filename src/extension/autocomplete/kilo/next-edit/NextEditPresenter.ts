/*! Derived from Kilo Code 7d977bce994af36f0edf752cb53e3aefc7aeb214 (next-edit/NextEditInlineCompletionProvider.ts). MIT; see third-party/KILO-LICENSE.txt. */
import * as vscode from "vscode"
import type { NextEditSuggestionManager } from "./NextEditSuggestionManager"
export const INLINE_COMPLETION_ACCEPTED_COMMAND = "droidvisx.autocomplete.nextEdit.accepted"
export interface SuggestionResult {
  suggestionId?: number;
  replacement: string; editableRegionStartLine: number; editableRegionEndLine: number;
  latencyMs: number; inputTokens?: number; outputTokens?: number;
}
export interface NextEditResultEvent {
  suggestionId: number; shown: boolean; latencyMs: number; status: string; reason: string;
  presentation: 'inline' | 'decoration' | 'none'; characters: number; startLine: number; endLine: number;
  inputTokens?: number; outputTokens?: number;
}
export class NextEditPresenter {
  constructor(private readonly deps: {
    suggestionManager: NextEditSuggestionManager;
    onSuggestion?: (event: NextEditResultEvent) => void;
  }) {}
  toCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    suggestion: SuggestionResult,
  ): vscode.InlineCompletionItem[] | undefined {
    const endLine = Math.min(suggestion.editableRegionEndLine, document.lineCount - 1)
    const fullRange = new vscode.Range(
      new vscode.Position(suggestion.editableRegionStartLine, 0),
      document.lineAt(endLine).range.end,
    )
    const currentText = document.getText(fullRange)
    if (currentText.replace(/\r\n/g, "\n") === suggestion.replacement.replace(/\r\n/g, "\n")) {
      this.emitResult(suggestion, false, "unchanged-region", "none")
      return undefined
    }

    // Trim to minimal diff: skip identical leading and trailing lines.
    const currentLines = currentText.split(/\r?\n/)
    const proposedLines = suggestion.replacement.split(/\r?\n/)
    let prefixLines = 0
    while (
      prefixLines < currentLines.length &&
      prefixLines < proposedLines.length &&
      currentLines[prefixLines] === proposedLines[prefixLines]
    )
      prefixLines++
    let suffixLines = 0
    while (
      suffixLines < currentLines.length - prefixLines &&
      suffixLines < proposedLines.length - prefixLines &&
      currentLines[currentLines.length - 1 - suffixLines] === proposedLines[proposedLines.length - 1 - suffixLines]
    )
      suffixLines++

    const diffStartLineInFile = suggestion.editableRegionStartLine + prefixLines
    const diffEndLineInFile = suggestion.editableRegionStartLine + currentLines.length - 1 - suffixLines
    const trimmedLines = proposedLines.slice(prefixLines, proposedLines.length - suffixLines)
    const trimmedReplacement = trimmedLines.join("\n")

    // VSCode's inline ghost text only renders when the diff starts on the cursor's line.
    // For off-cursor diffs, stash the suggestion in the manager — it renders a
    // decoration-based "jump to next edit" affordance and Tab handles the move/apply.
    const isPureInsertion = diffEndLineInFile < diffStartLineInFile
    const removesLines = trimmedLines.length === 0
    if (isPureInsertion || removesLines || suggestion.replacement === "" || diffStartLineInFile !== position.line) {
      this.stashOffCursorSuggestion(
        document,
        diffStartLineInFile,
        diffEndLineInFile,
        trimmedReplacement,
        isPureInsertion,
        removesLines,
        suggestion,
        isPureInsertion ? "insert-region" : removesLines || suggestion.replacement === "" ? "delete-region" : "off-cursor",
      )
      return undefined
    }
    // Same-line diff: clear any prior off-cursor pending state so we don't render
    // two competing affordances.
    this.deps.suggestionManager?.clear("inline-replacement")
    return this.renderSameLineItem(
      document,
      position,
      proposedLines,
      prefixLines,
      suffixLines,
      diffStartLineInFile,
      diffEndLineInFile,
      trimmedReplacement,
      suggestion,
    )
  }

  /** Build the cursor-position ghost-text item for a same-line diff. */
  private renderSameLineItem(
    document: vscode.TextDocument,
    position: vscode.Position,
    proposedLines: string[],
    prefixLines: number,
    suffixLines: number,
    diffStartLine: number,
    diffEndLine: number,
    trimmedReplacement: string,
    suggestion: SuggestionResult,
  ): vscode.InlineCompletionItem[] | undefined {
    const cursorLineText = document.lineAt(position.line).text
    const cursorLineCurrent = cursorLineText.slice(position.character)
    const cursorLineProposed = proposedLines[prefixLines]
    // A pure deletion at the trim seam has no cursor-line replacement to render.
    if (cursorLineProposed === undefined) {
      this.emitResult(suggestion, false, "no-cursor-line", "none")
      return undefined
    }
    // Native ghost text cannot alter text before the cursor; present that edit
    // through the decoration/apply flow rather than silently discarding it.
    if (!cursorLineProposed.startsWith(cursorLineText.slice(0, position.character))) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion, "cursor-prefix-mismatch")
      return undefined
    }
    if (cursorLineCurrent && !cursorLineProposed.slice(position.character).startsWith(cursorLineCurrent)) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion, "cursor-suffix-mismatch")
      return undefined
    }
    const insertText = [
      cursorLineProposed.slice(position.character),
      ...proposedLines.slice(prefixLines + 1, proposedLines.length - suffixLines),
    ].join("\n")
    const renderEndLine = pickRenderEndLine(document, position.line, diffEndLine, insertText)
    // A single-line insert spanning non-blank lines below the cursor can't be
    // represented as inline ghost text — route it to the decoration path.
    if (renderEndLine > position.line) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion, "multiline-replacement")
      return undefined
    }
    const renderRange = new vscode.Range(
      position,
      new vscode.Position(renderEndLine, document.lineAt(renderEndLine).range.end.character),
    )
    if (document.getText(renderRange) === cursorLineCurrent && cursorLineCurrent === insertText) {
      this.emitResult(suggestion, false, "unchanged-insertion", "none")
      return undefined
    }

    const normalizedInsert = document.eol === vscode.EndOfLine.CRLF ? insertText.replace(/\n/g, "\r\n") : insertText
    const item = new vscode.InlineCompletionItem(normalizedInsert, renderRange, {
      command: INLINE_COMPLETION_ACCEPTED_COMMAND,
      title: "Next Edit Accepted",
      arguments: [suggestion.suggestionId ?? 0],
    })
    this.emitResult(suggestion, true, "inline-candidate", "inline", normalizedInsert.length, renderRange.start.line, renderRange.end.line)
    return [item]
  }

  private emitResult(suggestion: SuggestionResult, shown: boolean, reason: string,
    presentation: NextEditResultEvent['presentation'], characters = 0,
    startLine = suggestion.editableRegionStartLine, endLine = suggestion.editableRegionEndLine): void {
    this.deps.onSuggestion?.({
      suggestionId: suggestion.suggestionId ?? 0, shown, reason, presentation, characters, startLine, endLine,
      latencyMs: suggestion.latencyMs,
      status: shown ? "ok" : "no-replacement",
      ...(suggestion.inputTokens === undefined ? {} : { inputTokens: suggestion.inputTokens }),
      ...(suggestion.outputTokens === undefined ? {} : { outputTokens: suggestion.outputTokens }),
    })
  }

  private stashOffCursorSuggestion(
    document: vscode.TextDocument,
    diffStartLine: number,
    diffEndLine: number,
    trimmedReplacement: string,
    isPureInsertion: boolean,
    removesLines: boolean,
    suggestion: SuggestionResult,
    reason: string,
  ): void {
    const mgr = this.deps.suggestionManager
    if (!mgr) {
      // Manager wasn't wired — fall through silently. The classic path
      // already covers same-line completions; this branch only matters in
      // tests or misconfigured embeds.
      this.emitResult(suggestion, false, "missing-manager", "none")
      return
    }
    if (isPureInsertion) {
      // The original text we snapshot must come from the line VSCode will see
      // when the user later accepts. For mid-file inserts that's `diffStartLine`
      // (the line that gets pushed down). For EOF inserts (diffStartLine ===
      // lineCount) there is no such line; fall back to lineCount-1 (the last
      // line, which will sit just above the inserted content). The
      // SuggestionManager's drift guard knows to compare against this anchor.
      const isEof = diffStartLine >= document.lineCount
      const anchorLine = isEof
        ? Math.max(0, document.lineCount - 1)
        : Math.max(0, Math.min(diffStartLine, document.lineCount - 1))
      mgr.setPending({
        kind: "insert",
        suggestionId: suggestion.suggestionId,
        document,
        diffStartLine,
        diffEndLine: diffStartLine,
        replacement: trimmedReplacement + "\n",
        originalText: document.lineAt(anchorLine).text,
      })
    } else {
      const originalRange = new vscode.Range(
        new vscode.Position(diffStartLine, 0),
        new vscode.Position(diffEndLine, document.lineAt(diffEndLine).range.end.character),
      )
      mgr.setPending({
        kind: "replace",
        suggestionId: suggestion.suggestionId,
        document,
        diffStartLine,
        diffEndLine,
        replacement: trimmedReplacement,
        removesLines,
        originalText: document.getText(originalRange),
      })
    }
    this.emitResult(suggestion, true, reason, "decoration", trimmedReplacement.length, diffStartLine, diffEndLine)
  }

}
function pickRenderEndLine(
  document: vscode.TextDocument,
  cursorLine: number,
  diffEndLine: number,
  insertText: string,
): number {
  if (diffEndLine <= cursorLine) return diffEndLine
  if (insertText.includes("\n")) return diffEndLine
  for (let l = cursorLine + 1; l <= diffEndLine; l++) {
    if (document.lineAt(l).text.trim() !== "") return diffEndLine
  }
  return cursorLine
}
