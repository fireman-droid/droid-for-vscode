import type { ChatController } from '../ChatController';
import type { HistoryNavigateMessage } from '../../../shared/protocol/historyPaging';
import { SessionHistoryWindow } from '../../../runtime/history/SessionHistoryWindow';
import { historyWithLocalChanges } from '../../recovery/historyWithLocalChanges';

export async function navigateHistory(ctl: ChatController, request: HistoryNavigateMessage): Promise<void> {
  const { historyWindow: window, historyView: view } = ctl.recoveryState;
  if (!window || !view || request.sessionId !== ctl.sessionState.sessionId ||
    window.sessionIds[0] !== request.sessionId || request.version !== view.version ||
    request.revision !== view.revision || view.loading !== null) return;
  const generation = ctl.sessionState.runtimeGeneration;
  const current = () => !ctl.sessionState.disposed && ctl.sessionState.runtimeGeneration === generation &&
    ctl.sessionState.sessionId === request.sessionId && ctl.recoveryState.historyWindow === window;
  const emit = () => {
    if (ctl.recoveryState.historyView) ctl.emit({ type: 'history.window', sessionId: request.sessionId,
      history: ctl.recoveryState.historyView });
  };
  ctl.recoveryState.historyView = { ...view, loading: request.direction, error: null };
  emit();
  try {
    let nextWindow = window;
    if (request.direction === 'latest') {
      nextWindow = new SessionHistoryWindow(ctl.sessionHistory, window.cwd, window.sessionIds);
      await nextWindow.open();
    } else {
      const live = ctl.recoveryState.transcript.transcript;
      const liveIds = new Set(live.flatMap(item => item.kind === 'user' && item.messageId ? [item.messageId] : []));
      const anchor = live.find(item => item.kind === 'user' && item.messageId);
      const overlap = view.items.some(item => item.kind === 'user' && item.messageId && liveIds.has(item.messageId));
      if (request.direction === 'older' && !view.hasNewer && !overlap && anchor?.kind === 'user' && anchor.messageId) {
        nextWindow = new SessionHistoryWindow(ctl.sessionHistory, window.cwd, window.sessionIds, anchor.messageId);
        await nextWindow.open();
      } else await window.navigate(request.direction);
    }
    if (!current()) return;
    const next = nextWindow.snapshot()!;
    const conversation = ctl.sessionState.conversationId === null ? undefined :
      ctl.recoveryStore.readConversation(ctl.sessionState.conversationId);
    const enriched = historyWithLocalChanges({
      transcript: next.items, historyStatus: next.truncated ? 'partial' : 'complete', truncated: next.truncated,
    }, conversation);
    ctl.recoveryState.historyWindow = nextWindow;
    ctl.recoveryState.historyView = { ...next, items: enriched.transcript };
    emit();
  } catch {
    if (!current()) return;
    ctl.recoveryState.historyView = { ...view, loading: null,
      error: 'Could not load history. Retry or return to the latest messages.' };
    emit();
  }
}
