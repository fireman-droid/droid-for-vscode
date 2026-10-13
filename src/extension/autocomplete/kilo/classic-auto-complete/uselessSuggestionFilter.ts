/*! Derived from Kilo Code 7d977bce994af36f0edf752cb53e3aefc7aeb214 (classic-auto-complete/uselessSuggestionFilter.ts). MIT; see third-party/KILO-LICENSE.txt. Droid adds explicit filter outcomes. */
import { postprocessCompletion } from "../continuedev/core/autocomplete/postprocessing/index.js"
import { applyLanguageFilter } from "./language-filters"

export type AutocompleteSuggestion = {
  suggestion: string
  prefix: string
  suffix: string
}

export type AutocompletePostprocessResult = {
  text: string
  outcome: "suggestion-returned" | "empty" | "already-present" | "repetition-filtered"
}

export function suggestionConsideredDuplication(params: AutocompleteSuggestion): boolean {
  if (DuplicatesFromPrefixOrSuffix(params)) {
    return true
  }

  // Multiline completions can be "partially duplicated": e.g. the first suggested line
  // repeats the last complete line in the prefix, or the last suggested line repeats
  // the first line in the suffix. Closing delimiters may belong to different nested blocks.
  if (DuplicatesFromEdgeLines(params)) {
    return true
  }

  // Check if the suggestion contains repetitive phrases that continue from the prefix
  if (containsRepetitivePhraseFromPrefix(params)) {
    return true
  }

  // When the suggestion isn't a full line or set of lines, normalize by including
  // the rest of the line in the prefix/suffix and check with the completed line(s)
  const normalized = normalizeToCompleteLine(params)
  return !!normalized && (DuplicatesFromPrefixOrSuffix(normalized) || DuplicatesFromEdgeLines(normalized))
}

function DuplicatesFromPrefixOrSuffix(params: AutocompleteSuggestion): boolean {
  const trimmed = params.suggestion.trim()

  return (
    trimmed.length === 0 || params.prefix.trimEnd().endsWith(trimmed) || params.suffix.trimStart().startsWith(trimmed)
  )
}

function DuplicatesFromEdgeLines(params: AutocompleteSuggestion): boolean {
  const trimmedSuggestion = params.suggestion.trim()
  if (!trimmedSuggestion.includes("\n")) {
    return false
  }

  const suggestionLines = trimmedSuggestion.split("\n")
  const firstSuggestionLine = suggestionLines[0]?.trim() ?? ""
  const lastSuggestionLine = suggestionLines[suggestionLines.length - 1]?.trim() ?? ""

  const prefixLastLine = params.prefix.trimEnd().split("\n").pop()?.trim() ?? ""
  const suffixFirstLine = params.suffix.trimStart().split("\n")[0]?.trim() ?? ""

  if (isRepeatedCodeLine(firstSuggestionLine, prefixLastLine)) {
    return true
  }

  if (isRepeatedCodeLine(lastSuggestionLine, suffixFirstLine)) {
    return true
  }

  return false
}

function isRepeatedCodeLine(suggestionLine: string, contextLine: string): boolean {
  // Equal closing punctuation cannot establish duplication: an inner if/loop/call may
  // close immediately before its containing block. Preserve both and their indentation.
  return suggestionLine.length > 0 && suggestionLine === contextLine && !/^[}\])]+[;,]?$/.test(suggestionLine)
}

/**
 * Detects when a suggestion's tail is repeating itself - a common LLM failure mode.
 * For example: "the beginning. We are going to start from the beginning. We are going to start from the beginning..."
 * The suggestion gets stuck in a loop repeating the same phrase.
 */
