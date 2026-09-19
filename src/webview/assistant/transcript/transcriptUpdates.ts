import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import {
  hasTrailingDiagnostic,
  updatePendingActivity,
} from '../../../shared/transcript/activityUpdates';
import {
  enforceTranscriptImageBudget,
  trimTranscriptToLimits,
} from '../../../shared/transcript/transcriptLimits';
import type { AssistantWebviewState } from '../state/types';

export const MAX_DIAGNOSTICS = 50;

export function boundTranscript(
  state: AssistantWebviewState,
  transcript: readonly SessionTranscriptItem[],
): AssistantWebviewState {
  const bounded = trimTranscriptToLimits(transcript);
  // Image byte eviction degrades old images to placeholder rows; it
  // does not make the history partial.
  const imageBudget = enforceTranscriptImageBudget(bounded.transcript);
  if (!bounded.trimmed) {
    return { ...state, transcript: imageBudget.transcript };
  }
  return {
    ...state,
    transcript: imageBudget.transcript,
    historyStatus: 'partial',
    truncated: true,
  };
}

export function appendAssistantDelta(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  delta: string,
  sequence: number,
): readonly SessionTranscriptItem[] {
  const last = transcript.at(-1);
  if (last?.kind !== 'assistant' || last.turnId !== turnId) {
    return [
      ...transcript,
      {
        id: `assistant:${turnId}:${sequence}`,
        kind: 'assistant',
        turnId,
        text: delta,
      },
    ];
  }
  return [...transcript.slice(0, -1), { ...last, text: last.text + delta }];
}

/**
 * Per-segment thinking item id. Segments key by their bridge
 * segmentIndex so interleaved thinking renders one row per segment
 * at its arrival position; legacy single-block `thinking:${turnId}`
 * ids from old recovery checkpoints never collide with these.
 */
export function thinkingSegmentItemId(turnId: string, segmentIndex: number): string {
  return `thinking:${turnId}:${segmentIndex}`;
}

export function appendThinkingDelta(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  delta: string,
  truncated: boolean,
  segmentIndex: number,
): readonly SessionTranscriptItem[] {
  const id = thinkingSegmentItemId(turnId, segmentIndex);
  const index = transcript.findIndex((item) => item.id === id);
  if (index === -1) {
    return [
      ...transcript,
      {
        id,
        kind: 'thinking',
        turnId,
        text: delta,
        status: 'active',
        truncated,
      },
    ];
  }
  return transcript.map((item, itemIndex) =>
    itemIndex === index && item.kind === 'thinking'
      ? {
          ...item,
          text: item.text + delta,
          truncated: item.truncated || truncated,
        }
      : item,
  );
}

export function markActivitiesStopping(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
): readonly SessionTranscriptItem[] {
  return transcript.map((item) => updatePendingActivity(item, turnId, 'stopping'));
}

export function finalizeActivities(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  outcome: 'completed' | 'interrupted' | 'failed',
): readonly SessionTranscriptItem[] {
  return transcript.map((item) => {
    if (item.kind === 'changes' && item.turnId === turnId && item.writing === true) {
      const { writing: _writing, ...settled } = item;
      return settled;
    }
    return updatePendingActivity(
      item,
      turnId,
      outcome === 'completed' ? 'completed' : 'stopped',
    );
  });
}

export function appendDiagnostic(
  transcript: readonly SessionTranscriptItem[],
  next: Extract<SessionTranscriptItem, { kind: 'diagnostic' }>,
): readonly SessionTranscriptItem[] {
  if (hasTrailingDiagnostic(transcript, next)) return transcript;

  const current =
    next.code === 'runtime-execution-failed' && next.turnId !== null
      ? transcript.filter(
          (item) =>
            item.kind !== 'diagnostic' ||
            item.turnId !== next.turnId ||
            item.severity !== 'error',
        )
      : transcript;
  const count = current.filter((item) => item.kind === 'diagnostic').length;
  if (count < MAX_DIAGNOSTICS) {
    return [...current, next];
  }
  const oldest = current.findIndex((item) => item.kind === 'diagnostic');
  return [...current.slice(0, oldest), ...current.slice(oldest + 1), next];
}
