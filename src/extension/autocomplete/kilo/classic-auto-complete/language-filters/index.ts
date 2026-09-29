/*! Vendored from Kilo Code 7d977bce994af36f0edf752cb53e3aefc7aeb214 (classic-auto-complete/language-filters/index.ts). MIT; see third-party/KILO-LICENSE.txt. */
import type { AutocompleteSuggestion } from "../uselessSuggestionFilter"
import { markdownFilter } from "./markdown"

export type LanguageFilter = (params: AutocompleteSuggestion) => string

const languageFilters: Record<string, LanguageFilter> = {
  markdown: markdownFilter,
}

export function applyLanguageFilter(params: AutocompleteSuggestion & { languageId: string }): string {
  const filter = languageFilters[params.languageId]
  if (!filter) {
    return params.suggestion
  }
  return filter(params)
}
