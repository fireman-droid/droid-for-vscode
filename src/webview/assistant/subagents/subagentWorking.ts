import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';

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
  /** Tool count when the durable invocation ledger already reported it. */
  readonly toolUseCount: number | null;
}

/**
 * Selects the running subagent delegations for the Working badge.
 *
 * Rows with an EXPLICIT `subagent.status === 'running'` count
 * regardless of `liveTurnIds`: the ledger said so, and that includes
 * history replay after Reload Window (the host's
 * `armReplayedSubagentWatch` polls exactly those rows and settles
 * dead ones within a poll tick, so a stale badge self-corrects).
 * Rows of finished turns stay counted while their delegation is
 * still running in the background — that window, where nothing else
 * in the UI moves, is exactly what the badge is for.
 *
 * The statusless fallback KEEPS the liveTurnIds gate: a delegation
 * without a ledger status under a still-running Task row is live
 * work only when this connection actually saw the turn run (for a
 * FOREGROUND Task the SDK reports no lifecycle status until the
 * Task's own tool_result). Replay cannot tell live work there, so
 * `liveTurnIds` — every turn id this webview connection has seen on
 * `state.turn`, cleared on session change — stays authoritative.
 * Terminal and pending statuses never count.
 */
export function selectWorkingSubagents(
  transcript: readonly SessionTranscriptItem[],
  liveTurnIds: ReadonlySet<string>,
): readonly WorkingSubagent[] {
  const rows: WorkingSubagent[] = [];
  for (const item of transcript) {
    if (item.kind !== 'tool' || item.subagent === undefined) {
      continue;
    }
    const explicitRunning = item.subagent.status === 'running';
    const statuslessLive =
      item.subagent.status === undefined &&
      item.status === 'running' &&
      liveTurnIds.has(item.turnId);
    if (!explicitRunning && !statuslessLive) {
      continue;
    }
    rows.push({
      turnId: item.turnId,
      toolUseId: item.toolUseId,
      type: item.subagent.type,
      description: item.subagent.description,
      toolUseCount: item.subagent.toolUseCount ?? null,
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
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
