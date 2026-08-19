import type {
  ChangesTranscriptItem,
  SessionTranscriptItem,
} from '../../shared/bridgeMessages';

/**
 * Local commit-message drafting for the inline commit panel (slice A
 * of the git/PR workflow design): the draft is assembled from the
 * turn's own prompt, never from an LLM call.
 */

/** Longest prompt excerpt used as the draft's subject line. */
export const MAX_DRAFT_SUBJECT_CHARS = 50;

/**
 * `<prompt first line, truncated>` + blank line + `via DroidVisX,
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
  const subject = [...firstLine]
    .slice(0, MAX_DRAFT_SUBJECT_CHARS)
    .join('');
  const trailer = `via DroidVisX, ${fileCount} ${
    fileCount === 1 ? 'file' : 'files'
  }`;
  return subject === '' ? trailer : `${subject}\n\n${trailer}`;
}

export interface LatestChangesContext {
  /** Turn whose changes card carries the commit entry. */
  readonly turnId: string;
  /** The prompt that produced that turn, when it is in the transcript. */
  readonly prompt: string | null;
}

/** Returns the newest turn-scoped Changes projection, if one exists. */
export function findLatestChangesItem(
  transcript: readonly SessionTranscriptItem[],
): ChangesTranscriptItem | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item !== undefined && item.kind === 'changes') {
      return item;
    }
    if (item !== undefined && item.kind === 'user') {
      return null;
    }
  }
  return null;
}

/**
 * Finds the transcript's last changes card and the user prompt that
 * preceded it. User items carry no turnId, so the nearest preceding
 * user item stands in for the turn's prompt.
 */
export function findLatestChangesContext(
  transcript: readonly SessionTranscriptItem[],
): LatestChangesContext | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item === undefined) {
      continue;
    }
    if (item.kind === 'user') {
      return null;
    }
    if (item.kind !== 'changes') {
      continue;
    }
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = transcript[cursor];
      if (candidate !== undefined && candidate.kind === 'user') {
        return { turnId: item.turnId, prompt: candidate.text };
      }
    }
    return { turnId: item.turnId, prompt: null };
  }
  return null;
}
