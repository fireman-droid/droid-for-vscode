import type { SessionMessage } from '@factory/droid-sdk';
import type { SessionHistoryRequest, SessionHistoryResult } from './SessionHistory';
import { readPersistedSessionMessages } from './persistedSessionMessages';
import { projectSessionMessagesAsync } from './asyncHistoryProjection';

// One extra message preserves the projector's partial-history indication.
export const MAX_RAW_MESSAGE_WINDOW = 10_001;
export interface PersistedHistoryRequest extends SessionHistoryRequest {
  readonly sessionsDirectory: string;
}
export interface PersistedHistory {
  readonly projected: Extract<SessionHistoryResult, { status: 'available' }>;
  readonly file: string;
  readonly bytes: number;
  readonly messages: number;
  readonly readMs: number;
  readonly projectMs: number;
}
export type PersistedHistoryReader = (request: PersistedHistoryRequest) => Promise<PersistedHistory | null>;

/** Runs inside the history worker in production; only bounded display data leaves it. */
export const readPersistedHistory: PersistedHistoryReader = async (request) => {
  const started = performance.now();
  const persisted = await readPersistedSessionMessages(request.sessionsDirectory, request.sessionId);
  if (persisted === null) return null;
  const messages = orderMessagesChronologically(persisted.messages).slice(-MAX_RAW_MESSAGE_WINDOW);
  const readMs = Math.round(performance.now() - started);
  const projectStarted = performance.now();
  const projected = await projectSessionMessagesAsync(messages, {
    workspaceRoot: request.cwd, sourceSessionId: request.sessionId,
  });
  if (projected.status !== 'available') return null;
  return { projected, file: persisted.file, bytes: persisted.bytes, messages: messages.length,
    readMs, projectMs: Math.round(performance.now() - projectStarted) };
};

export function orderMessagesChronologically(messages: readonly SessionMessage[]): SessionMessage[] {
  return messages.map((message, fetchedIndex) => ({ message, fetchedIndex }))
    .sort((left, right) => left.message.createdAt - right.message.createdAt || left.fetchedIndex - right.fetchedIndex)
    .map(({ message }) => message);
}
