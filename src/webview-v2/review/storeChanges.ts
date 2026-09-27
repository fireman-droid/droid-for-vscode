import {
  type ChangesTranscriptItem,
  type SessionTranscriptItem,
} from '../../shared/protocol/transcript';
import { type HostSnapshotMessage } from '../../shared/bridgeMessages';
import type { ChangesUpdateMessage } from '../../shared/protocol/changesProtocol';

export function hydrateChangesTranscript(
  transcript: readonly SessionTranscriptItem[],
  turn: HostSnapshotMessage['turn'],
): readonly SessionTranscriptItem[] {
  const writing =
    turn !== null &&
    (turn.status === 'submitting' ||
      turn.status === 'streaming' ||
      turn.status === 'stopping');
  if (!writing) return transcript;
  return transcript.map((item) =>
    item.kind === 'changes' && item.turnId === turn.turnId
      ? { ...item, writing: true }
      : item,
  );
}

export function reconcileChangesTranscript(
  transcript: readonly SessionTranscriptItem[],
  event: ChangesUpdateMessage,
): readonly SessionTranscriptItem[] {
  const index = transcript.findIndex(
    (item) => item.kind === 'changes' && item.turnId === event.turnId,
  );
  if (event.state === 'settled' && event.files.length === 0) {
    return index < 0
      ? transcript
      : transcript.filter((_item, itemIndex) => itemIndex !== index);
  }
  const existing = transcript[index];
  const item: ChangesTranscriptItem = {
    id: existing?.id ?? `changes:${event.turnId}`,
    kind: 'changes',
    turnId: event.turnId,
    files: event.files,
    ...(event.state === 'writing' ? { writing: true } : {}),
  };
  return existing === undefined
    ? [...transcript, item]
    : transcript.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}
