import { randomUUID } from 'node:crypto';
import { DroidClient, ProcessTransport, MessageVisibility } from '@factory/droid-sdk/node';
import type { FactoryDroidSession } from '../session/sessionTypes';
import { HISTORY_NOTE_ID_PREFIX, MAX_HISTORY_NOTE_LENGTH } from '../../shared/protocol/historyNote';

export class HistoryNoteError extends Error {
  constructor(message: string, readonly requiresReconnect = false) { super(message); }
}
type NoteMessage = Parameters<DroidClient['appendMessages']>[0]['messages'][number];
export interface HistoryNoteClient {
  loadSession(params: { sessionId: string }): Promise<unknown>;
  appendMessages(params: Parameters<DroidClient['appendMessages']>[0]): Promise<unknown>;
  close(): Promise<void>;
}
export interface ProcessHistoryNoteResult {
  readonly session: FactoryDroidSession;
  readonly messageId: string | null;
  readonly error?: HistoryNoteError;
}

/** A single writer owns the session file: release the idle SDK session before appending. */
export async function appendProcessHistory(options: {
  session: FactoryDroidSession; cwd: string; text: string;
  resume(): Promise<FactoryDroidSession>;
  createClient?: (cwd: string) => Promise<HistoryNoteClient>;
}): Promise<ProcessHistoryNoteResult> {
  const { session, text } = options;
  if (!text.trim() || text.length > MAX_HISTORY_NOTE_LENGTH) throw new HistoryNoteError('Enter a history note between 1 and 20,000 characters.');
  try { await session.close(); }
  catch { throw new HistoryNoteError('The idle session could not be released. No history note was written. Reconnect before trying again.', true); }
  let messageId: string | null = null;
  let error: HistoryNoteError | undefined;
  let client: HistoryNoteClient | null = null;
  try {
    client = await (options.createClient ?? createHistoryNoteClient)(options.cwd);
    const loaded = await client.loadSession({ sessionId: session.id });
    if (!succeeded(loaded)) throw new Error('Session load was not confirmed.');
    const id = `${HISTORY_NOTE_ID_PREFIX}${randomUUID()}`;
    const now = Date.now();
    const result = await client.appendMessages({ messages: [{ id, role: 'user' as NoteMessage['role'], createdAt: now, updatedAt: now,
      content: [{ type: 'text' as Extract<NoteMessage['content'][number], { text: string }>['type'], text }], visibility: MessageVisibility.UserOnly }] });
    if (!succeeded(result)) throw new Error('Append was not confirmed.');
    messageId = id;
  } catch {
    error = new HistoryNoteError('Droid did not confirm saving the note. Check session history before retrying; no model request was sent.');
  } finally {
    if (client) {
      try { await client.close(); }
      catch { throw new HistoryNoteError(messageId ? 'The note was saved, but the history client did not close cleanly. Reconnect before continuing.' : 'The history client did not close cleanly. Reconnect and check history before retrying.', true); }
    }
  }
  let restored: FactoryDroidSession;
  try { restored = await options.resume(); }
  catch {
    throw new HistoryNoteError(messageId ? 'The note was saved, but the chat could not reconnect. Reconnect the chat; do not save the same note again.'
      : 'Saving was not confirmed and the chat could not reconnect. Reconnect and check history before retrying.', true);
  }
  return { session: restored, messageId, ...(error ? { error } : {}) };
}

async function createHistoryNoteClient(cwd: string): Promise<HistoryNoteClient> {
  const transport = new ProcessTransport({ cwd });
  try { await transport.connect(); return new DroidClient({ transport }); }
  catch (error) { await transport.close().catch(() => undefined); throw error; }
}
function succeeded(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'result' in value && !('error' in value && value.error);
}
