/*! Vendored from Kilo Code 7d977bce994af36f0edf752cb53e3aefc7aeb214 (continuedev/core/autocomplete/util/textSimilarity.ts). Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import { distance } from "fastest-levenshtein"

/**
 * Determine if two lines are effectively the same/repetition.
 * Short lines (<=4 chars) are never considered repeated.
 */
export function lineIsRepeated(a: string, b: string): boolean {
  if (a.length <= 4 || b.length <= 4) {
    return false
  }
  const aTrim = a.trim()
  const bTrim = b.trim()
  return distance(aTrim, bTrim) / bTrim.length < 0.1
}
