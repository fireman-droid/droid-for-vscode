/**
 * Local commit-message drafting for the inline commit panel (slice A
 * of the git/PR workflow design): the draft is assembled from the
 * turn's own prompt, never from an LLM call.
 */

/** Longest prompt excerpt used as the draft's subject line. */
export const MAX_DRAFT_SUBJECT_CHARS = 50;

/**
 * `<prompt first line, truncated>` + blank line + `via Droid,
 * N files`. With no usable prompt the trailer stands alone.
 */
export function buildCommitMessageDraft(
  prompt: string | null,
  fileCount: number,
): string {
  const firstLine =
    prompt
      ?.split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  // Code-point slice so CJK and emoji survive the truncation.
  const subject = [...firstLine].slice(0, MAX_DRAFT_SUBJECT_CHARS).join('');
  const trailer = `via Droid, ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
  return subject === '' ? trailer : `${subject}\n\n${trailer}`;
}
