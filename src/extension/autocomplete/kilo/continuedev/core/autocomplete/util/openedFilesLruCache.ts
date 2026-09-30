/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
import QuickLRU from "quick-lru"

// maximum number of open files that can be cached
const MAX_NUM_OPEN_CONTEXT_FILES = 20

// stores which files are currently open in the IDE, in viewing order
export const openedFilesLruCache = new QuickLRU<string, string>({
  maxSize: MAX_NUM_OPEN_CONTEXT_FILES,
})
