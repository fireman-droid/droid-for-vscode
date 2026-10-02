import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { InlineDiffResult } from '../../shared/protocol/inlineDiffProtocol';
import { createTurnId, post, type ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { createDiffRefreshQueue } from './diffRefreshQueue';

export const INLINE_DIFF_UNAVAILABLE = {
  unavailable: 'The snapshots for this turn are unavailable.',
  'not-found': 'This file is absent from both sides of this comparison. No file change was recorded.',
  'too-large': 'This file is too large for an inline preview.',
  binary: 'Binary or non-UTF-8 files cannot be previewed inline.',
  'read-failed': 'Could not load this diff. Try again.',
} as const;

export const InlineDiffContext = createContext<{
  readonly port: ChatPort;
  readonly sessionId: string | null;
  readonly connected: boolean;
} | null>(null);

export function useInlineDiff(path: string, turnId: string, enabled: boolean) {
  const context = useContext(InlineDiffContext);
  const refresh = useRef<(() => void) | null>(null);
  const [response, setResponse] = useState<{
    readonly context: typeof context;
    readonly path: string;
    readonly turnId: string;
    readonly result: InlineDiffResult;
    readonly refreshing: boolean;
    readonly refreshFailed: boolean;
  } | null>(null);
  useEffect(() => {
    setResponse(null);
    if (!enabled || !context?.connected || context.sessionId === null) return;
    const { port, sessionId } = context;
    let invalidationSequence = -1;
    let settled = false;
    const save = (result: InlineDiffResult): void => {
      setResponse((previous) =>
        result.status === 'read-failed' && previous?.context === context &&
          previous.path === path && previous.turnId === turnId && previous.result.status === 'ready'
          ? { ...previous, refreshing: false, refreshFailed: true }
          : { context, path, turnId, result, refreshing: false, refreshFailed: false });
    };
    const queue = createDiffRefreshQueue<InlineDiffResult>({
      createId: createTurnId,
      send: (requestId) => post(port, { type: 'file.readDiff', sessionId, turnId, path, requestId }),
      pending: () => setResponse((previous) =>
        previous?.context === context && previous.path === path && previous.turnId === turnId
          ? { ...previous, refreshing: true, refreshFailed: false } : previous),
      receive: save,
      timeout: () => save({ status: 'read-failed' }),
    });
    refresh.current = () => queue.refresh(0);
    const unsubscribe = subscribeHostMessages((message) => {
      if (message.type === 'file.diff' && message.sessionId === sessionId &&
        message.turnId === turnId && message.path === path) {
        queue.receive(message.requestId, message.result);
      } else if (message.type === 'file.diff.invalidate' && !settled &&
        message.sessionId === sessionId && message.turnId === turnId &&
        message.paths.includes(path) && message.sequence > invalidationSequence) {
        invalidationSequence = message.sequence;
        queue.refresh();
      } else if (message.type === 'changes.update' && message.state === 'settled' &&
        message.sessionId === sessionId && message.turnId === turnId &&
        message.sequence > invalidationSequence) {
        invalidationSequence = message.sequence;
        settled = true;
        queue.refresh(0, true);
      }
    });
    queue.refresh(0);
    return () => {
      refresh.current = null;
      queue.dispose();
      unsubscribe();
    };
  }, [context, path, turnId, enabled]);
  const current = response?.context === context && response.path === path && response.turnId === turnId ? response : null;
  const result = !context?.connected || context.sessionId === null
    ? { status: 'unavailable' as const }
    : current?.result ?? null;
  const retry = useCallback(() => refresh.current?.(), []);
  return { result, retry, refreshing: current?.refreshing === true, refreshFailed: current?.refreshFailed === true };
}
