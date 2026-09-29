/*! Derived from Kilo Code 7d977bce994af36f0edf752cb53e3aefc7aeb214 (next-edit/NextEditInlineCompletionProvider.ts). MIT; see third-party/KILO-LICENSE.txt. */
import * as vscode from "vscode"
import { nesLog } from "./log"
import type { NextEditSuggestionManager } from "./NextEditSuggestionManager"
export const INLINE_COMPLETION_ACCEPTED_COMMAND = "droidvisx.autocomplete.nextEdit.accepted"
export interface SuggestionResult {
  replacement: string; editableRegionStartLine: number; editableRegionEndLine: number;
  latencyMs: number; inputTokens?: number; outputTokens?: number;
}
export class NextEditPresenter {
  constructor(private readonly deps: {
    suggestionManager: NextEditSuggestionManager;
    onSuggestion?: (event: { shown: boolean; latencyMs: number; status: string; inputTokens?: number; outputTokens?: number }) => void;
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
      this.emitNotShown(suggestion)
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

    nesLog(
      `diff at lines [${diffStartLineInFile}..${diffEndLineInFile}], cursor at line ${position.line}, ${trimmedReplacement.length} chars`,
    )

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
      )
      return undefined
    }
    // Same-line diff: clear any prior off-cursor pending state so we don't render
    // two competing affordances.
    this.deps.suggestionManager?.clear()
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
      this.emitNotShown(suggestion)
      return undefined
    }
    // Native ghost text cannot alter text before the cursor; present that edit
    // through the decoration/apply flow rather than silently discarding it.
    if (!cursorLineProposed.startsWith(cursorLineText.slice(0, position.character))) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion)
      return undefined
    }
    if (cursorLineCurrent && !cursorLineProposed.slice(position.character).startsWith(cursorLineCurrent)) {
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion)
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
      this.stashOffCursorSuggestion(document, diffStartLine, diffEndLine, trimmedReplacement, false, false, suggestion)
      return undefined
    }
    const renderRange = new vscode.Range(
      position,
      new vscode.Position(renderEndLine, document.lineAt(renderEndLine).range.end.character),
    )
    if (document.getText(renderRange) === cursorLineCurrent && cursorLineCurrent === insertText) return undefined

    const normalizedInsert = document.eol === vscode.EndOfLine.CRLF ? insertText.replace(/\n/g, "\r\n") : insertText
    const item = new vscode.InlineCompletionItem(normalizedInsert, renderRange, {
      command: INLINE_COMPLETION_ACCEPTED_COMMAND,
      title: "Next Edit Accepted",
    })
    nesLog(
      `RENDER range=[${renderRange.start.line}:${renderRange.start.character}..${renderRange.end.line}:${renderRange.end.character}] insertChars=${insertText.length}`,
    )
    this.deps.onSuggestion?.({
      shown: true,
      latencyMs: suggestion.latencyMs,
      status: "ok",
      inputTokens: suggestion.inputTokens,
      outputTokens: suggestion.outputTokens,
    })
    return [item]
  }

  private emitNotShown(suggestion: SuggestionResult): void {
    this.deps.onSuggestion?.({
      shown: false,
      latencyMs: suggestion.latencyMs,
      status: "no-replacement",
      inputTokens: suggestion.inputTokens,
      outputTokens: suggestion.outputTokens,
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
  ): void {
    const mgr = this.deps.suggestionManager
    if (!mgr) {
      // Manager wasn't wired — fall through silently. The classic path
      // already covers same-line completions; this branch only matters in
      // tests or misconfigured embeds.
      this.emitNotShown(suggestion)
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
        document,
        diffStartLine,
        diffEndLine: diffStartLine,
        replacement: trimmedReplacement + "\n",
        originalText: document.lineAt(anchorLine).text,
      })
      nesLog(
        `insert suggestion stashed at line ${diffStartLine} (anchor=${anchorLine}, eof=${isEof}, ${trimmedReplacement.length} chars)`,
      )
    } else {
      const originalRange = new vscode.Range(
        new vscode.Position(diffStartLine, 0),
        new vscode.Position(diffEndLine, document.lineAt(diffEndLine).range.end.character),
      )
      mgr.setPending({
        kind: "replace",
        document,
        diffStartLine,
        diffEndLine,
        replacement: trimmedReplacement,
        removesLines,
        originalText: document.getText(originalRange),
      })
      nesLog(`replace suggestion stashed at lines [${diffStartLine}..${diffEndLine}]`)
    }
    this.deps.onSuggestion?.({
      shown: true,
      latencyMs: suggestion.latencyMs,
      status: "ok",
      inputTokens: suggestion.inputTokens,
      outputTokens: suggestion.outputTokens,
    })
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
