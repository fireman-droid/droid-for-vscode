import { MAX_SESSION_TRANSCRIPT_ITEMS } from '../../shared/bridgeMessages';
import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { stableTranscriptId } from '../../shared/transcript/hostTranscriptState';
import {
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  transcriptItemTextUnits,
} from '../../shared/transcript/transcriptLimits';

export function appendHistoryTurnChanges(
  transcript: readonly SessionTranscriptItem[],
  usedTextUnits: number,
  multiFileTools: ReadonlyMap<string, readonly string[]>,
): SessionTranscriptItem[] {
  const filesByTurn = new Map<string, string[]>();
  for (const item of transcript) {
    if (item.kind !== 'tool' || item.filePath === undefined) continue;
    const files = filesByTurn.get(item.turnId) ?? [];
    for (const path of multiFileTools.get(item.id) ?? [item.filePath]) {
      if (!files.includes(path) && files.length < MAX_CHANGED_FILES_PER_TURN) {
        files.push(path);
      }
    }
    filesByTurn.set(item.turnId, files);
  }
  if (filesByTurn.size === 0) return [...transcript];

  const lastTurnIndex = new Map<string, number>();
  transcript.forEach((item, index) => {
    if (item.kind !== 'user' && item.turnId !== null) {
      lastTurnIndex.set(item.turnId, index);
    }
  });

  const ids = new Set(transcript.map((item) => item.id));
  let remainingItems = MAX_SESSION_TRANSCRIPT_ITEMS - transcript.length;
  let remainingUnits = MAX_SESSION_TRANSCRIPT_TEXT_UNITS - usedTextUnits;
  const result: SessionTranscriptItem[] = [];
  transcript.forEach((item, index) => {
    result.push(item);
    if (item.kind === 'user' || item.turnId === null) return;
    const files = filesByTurn.get(item.turnId);
    if (
      files === undefined ||
      lastTurnIndex.get(item.turnId) !== index ||
      remainingItems <= 0
    )
      return;
    const id = stableTranscriptId('changes', item.turnId);
    if (ids.has(id)) return;
    const changes: SessionTranscriptItem = {
      id,
      kind: 'changes',
      turnId: item.turnId,
      files: files.map((path) => ({
        path,
        additions: null,
        deletions: null,
      })),
    };
    const units = transcriptItemTextUnits(changes);
    if (units > remainingUnits) return;
    remainingItems -= 1;
    remainingUnits -= units;
    ids.add(id);
    result.push(changes);
  });
  return result;
}
