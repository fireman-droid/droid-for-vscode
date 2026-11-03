import type { ChatController } from '../ChatController';
import { SessionHistoryWindow } from '../../../runtime/history/SessionHistoryWindow';

const pending = new WeakSet<ChatController>();
const attempted = new WeakMap<ChatController, string>();

/** New/forked sessions acquire a paging cursor once they have a saved tail. */
export async function ensureHistoryPaging(ctl: ChatController): Promise<void> {
  const sessionId = ctl.sessionState.sessionId, cwd = ctl.sessionState.activeRuntimeCwd;
  const generation = ctl.sessionState.runtimeGeneration;
  const tail = ctl.recoveryState.transcript.transcript.at(-1);
  if (!sessionId || !cwd || !tail || pending.has(ctl) || ctl.sessionState.disposed ||
    ctl.sessionState.connection.status !== 'connected' || !ctl.sessionHistory.supportsPaging?.() ||
    ctl.recoveryState.historyWindow?.sessionIds[0] === sessionId) return;
  const key = `${generation}:${sessionId}:${tail.id}`;
  if (attempted.get(ctl) === key) return;
  attempted.set(ctl, key);
  pending.add(ctl);
  try {
    const window = new SessionHistoryWindow(ctl.sessionHistory, cwd, [sessionId]);
    await window.open();
    if (ctl.sessionState.disposed || ctl.sessionState.runtimeGeneration !== generation ||
      ctl.sessionState.sessionId !== sessionId || ctl.recoveryState.historyWindow?.sessionIds[0] === sessionId) return;
    ctl.recoveryState.historyWindow = window;
    ctl.recoveryState.historyView = window.snapshot();
    ctl.emit({ type: 'history.window', sessionId, history: window.snapshot()! });
  } catch {
    ctl.recordHost({ level: 'warn', name: 'runtime.history.paging-init', attributes: { sessionId, outcome: 'failed' } });
  } finally { pending.delete(ctl); }
}
