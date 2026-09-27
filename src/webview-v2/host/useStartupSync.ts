import { useCallback, useEffect, useRef, useState } from 'react';
import { announceReady } from '../bridge/vscode';
import type { AssistantWebviewState, StoreHostMessage } from '../state/types';
import type { ChatPort } from './chatIntent';

type StartupState = Pick<AssistantWebviewState, 'sequence' | 'connection' | 'sessionId'>;

function isSettled(state: Pick<StartupState, 'connection' | 'sessionId'>): boolean {
  return state.connection.status === 'unavailable' ||
    (state.connection.status === 'connected' && state.sessionId !== null);
}

/** Repair a missed startup handshake/snapshot without restarting the session. */
export function useStartupSync(port: ChatPort, state: StartupState) {
  const current = useRef(state);
  current.current = state;
  const finished = useRef(state.sequence >= 0 && isSettled(state));
  const [snapshotSequence, setSnapshotSequence] = useState<number | null>(null);
  const committed = snapshotSequence !== null && state.sequence >= snapshotSequence && isSettled(state);
  const settled = finished.current || committed;

  const observeSnapshot = useCallback((message: StoreHostMessage): void => {
    if (!finished.current && message.type === 'host.snapshot' &&
        message.sequence > current.current.sequence && isSettled(message) &&
        message.sessions.status !== 'loading') {
      setSnapshotSequence(message.sequence);
    }
  }, []);

  useEffect(() => {
    if (settled) {
      finished.current = true;
      return;
    }
    let delay = 5_000;
    let due = Date.now() + delay;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const retry = (): void => {
      timer = null;
      if (document.hidden) return;
      announceReady(port);
      delay = Math.min(delay * 2, 30_000);
      due = Date.now() + delay;
      timer = setTimeout(retry, delay);
    };
    const onVisibilityChange = (): void => {
      if (document.hidden) return;
      if (timer !== null) clearTimeout(timer);
      const remaining = due - Date.now();
      if (remaining <= 0) retry();
      else timer = setTimeout(retry, remaining);
    };
    timer = setTimeout(retry, delay);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [port, settled]);

  return observeSnapshot;
}
