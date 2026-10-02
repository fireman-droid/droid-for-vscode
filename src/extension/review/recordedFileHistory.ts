import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { operationToolName } from '../../runtime/tools/operationDiff';
import type { ActiveScope } from './reviewCoordinatorSupport';

/** Earlier evidence in transcript order, bounded by the selected turn. */
export function priorFileOperations(
  transcript: readonly SessionTranscriptItem[], sessionId: string, turnId: string, path: string,
): NonNullable<ActiveScope['recordedOperations']> {
  const boundary = transcript.findIndex(item => 'turnId' in item && item.turnId === turnId);
  if (boundary < 0) return [];
  return transcript.slice(0, boundary).flatMap((item, sequence) => {
    if (item.kind !== 'tool' || !operationToolName(item.toolName)) return [];
    const diff = item.operationDiff;
    if (diff?.status === 'ready') {
      return diff.files.filter(file => file.path === path && file.scope !== 'mission').map(file => ({
        ...file, sequence, sessionId: diff.sourceSessionId ?? sessionId,
        toolUseId: item.toolUseId, toolName: item.toolName, source: diff.source,
        ...(item.executionPhase === undefined ? {} : { executionPhase: item.executionPhase }),
      }));
    }
    // Only an unchanged result or a call known not to have executed establishes
    // that bytes were left alone. A failed call can still have partial effects.
    if (diff?.status === 'unavailable' && diff.reason === 'unchanged' || item.executionPhase === 'settled_without_execution') return [];
    return [{ sequence, sessionId, toolUseId: item.toolUseId, toolName: item.toolName,
      source: 'tool-input' as const, kind: 'modified' as const, path, patch: '' }];
  }).slice(-200);
}
