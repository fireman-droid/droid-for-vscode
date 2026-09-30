import * as vscode from 'vscode';
import type { ChatController } from '../chat/ChatController';
import { MAX_HISTORY_NOTE_LENGTH } from '../../shared/protocol/historyNote';
import { HistoryNoteError } from '../../runtime/process/appendProcessHistory';
import { reconcileSessionHistory } from '../recovery/reconcileSessionHistory';
import { historyWithLocalChanges } from '../recovery/historyWithLocalChanges';
import { changed, editText, ManagementError } from './managementUi';

export async function saveHistoryNote(ctl: ChatController, assertCurrent: (write?: boolean) => void): Promise<void> {
  const runtime = ctl.sessionState.runtime;
  if (!runtime?.supportsHistoryAppend?.() || !runtime.appendHistoryMessage)
    throw new ManagementError('History-only notes require Process runtime mode. SDK 0.9.1 does not expose this operation for daemon sessions. Nothing was saved or sent to the model.');
  assertCurrent(true);
  const text = await editText('History-only note', '', MAX_HISTORY_NOTE_LENGTH);
  if (text === undefined) return;
  assertCurrent(true);
  const answer = await vscode.window.showInformationMessage('Save this note only in session history? It will not start an agent, enter model context, or send a prompt. The idle Process session will reconnect.', { modal: true }, 'Save note');
  if (answer !== 'Save note') return;
  assertCurrent(true);
  const sessionId = ctl.sessionState.sessionId!;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  ctl.sessionState.sessionOperationInProgress = true;
  ctl.emitSnapshot();
  try {
    await runtime.appendHistoryMessage(text);
    assertCurrent();
    const loaded = await ctl.sessionHistory.loadHistory({ cwd, sessionId });
    assertCurrent();
    if (loaded.status !== 'available')
      throw new ManagementError('The note was saved, but history could not refresh. Reopen the session to view it; do not save it again.');
    ctl.recoveryState.transcript = reconcileSessionHistory(historyWithLocalChanges(loaded.state,
      ctl.sessionState.conversationId === null ? undefined : ctl.recoveryStore.readConversation(ctl.sessionState.conversationId),
      ctl.recoveryState.transcript.transcript), ctl.recoveryState.transcript);
    ctl.emitSnapshot();
    await changed('Note saved in session history. No model request was sent.');
  } catch (error) {
    if (error instanceof HistoryNoteError) {
      if (error.requiresReconnect) ctl.sessionState.connection = { status: 'unavailable', message: error.message };
      throw new ManagementError(error.message);
    }
    throw error;
  } finally {
    ctl.sessionState.sessionOperationInProgress = false;
    ctl.emitSnapshot();
  }
}
