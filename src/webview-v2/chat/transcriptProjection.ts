import { buildTurns } from '@droidvisx/chat-ui/navigation/buildTurns';
import type { TranscriptDescriptor } from './transcript/transcriptGroups';

const rowId = (descriptor: TranscriptDescriptor) => descriptor.kind === 'user' ? descriptor.item.id : descriptor.id;
interface RowIdentity { readonly id: string; readonly role: 'user' | 'assistant'; readonly turnId?: string }
interface MessagePresentation {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text?: string;
  readonly replyEnd?: boolean;
}

/** Navigation changes with row membership, not with each streamed text delta. */
export function createTranscriptStructureSelector() {
  let rows: readonly RowIdentity[] = [];
  let result = { ids: [] as readonly string[], turns: buildTurns([]), lastTurnRows: new Map<string, string>() };
  return (descriptors: readonly TranscriptDescriptor[]) => {
    if (rows.length === descriptors.length && descriptors.every((descriptor, index) => {
      const row = rows[index]!;
      return row.id === rowId(descriptor) && row.role === descriptor.kind &&
        row.turnId === (descriptor.kind === 'assistant' ? descriptor.turnId : undefined);
    })) return result;
    rows = descriptors.map((descriptor) => ({ id: rowId(descriptor), role: descriptor.kind,
      turnId: descriptor.kind === 'assistant' ? descriptor.turnId : undefined }));
    result = { ids: rows.map((row) => row.id), turns: buildTurns(rows),
      lastTurnRows: new Map(rows.flatMap((row) => row.turnId === undefined ? [] : [[row.turnId, row.id]])) };
    return result;
  };
}

/** Keep the virtualizer's input stable until question text or reply boundaries change. */
export function createTranscriptMessagesSelector() {
  let previous: readonly MessagePresentation[] = [];
  return (descriptors: readonly TranscriptDescriptor[], replyTails: ReadonlyMap<string, string>, pendingIds: ReadonlySet<string>) => {
    const messages = descriptors.map((descriptor, index): MessagePresentation => {
      const id = rowId(descriptor);
      const text = descriptor.kind === 'user' ? descriptor.item.text : undefined;
      const replyEnd = descriptor.kind === 'assistant' && replyTails.has(id) && !pendingIds.has(id);
      const cached = previous[index];
      return cached?.id === id && cached.role === descriptor.kind && cached.text === text && cached.replyEnd === replyEnd
        ? cached : { id, role: descriptor.kind, text, replyEnd };
    });
    if (messages.length !== previous.length || messages.some((message, index) => message !== previous[index])) previous = messages;
    return previous;
  };
}
