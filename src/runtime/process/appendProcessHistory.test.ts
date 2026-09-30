import { describe, expect, it, vi } from 'vitest';
import { appendProcessHistory, HistoryNoteError, type HistoryNoteClient } from './appendProcessHistory';
import type { FactoryDroidSession } from '../session/sessionTypes';
import { projectSessionMessages } from '../history/projectSessionHistory';

function fixture() {
  const order: string[] = [];
  const session = { id: 'saved-session', close: vi.fn(async () => { order.push('detach'); }) } as unknown as FactoryDroidSession;
  const restored = { id: 'saved-session' } as FactoryDroidSession;
  const client = { loadSession: vi.fn(async () => { order.push('load'); return { result: {} }; }),
    appendMessages: vi.fn<HistoryNoteClient['appendMessages']>(async () => { order.push('append'); return { result: {} }; }),
    close: vi.fn(async () => { order.push('close-client'); }) };
  const resume = vi.fn(async () => { order.push('resume'); return restored; });
  const createClient = vi.fn(async () => { order.push('create-client'); return client; });
  return { session, restored, client, resume, createClient, order };
}

describe('Process history-only append', () => {
  it('releases the idle writer, appends user-only text through the SDK, and restores the session', async () => {
    const f = fixture();
    const result = await appendProcessHistory({ ...f, cwd: '/synthetic', text: 'Local note\nSecond line' });
    expect(f.order).toEqual(['detach', 'create-client', 'load', 'append', 'close-client', 'resume']);
    expect(result.session).toBe(f.restored);
    const message = f.client.appendMessages.mock.calls[0]?.[0].messages[0];
    expect(message).toMatchObject({ id: result.messageId, role: 'user', visibility: 'user_only',
      content: [{ type: 'text', text: 'Local note\nSecond line' }] });
    const history = projectSessionMessages([message], { sourceSessionId: 'saved-session' });
    expect(history.status).toBe('available');
    if (history.status !== 'available') throw new Error('Expected saved history.');
    expect(history.state.transcript).toMatchObject([{ kind: 'diagnostic', code: 'history-note', message: 'Local note\nSecond line' }]);
    expect(history.state.transcript.some((item) => item.kind === 'user')).toBe(false);
    expect(history.messageAncestry?.[0]?.startsTurn).toBe(false);
  });

  it('never writes when the original session fails to close', async () => {
    const f = fixture(); vi.mocked(f.session.close).mockRejectedValue(new Error('close failed'));
    await expect(appendProcessHistory({ ...f, cwd: '/synthetic', text: 'note' })).rejects.toMatchObject({ requiresReconnect: true });
    expect(f.createClient).not.toHaveBeenCalled();
    expect(f.client.appendMessages).not.toHaveBeenCalled();
  });

  it('restores the original session after an unconfirmed append without inventing success', async () => {
    const f = fixture(); f.client.appendMessages.mockRejectedValue(new Error('request failed'));
    const result = await appendProcessHistory({ ...f, cwd: '/synthetic', text: 'note' });
    expect(result).toMatchObject({ session: f.restored, messageId: null, error: expect.any(HistoryNoteError) });
    expect(f.resume).toHaveBeenCalledOnce();
    expect(f.client.close).toHaveBeenCalledOnce();
  });

  it('reports a saved note accurately when the high-level session cannot resume', async () => {
    const f = fixture(); f.resume.mockRejectedValue(new Error('resume failed'));
    await expect(appendProcessHistory({ ...f, cwd: '/synthetic', text: 'note' })).rejects.toMatchObject({
      requiresReconnect: true, message: expect.stringContaining('The note was saved'),
    });
    expect(f.client.appendMessages).toHaveBeenCalledOnce();
  });

  it('does not reopen another writer after the low-level client fails to close', async () => {
    const f = fixture(); f.client.close.mockRejectedValue(new Error('close failed'));
    await expect(appendProcessHistory({ ...f, cwd: '/synthetic', text: 'note' })).rejects.toMatchObject({ requiresReconnect: true });
    expect(f.resume).not.toHaveBeenCalled();
  });
});
