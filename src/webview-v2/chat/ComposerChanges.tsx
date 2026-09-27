import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ComposerChangesView } from '@droidvisx/chat-ui/chat/ComposerChangesView';
import type { ChatPort } from '../host/chatIntent';
import type { ChatState, ChatStore } from './store';
import { createOperationSummarySelector } from './operationSummary';

export function ComposerChanges({ store, port, onStop }: {
  readonly store: ChatStore;
  readonly port: ChatPort;
  readonly onStop: () => void;
}) {
  const select = useMemo(() => {
    const summarize = createOperationSummarySelector();
    return ({ state }: ChatState) => {
      let turnId = state.turn?.turnId ?? null;
      if (turnId === null) {
        for (let index = state.transcript.length - 1; index >= 0; index--) {
          const item = state.transcript[index]!;
          if (item.kind === 'user') break;
          if (item.kind === 'changes' || item.kind === 'image' && item.origin === 'user') continue;
          if (item.turnId !== null) { turnId = item.turnId; break; }
        }
      }
      return { summary: turnId ? summarize(state.transcript).get(turnId) : undefined,
        sessionId: state.connection.status === 'connected' ? state.sessionId : null,
        status: state.turn?.status };
    };
  }, []);
  const { summary, sessionId, status } = useStore(store, useShallow(select));
  if (!summary?.files.size) return null;
  const running = status === 'submitting' || status === 'streaming' || status === 'stopping';
  return <ComposerChangesView key={`${sessionId}:${summary.turnId}`} files={[...summary.files.values()]}
    disabled={sessionId === null} onStop={running ? onStop : undefined} stopLabel={status === 'stopping' ? 'Retry Stop' : 'Stop'}
    onReview={(path) => {
      if (sessionId !== null) port.postMessage({ type: 'review.panel.open', sessionId,
        scopeKind: 'operations', turnId: summary.turnId, ...(path ? { path } : {}) });
    }} />;
}
