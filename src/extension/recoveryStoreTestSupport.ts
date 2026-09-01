import { createHostTranscriptState } from './hostTranscriptState';
import {
  SessionRecoveryStore,
  type SessionRecoveryCache,
} from './SessionRecoveryStore';

export function writeRecoverySession(
  store: SessionRecoveryStore,
  sessionId: string,
  cache: SessionRecoveryCache,
): boolean {
  const conversationId = store.resolveConversationId(sessionId);
  if (conversationId === undefined) {
    return store.createConversation(sessionId, cache) !== undefined;
  }
  return store.writeActiveDisplay(
    conversationId,
    sessionId,
    cache,
    store.readDisplay(conversationId)?.turn ?? null,
  );
}

export function readRecoverySession(
  store: SessionRecoveryStore,
  sessionId: string,
): SessionRecoveryCache | undefined {
  const conversationId = store.resolveConversationId(sessionId);
  return conversationId === undefined
    ? undefined
    : store.readDisplay(conversationId)?.transcript;
}

export function selectRecoverySession(
  store: SessionRecoveryStore,
  sessionId: string | null,
): void {
  if (sessionId === null) {
    store.selectConversation(null);
    return;
  }
  const conversationId =
    store.resolveConversationId(sessionId) ??
    store.createConversation(
      sessionId,
      createHostTranscriptState('unavailable'),
    );
  store.selectConversation(conversationId ?? null);
}

export function updateRecoverySession(
  store: SessionRecoveryStore,
  sessionId: string,
  update: (
    cache: SessionRecoveryCache | undefined,
  ) => SessionRecoveryCache,
): SessionRecoveryCache | undefined {
  const current = readRecoverySession(store, sessionId);
  let next: SessionRecoveryCache;
  try {
    next = update(current);
  } catch {
    return current;
  }
  return writeRecoverySession(store, sessionId, next)
    ? readRecoverySession(store, sessionId)
    : current;
}
