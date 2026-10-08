// Completed Thinking rows read as a past-tense fact, mirroring the
// Cursor "Thought for Xs" affordance; sub-500ms runs are too short
// for a number to be meaningful.
export function formatThinkingLabel(
  statusType: string | undefined,
  durationMs: number | null,
): string {
  if (statusType === 'incomplete') {
    return 'Thinking stopped';
  }
  if (durationMs === null) {
    return 'Thought';
  }
  if (durationMs < 500) {
    return 'Thought briefly';
  }
  if (durationMs < 1_000) {
    return `Thought for ${(durationMs / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) {
    return `Thought for ${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0
    ? `Thought for ${minutes}m`
    : `Thought for ${minutes}m ${seconds}s`;
}
