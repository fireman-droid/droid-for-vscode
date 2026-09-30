import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatController } from '../chat/ChatController';
import { saveHistoryNote } from './historyNote';
import { HistoryNoteError } from '../../runtime/process/appendProcessHistory';

const editor = vi.hoisted(() => ({ showInformationMessage: vi.fn(), showTextDocument: vi.fn(), openTextDocument: vi.fn() }));
vi.mock('vscode', () => ({ window: editor, workspace: { openTextDocument: editor.openTextDocument } }));
beforeEach(() => { vi.resetAllMocks(); editor.openTextDocument.mockResolvedValue({ getText: () => 'Synthetic local note' }); });

function fixture() {
  const appendHistoryMessage = vi.fn().mockResolvedValue({ messageId: 'saved-note' });
  const runtime = { supportsHistoryAppend: () => true, appendHistoryMessage, sendTurn: vi.fn() };
  const controller = { sessionState: { runtime, sessionId: 'session', activeRuntimeCwd: '/synthetic', conversationId: null,
    sessionOperationInProgress: false, connection: { status: 'connected' } },
  sessionHistory: { loadHistory: vi.fn().mockResolvedValue({ status: 'available', state: { transcript: [
    { id: 'saved-note', kind: 'diagnostic', turnId: null, severity: 'info', code: 'history-note', message: 'Synthetic local note' },
  ], historyStatus: 'complete', truncated: false } }) }, recoveryState: { transcript: { transcript: [], historyStatus: 'complete', truncated: false } },
  recoveryStore: {}, emitSnapshot: vi.fn() } as unknown as ChatController;
  return { controller, runtime, appendHistoryMessage };
}

describe('history-note management boundary', () => {
  it('keeps session operations blocked while saving and refreshes only confirmed history', async () => {
    const h = fixture(); let finish!: (value: { messageId: string }) => void;
    h.appendHistoryMessage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    editor.showInformationMessage.mockResolvedValueOnce('Use content').mockResolvedValueOnce('Save note');
    const saving = saveHistoryNote(h.controller, vi.fn());
    await vi.waitFor(() => expect(h.appendHistoryMessage).toHaveBeenCalledOnce());
    expect(h.controller.sessionState.sessionOperationInProgress).toBe(true);
    finish({ messageId: 'saved-note' }); await saving;
    expect(h.controller.sessionState.sessionOperationInProgress).toBe(false);
    expect(h.runtime.sendTurn).not.toHaveBeenCalled();
    expect(h.controller.recoveryState.transcript.transcript).toMatchObject([{ kind: 'diagnostic', code: 'history-note' }]);
  });

  it('rejects an unsupported backend before collecting or saving a note', async () => {
    const h = fixture(); h.runtime.supportsHistoryAppend = () => false;
    await expect(saveHistoryNote(h.controller, vi.fn())).rejects.toThrow('does not expose this operation for daemon sessions');
    expect(editor.openTextDocument).not.toHaveBeenCalled();
    expect(h.appendHistoryMessage).not.toHaveBeenCalled();
  });

  it('marks the chat unavailable after a saved note cannot reconnect without offering false success', async () => {
    const h = fixture();
    editor.showInformationMessage.mockResolvedValueOnce('Use content').mockResolvedValueOnce('Save note');
    h.appendHistoryMessage.mockRejectedValue(new HistoryNoteError('The note was saved, but the chat could not reconnect.', true));
    await expect(saveHistoryNote(h.controller, vi.fn())).rejects.toThrow('The note was saved');
    expect(h.controller.sessionState.connection.status).toBe('unavailable');
    expect(h.controller.sessionState.sessionOperationInProgress).toBe(false);
    expect(h.controller.sessionHistory.loadHistory).not.toHaveBeenCalled();
    expect(editor.showInformationMessage).toHaveBeenCalledTimes(2);
  });
});
