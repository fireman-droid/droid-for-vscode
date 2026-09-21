import { describe, expect, it, vi } from 'vitest';
import type { WindowDaemonPool } from './windowDaemonPool';
import { createRoutedDaemon } from './routedDaemon';

describe('persisted history routing', () => {
  it('reads every history page on metadata without discovering or loading a worker', async () => {
    const getMessages = vi.fn(async () => []);
    const resume = vi.fn();
    const entry = { connection: { droid: { sessions: { getMessages, resume } } } };
    const current = vi.fn(async () => entry);
    const forSession = vi.fn(async () => { throw new Error('worker discovery is forbidden for history'); });
    const pool = { current, forSession, onConnection: vi.fn(() => () => {}) };
    const api = createRoutedDaemon(pool as unknown as WindowDaemonPool);
    await api.sessions.getMessages('history-session', { limit: 100 });
    await api.sessions.getMessages('history-session', { limit: 100, cursor: 'page-1' });
    expect(getMessages.mock.calls).toEqual([
      ['history-session', { limit: 100 }], ['history-session', { limit: 100, cursor: 'page-1' }],
    ]);
    expect(forSession).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    api.disconnect();
  });

  it('propagates metadata history errors without retrying on a session worker', async () => {
    const failure = new Error('metadata history unavailable');
    const forSession = vi.fn();
    const pool = { current: vi.fn(async () => ({ connection: { droid: {
      sessions: { getMessages: vi.fn(async () => { throw failure; }) },
    } } })), forSession, onConnection: vi.fn(() => () => {}) };
    const api = createRoutedDaemon(pool as unknown as WindowDaemonPool);
    await expect(api.sessions.getMessages('history-session')).rejects.toBe(failure);
    expect(forSession).not.toHaveBeenCalled();
    api.disconnect();
  });
});
