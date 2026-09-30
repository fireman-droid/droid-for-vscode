/*! Vendored from Kilo Code 7d977bce994af36f0edf752cb53e3aefc7aeb214 (continuedev/core/autocomplete/postprocessing/removePrefixOverlap.ts). Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
export function removePrefixOverlap(completion: string, prefix: string): string {
  const prefixEnd = prefix.split("\n").pop()
  if (prefixEnd) {
    if (completion.startsWith(prefixEnd)) {
      completion = completion.slice(prefixEnd.length)
    } else {
      const trimmedPrefix = prefixEnd.trim()
      const lastWord = trimmedPrefix.split(/\s+/).pop()
      if (lastWord && completion.startsWith(lastWord)) {
        completion = completion.slice(lastWord.length)
      } else if (completion.startsWith(trimmedPrefix)) {
        completion = completion.slice(trimmedPrefix.length)
      }
    }
  }
  return completion
}
