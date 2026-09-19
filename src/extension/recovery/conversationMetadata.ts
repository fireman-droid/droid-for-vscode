import type { ConversationRecoveryRecord, ConversationDisplaySnapshot } from './conversationRecoveryState';
import { cloneConversation } from './conversationRecoveryState';
import { createHostTranscriptState } from './hostTranscriptState';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { dataValue } from './sessionRecoveryItems';

/** Drop obsolete display payloads before validating persisted extension metadata. */
export function withoutCachedHistory(value: unknown): unknown {
  if (
    !isStrictRecord(value) ||
    (dataValue(value, 'version') !== 2 && dataValue(value, 'version') !== 3)
  ) return value;
  const conversations = dataValue(value, 'conversations');
  if (!Array.isArray(conversations)) return value;
  return {
    ...value,
    conversations: conversations.map((conversation: unknown) => {
      if (!isStrictRecord(conversation)) return conversation;
      const display = dataValue(conversation, 'display');
      const turns = dataValue(conversation, 'turns');
      return {
        ...conversation,
        ...(isStrictRecord(display) ? {
          display: { ...display, transcript: createHostTranscriptState('complete'), images: [] },
        } : {}),
        ...(Array.isArray(turns) ? {
          turns: turns.map((turn: unknown) =>
            isStrictRecord(turn) ? { ...turn, prompt: null } : turn),
        } : {}),
      };
    }),
  };
}

export function conversationMetadata(
  conversation: ConversationRecoveryRecord,
): ConversationRecoveryRecord {
  return cloneConversation({
    ...conversation,
    display: {
      ...conversation.display,
      turn: recoveryTurnMetadata(conversation.display.turn),
      transcript: createHostTranscriptState('complete'),
      images: [],
    },
    turns: conversation.turns.map((turn) => ({ ...turn, prompt: null })),
  });
}

export function recoveryTurnMetadata(
  turn: ConversationDisplaySnapshot['turn'],
): ConversationDisplaySnapshot['turn'] {
  return turn?.status === 'completed' || turn?.status === 'interrupted' ? null : turn;
}
