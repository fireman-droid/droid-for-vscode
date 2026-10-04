import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewBranchesMessage, ReviewOpenMessage, ReviewScopeKind } from '../../shared/protocol/reviewProtocol';
import type { ReviewPort } from './useReviewWorkbench';

/** Correlates scope changes without discarding the last readable comparison. */
export function useReviewScopeRequests(port: ReviewPort, onError: (message: string | null) => void) {
  const [pending, setPending] = useState(false);
  const [choosingBranch, setChoosingBranch] = useState(false);
  const [branches, setBranches] = useState<ReviewBranchesMessage | null>(null);
  const sequence = useRef(0);
  const autoOpenBranch = useRef(true);
  const request = useRef<{ id: string; sessionId: string; kind: 'scope' | 'branches'; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancel = useCallback(() => {
    if (request.current) clearTimeout(request.current.timer);
    request.current = null;
    setPending(false);
  }, []);
  const start = useCallback((sessionId: string, kind: 'scope' | 'branches') => {
    cancel(); onError(null); setPending(true);
    const id = `review-scope-${++sequence.current}`;
    const timer = setTimeout(() => {
      if (request.current?.id !== id) return;
      cancel(); onError('This comparison did not finish loading. Refresh or choose the scope again.');
    }, 35_000);
    request.current = { id, sessionId, kind, timer };
    return id;
  }, [cancel, onError]);
  const open = useCallback((sessionId: string, scopeKind: ReviewScopeKind, turnId?: string, baseBranch?: string) => {
    setChoosingBranch(scopeKind === 'branch');
    const requestId = start(sessionId, 'scope');
    port.postMessage({ type: 'review.open', sessionId, scopeKind, requestId,
      ...(turnId ? { turnId } : {}), ...(baseBranch ? { baseBranch } : {}) } satisfies ReviewOpenMessage);
  }, [port, start]);
  const chooseBranch = useCallback((sessionId: string, autoOpen = true) => {
    autoOpenBranch.current = autoOpen;
    setChoosingBranch(true); setBranches(null);
    const requestId = start(sessionId, 'branches');
    port.postMessage({ type: 'review.listBranches', sessionId, requestId });
  }, [port, start]);
  const matches = useCallback((requestId: string | undefined, sessionId?: string) =>
    !!requestId && request.current?.id === requestId && (!sessionId || request.current.sessionId === sessionId), []);
  const receiveBranches = useCallback((message: ReviewBranchesMessage) => {
    if (!matches(message.requestId, message.sessionId)) return;
    cancel(); setBranches(message);
    if (message.defaultBranch && autoOpenBranch.current) open(message.sessionId, 'branch', undefined, message.defaultBranch);
  }, [cancel, matches, open]);
  const reset = useCallback(() => { cancel(); setBranches(null); setChoosingBranch(false); }, [cancel]);
  useEffect(() => () => { if (request.current) clearTimeout(request.current.timer); }, []);
  return { pending, request, branches, choosingBranch, open, chooseBranch, matches, receiveBranches, cancel, reset };
}
