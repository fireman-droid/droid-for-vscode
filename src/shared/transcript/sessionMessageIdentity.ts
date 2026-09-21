import { stableTranscriptId } from './hostTranscriptState';

/** The same daemon message keeps its identity in live events and history snapshots. */
export function sessionMessageTurnId(sessionId: string, messageId: string): string {
  return stableTranscriptId('assistant', 'session-message', sessionId, messageId);
}
