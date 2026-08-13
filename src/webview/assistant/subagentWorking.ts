import type { SessionTranscriptItem } from '../../shared/bridgeMessages';

/**
 * One live subagent delegation still running, projected from the
 * transcript for the "N Working" badge and its activity popup. A pure
 * webview derivation of the tool rows' `subagent` field — no new
 * bridge data.
 */
export interface WorkingSubagent {
  readonly turnId: string;
  readonly toolUseId: string;
  readonly type: string;
  readonly description: string;
}

/**
 * Selects the running subagent delegations of live turns.
 *
 * `liveTurnIds` holds every turn id this webview connection has seen
 * on `state.turn` (App accumulates it; cleared on session change).
 * History replay never populates it, so replayed sessions with rows
 * the ledger still reports as running show no badge; a recovered
 * live/zombie turn does, because its snapshot carries a non-null
 * turn. Rows of finished turns stay counted while their delegation
 * is still running in the background — that window, where nothing
 * else in the UI moves, is exactly what the badge is for.
 *
 * A statusless delegation under a still-running Task row counts too
 * (same fallback the transcript sub-row applies): the delegation
 * identity arrives with the Task input, but for a FOREGROUND
 * (blocking) Task the SDK only reports a lifecycle status with the
 * Task's own tool_result, so `subagent.status` stays undefined for
 * the entire visible run. Terminal and pending statuses never count.
 */
export function selectWorkingSubagents(
  transcript: readonly SessionTranscriptItem[],
  liveTurnIds: ReadonlySet<string>,
): readonly WorkingSubagent[] {
  const rows: WorkingSubagent[] = [];
  for (const item of transcript) {
    if (
      item.kind !== 'tool' ||
      item.subagent === undefined ||
      !liveTurnIds.has(item.turnId)
    ) {
      continue;
    }
    const working =
      item.subagent.status === 'running' ||
      (item.subagent.status === undefined && item.status === 'running');
    if (!working) {
      continue;
    }
    rows.push({
      turnId: item.turnId,
      toolUseId: item.toolUseId,
      type: item.subagent.type,
      description: item.subagent.description,
    });
  }
  return rows;
}

/** Whole-second elapsed label for a ticking run: 47s, 2m 14s, 1h 2m. */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0
      ? `${totalMinutes}m`
      : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
