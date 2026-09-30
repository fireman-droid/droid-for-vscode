import { codeLanguageForPath, embeddedLanguages, highlighter, resolveCodeLanguage, detectionLanguages } from './codeLanguages';

export interface CodeHighlightHints {
  readonly language?: string | null;
  readonly path?: string;
  /** Disable guessing for non-source tool output and individual diff lines. */
  readonly detect?: boolean;
}

const MAX_HIGHLIGHT_CHARACTERS = 32_000;
const MAX_DETECTION_CHARACTERS = 4_096;
const MIN_DETECTION_RELEVANCE = 3;
const MAX_CACHED_ENTRIES = 128;
const MAX_CACHED_CHARACTERS = 1_048_576;
const highlights = new Map<string, string | null>();
let cachedCharacters = 0;

function retainHighlight(key: string, html: string | null): void {
  const size = key.length + (html?.length ?? 0);
  if (size > MAX_CACHED_CHARACTERS) return;
  highlights.set(key, html);
  cachedCharacters += size;
  while (highlights.size > MAX_CACHED_ENTRIES || cachedCharacters > MAX_CACHED_CHARACTERS) {
    const [oldKey, oldHtml] = highlights.entries().next().value!;
    highlights.delete(oldKey);
    cachedCharacters -= oldKey.length + (oldHtml?.length ?? 0);
  }
}

function detectLanguage(code: string, candidates: readonly string[]): string | undefined {
  // Score grammars on a bounded sample, then render the full text once.
  const sample = code.slice(0, MAX_DETECTION_CHARACTERS);
  const result = highlighter.highlightAuto(sample, [...candidates]);
  if (!result.language || result.relevance < MIN_DETECTION_RELEVANCE || result.errorRaised) return undefined;
  const runnerUp = result.secondBest;
  // Accept tied grammars only when their token rendering actually agrees.
  if (runnerUp && result.relevance - runnerUp.relevance < 1 && result.value !== runnerUp.value) return undefined;
  return result.language;
}

/** HTML comes exclusively from highlight.js, which escapes the source. Unknown
 * or ambiguous languages stay plain text; source and copy data are never changed. */
export function highlightCode(code: string, hints: CodeHighlightHints = {}): string | null {
  if (!code.trim() || code.length > MAX_HIGHLIGHT_CHARACTERS) return null;
  const explicit = resolveCodeLanguage(hints.language);
  // Never override an explicit unsupported fence (for example diagram syntax)
  // with an unrelated language guessed from a few matching keywords.
  if (hints.language?.trim() && !explicit) return null;
  const fromPath = hints.path ? codeLanguageForPath(hints.path) : undefined;
  let language = explicit ?? fromPath;
  if (language === 'plaintext') return null;

  // Virtual rows unmount offscreen. Reuse complete results across mounts,
  // including failed detection, without retaining an unbounded code history.
  // Explicit fences and path hints differ because only path hints may detect
  // embedded languages; detect:false must never reuse an auto-detected result.
  const key = JSON.stringify([explicit ?? null, explicit ? null : fromPath ?? null, hints.detect !== false, code]);
  if (highlights.has(key)) {
    const html = highlights.get(key)!;
    highlights.delete(key);
    highlights.set(key, html);
    return html;
  }

  if (hints.detect !== false) {
    if (!language) language = detectLanguage(code, detectionLanguages);
    // Fences are authoritative. A Read excerpt may start inside an embedded
    // language, so the file extension alone is only an outer-language hint.
    else if (!explicit) {
      const embedded = embeddedLanguages(language);
      if (embedded.length) language = detectLanguage(code, [language, ...embedded]) ?? language;
    }
  }
  const result = language ? highlighter.highlight(code, { language, ignoreIllegals: true }) : null;
  const html = result && !result.errorRaised ? result.value : null;
  retainHighlight(key, html);
  return html;
}
