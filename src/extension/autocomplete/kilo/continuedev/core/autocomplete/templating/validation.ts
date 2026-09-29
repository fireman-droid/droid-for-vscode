/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import {
  AutocompleteClipboardSnippet,
  AutocompleteCodeSnippet,
  AutocompleteSnippet,
  AutocompleteSnippetType,
} from "../types"

const MAX_CLIPBOARD_AGE = 5 * 60 * 1000

const isValidClipboardSnippet = (snippet: AutocompleteClipboardSnippet): boolean => {
  const currDate = new Date()

  const isTooOld = currDate.getTime() - new Date(snippet.copiedAt).getTime() > MAX_CLIPBOARD_AGE

  return !isTooOld
}

export const isValidSnippet = (snippet: AutocompleteSnippet): boolean => {
  if (snippet.content.trim() === "") return false

  if (snippet.type === AutocompleteSnippetType.Clipboard) {
    return isValidClipboardSnippet(snippet)
  }

  if ((snippet as AutocompleteCodeSnippet).filepath?.startsWith("output:extension-output-Continue.continue")) {
    return false
  }

  return true
}