function containsRepetitivePhraseFromPrefix(params: AutocompleteSuggestion): boolean {
  // Repeated guards across distinct branches are valid code. A phrase occurring
  // three times anywhere does not establish a generation loop; require three
  // adjacent, identical tail blocks, including the code between occurrences.
  const tail = params.suggestion.trimEnd()
  for (let length = 30; length <= Math.min(512, Math.floor(tail.length / 3)); length++) {
    const block = tail.slice(-length)
    if (tail.slice(-2 * length, -length) === block && tail.slice(-3 * length, -2 * length) === block) {
      return true
    }
  }
  return false
}

/**
 * Normalizes partial-line suggestions by expanding them to the full current line:
 * (prefix line tail) + (suggestion first line) + (suffix line head).
 *
 * Returns null when the suggestion already starts/ends on line boundaries.
 */
function normalizeToCompleteLine(params: AutocompleteSuggestion): AutocompleteSuggestion | null {
  const prefixNewlineIndex = params.prefix.lastIndexOf("\n")
  const prefix = prefixNewlineIndex === -1 ? "" : params.prefix.slice(0, prefixNewlineIndex + 1)
  const prefixLineTail = prefixNewlineIndex === -1 ? params.prefix : params.prefix.slice(prefixNewlineIndex + 1)

  const suffixNewlineIndex = params.suffix.indexOf("\n")
  const suffixLineHead = suffixNewlineIndex === -1 ? params.suffix : params.suffix.slice(0, suffixNewlineIndex)
  const suffix = suffixNewlineIndex === -1 ? "" : params.suffix.slice(suffixNewlineIndex)

  if (prefixLineTail.length === 0 && suffixLineHead.length === 0) {
    return null
  }

  return {
    prefix,
    suggestion: prefixLineTail + params.suggestion + suffixLineHead,
    suffix,
  }
}

/**
 * Postprocesses an autocomplete suggestion using the continuedev postprocessing pipeline
 * and applies some of our own duplicate checks.
 *
 * @param params - Object containing suggestion parameters
 * @param params.suggestion - The suggested text to insert
 * @param params.prefix - The text before the cursor position
 * @param params.suffix - The text after the cursor position
 * @param params.model - The model string (e.g., "codestral", "mercury", etc.)
 * @param params.languageId - Optional language ID for language-specific filtering
 * @returns The processed suggestion text, or undefined if it should be filtered out
 */
export function postprocessAutocompleteSuggestion(
  params: AutocompleteSuggestion & {
    model: string
    languageId?: string
  },
): string | undefined {
  const result = postprocessAutocompleteSuggestionWithOutcome(params)
  return result.outcome === "suggestion-returned" ? result.text : undefined
}

export function postprocessAutocompleteSuggestionWithOutcome(
  params: AutocompleteSuggestion & {
    model: string
    languageId?: string
  },
): AutocompletePostprocessResult {
  // First, run through the continuedev postprocessing pipeline
  const processedSuggestion = postprocessCompletion({
    completion: params.suggestion,
    llm: { model: params.model },
    prefix: params.prefix,
    suffix: params.suffix,
    preserveFences: ["markdown", "mdx", "plaintext"].includes(params.languageId ?? ""),
  })

  if (processedSuggestion === undefined) {
    return { text: "", outcome: params.suggestion.trim() ? "repetition-filtered" : "empty" }
  }

  // Apply language-specific filtering if languageId is provided
  const languageFilteredSuggestion = params.languageId
    ? applyLanguageFilter({
        suggestion: processedSuggestion,
        prefix: params.prefix,
        suffix: params.suffix,
        languageId: params.languageId,
      })
    : processedSuggestion

  if (!languageFilteredSuggestion.trim()) {
    return { text: "", outcome: "empty" }
  }
  if (params.suffix.trimStart().startsWith(languageFilteredSuggestion.trim())) {
    return { text: "", outcome: "already-present" }
  }

  if (
    suggestionConsideredDuplication({
      suggestion: languageFilteredSuggestion,
      prefix: params.prefix,
      suffix: params.suffix,
    })
  ) {
    return { text: "", outcome: "repetition-filtered" }
  }

  return { text: languageFilteredSuggestion, outcome: "suggestion-returned" }
}
