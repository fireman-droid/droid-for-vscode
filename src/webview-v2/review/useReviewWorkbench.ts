import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseReviewHostMessage, type ReviewAgentStateMessage, type ReviewOperationResultMessage,
  type ReviewRestorePreviewStateMessage, type ReviewScopeKind, type ReviewScopeState,
} from '../../shared/protocol/reviewProtocol';
import { isReviewPanelContext, isReviewPanelFile, type ReviewPanelContext, type ReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';
import { readHostMessage } from '../bridge/validateHostMessage';
import { useReviewActions } from './useReviewActions';
import { createDiffRefreshQueue } from './diffRefreshQueue';
import { applyTheme } from '../shell/theme';
export interface ReviewPort { postMessage(message: unknown): void }

export function useReviewWorkbench(port: ReviewPort) {
  const [target, setTarget] = useState<ReviewPanelContext | null>(null);
  const [review, setReview] = useState<ReviewScopeState | null>(null);
  const [fileState, setFileState] = useState<{ key: string; value: ReviewPanelFile } | null>(null);
  const [fileStatus, setFileStatus] = useState<{ key: string; pending: boolean; error: string | null } | null>(null);
  const [preview, setPreview] = useState<ReviewRestorePreviewStateMessage | null>(null);
  const [operation, setOperation] = useState<ReviewOperationResultMessage | null>(null);
  const [agent, setAgent] = useState<ReviewAgentStateMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<3 | 20 | 100>(3);
  const [scopePending, setScopePending] = useState(false);
  const identity = useRef<ReviewPanelContext | null>(null);
  const fileRead = useRef<{
    scopeId: string; path: string; version: string | null;
    queue: ReturnType<typeof createDiffRefreshQueue<ReviewPanelFile>>;
  } | null>(null);
  const pendingScope = useRef<{ kind: ReviewScopeKind; turnId?: string } | null>(null);
  const sequence = useRef(0);
  const current = review?.currentIndex == null ? null : review.files[review.currentIndex] ?? null;
  const sessionId = target?.valid && !target.operation && !scopePending ? target.sessionId : null;
  const scopeId = review?.reviewScopeId;
  const baseline = review?.baseline;
  const path = current?.path;
  const fileKey = sessionId && scopeId && baseline && path
    ? JSON.stringify([sessionId, scopeId, baseline, path, context]) : null;
  const file = fileState?.key === fileKey ? fileState.value : null;
  const fileRefreshing = fileStatus?.key === fileKey && fileStatus.pending;
  const fileError = fileStatus?.key === fileKey ? fileStatus.error : null;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const value: unknown = event.data;
      if (isReviewPanelContext(value)) {
        const changed = identity.current?.sessionId !== value.sessionId || !value.valid;
        identity.current = value;
        setTarget(value);
        if (changed) {
          fileRead.current?.queue.dispose(); fileRead.current = null;
          setReview(null); setFileState(null); setPreview(null); setAgent(null);
        }
        return;
      }
      if (isReviewPanelFile(value)) {
        const read = fileRead.current;
        if (identity.current?.valid && read?.scopeId === value.reviewScopeId && read.path === value.path)
          read.queue.receive(value.requestId, value);
        return;
      }
      const message = parseReviewHostMessage(value);
      if (message && identity.current?.valid) {
        const sessionId = message.type === 'review.state' ? message.state.sessionId : message.sessionId;
        if (sessionId !== identity.current.sessionId) return;
        if (message.type === 'review.state') {
          const pending = pendingScope.current;
          if (pending && (message.state.scopeKind !== pending.kind || message.state.turnId !== pending.turnId)) return;
          pendingScope.current = null;
          setScopePending(false); setReview(message.state); setError(null);
        } else if (message.type === 'review.restorePreview') setPreview(message);
        else if (message.type === 'review.operationResult') {
          setOperation(message);
          if (!message.ok) { setScopePending(false); pendingScope.current = null; setError(message.message); }
          if (message.operation === 'restore-file' || message.operation === 'restore-turn') setPreview(null);
        } else setAgent(message);
        return;
      }
      const host = readHostMessage(value);
      if (host?.type === 'ui.theme') applyTheme(host.preference, host.resolved);
      if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'reviewPanel.error' &&
        'message' in value && typeof value.message === 'string') {
        setError(value.message.slice(0, 4_000)); setScopePending(false);
      }
    };
    window.addEventListener('message', receive);
    port.postMessage({ type: 'reviewPanel.ready' });
    return () => window.removeEventListener('message', receive);
  }, [port]);
  useEffect(() => {
    setFileState(null);
    setFileStatus(null);
    if (!fileKey || !sessionId || !scopeId || !baseline || !path) return;
    const queue = createDiffRefreshQueue<ReviewPanelFile>({
      createId: () => `review-file-${++sequence.current}`,
      send: (requestId) => port.postMessage({ type: 'reviewPanel.readFile', requestId,
        reviewScopeId: scopeId, baseline, path, context }),
      pending: () => setFileStatus({ key: fileKey, pending: true, error: null }),
      receive: (value) => {
        setFileStatus({ key: fileKey, pending: false, error: value.error });
        setFileState((previous) => value.error && previous?.key === fileKey && !previous.value.error
          ? previous : { key: fileKey, value });
      },
      timeout: () => setFileStatus({ key: fileKey, pending: false, error: 'Could not refresh this diff. Try again.' }),
    });
    fileRead.current = { scopeId, path, version: null, queue };
    return () => { queue.dispose(); fileRead.current = null; };
  }, [port, fileKey, sessionId, scopeId, baseline, path, context]);
  useEffect(() => {
    const read = fileRead.current;
    if (!fileKey || !read) return;
    const version = JSON.stringify([current?.version, review?.lifecycle]);
    if (read.version === version) return;
    const first = read.version === null;
    read.version = version;
    read.queue.refresh(first || review?.lifecycle !== 'writing' ? 0 : 200);
  }, [fileKey, current?.version, review?.lifecycle]);
  const { actions } = useReviewActions(port, target?.valid ? target.sessionId : null, review);
  const openScope = useCallback((kind: ReviewScopeKind) => {
    if (!target?.valid || !target.sessionId) return;
    const turnScope = kind === 'turn' || kind === 'operations';
    const turnId = turnScope ? review?.turnId ?? target.latestTurnId ?? undefined : undefined;
    if (turnScope && !turnId) return;
    pendingScope.current = { kind, ...(turnId ? { turnId } : {}) };
    fileRead.current?.queue.dispose(); fileRead.current = null;
    setFileState(null); setPreview(null); setError(null); setScopePending(true);
    actions.onOpenScope(kind, turnId);
  }, [actions, target, review?.turnId]);
  const refresh = () => {
    if (!target?.sessionId || !target.valid) return;
    if (review) actions.onOpenScope(review.scopeKind, review.turnId);
    else openScope('workspace');
  };
  const openNative = () => {
    if (review && current) port.postMessage({ type: 'reviewPanel.openNative',
      requestId: `native-${++sequence.current}`, reviewScopeId: review.reviewScopeId,
      baseline: review.baseline, path: current.path, context });
  };
  const retryFile = useCallback(() => fileRead.current?.queue.refresh(0), []);
  return { target, review, file, current, preview, operation, agent, error, context, scopePending,
    fileRefreshing, fileError, retryFile,
    setContext, setPreview, actions, openScope, refresh, openNative };
}
