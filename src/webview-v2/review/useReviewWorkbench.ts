import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseReviewHostMessage, type ReviewAgentStateMessage, type ReviewOperationResultMessage,
  type ReviewRestorePreviewStateMessage, type ReviewScopeKind, type ReviewScopeState,
} from '../../shared/protocol/reviewProtocol';
import { isReviewPanelContext, isReviewPanelFile, type ReviewContext, type ReviewPanelContext, type ReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';
import { readHostMessage } from '../bridge/validateHostMessage';
import { useReviewActions } from './useReviewActions';
import { createDiffRefreshQueue } from './diffRefreshQueue';
import { applyTheme } from '../shell/theme';
import { useReviewScopeRequests } from './useReviewScopeRequests';
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
  const [contextPreference, setContext] = useState<ReviewContext>(3);
  const [selectedEdits, setSelectedEdits] = useState<ReadonlyMap<string, string | undefined>>(new Map());
  const requests = useReviewScopeRequests(port, setError);
  const requestsRef = useRef(requests); requestsRef.current = requests;
  const reviewRef = useRef(review); reviewRef.current = review;
  const scopePending = requests.pending;
  const identity = useRef<ReviewPanelContext | null>(null);
  const fileRead = useRef<{
    scopeId: string; path: string; version: string | null; lifecycle?: ReviewScopeState['lifecycle'];
    queue: ReturnType<typeof createDiffRefreshQueue<ReviewPanelFile>>;
  } | null>(null);
  const sequence = useRef(0);
  const listedBranchSession = useRef<string | null>(null);
  const nativeRequest = useRef<string | null>(null);
  const current = review?.currentIndex == null ? null : review.files[review.currentIndex] ?? null;
  const sessionId = target?.valid && !target.operation ? target.sessionId : null;
  const context = review?.scopeKind === 'operations' || review?.recordedOnly ? 3 : contextPreference;
  const scopeId = review?.reviewScopeId;
  const baseline = review?.baseline;
  const path = current?.path;
  const initialToolUseId = (review?.scopeKind === 'operations' || review?.scopeKind === 'turn') &&
    (!target?.operationPath || target.operationPath === path) ? target?.toolUseId : undefined;
  const selectionKey = sessionId && scopeId && baseline && path
    ? JSON.stringify([sessionId, scopeId, baseline, path, initialToolUseId]) : null;
  const fileKey = selectionKey ? JSON.stringify([selectionKey, context]) : null;
  const toolUseId = selectionKey && selectedEdits.has(selectionKey) ? selectedEdits.get(selectionKey) : initialToolUseId;
  const selectRecordedEdit = useCallback((toolUseId: string | undefined) => {
    if (selectionKey) setSelectedEdits(previous => new Map(previous).set(selectionKey, toolUseId));
  }, [selectionKey]);
  const file = fileState?.key === fileKey ? fileState.value : null;
  const fileRefreshing = fileStatus?.key === fileKey && fileStatus.pending;
  const fileError = fileStatus?.key === fileKey ? fileStatus.error : null;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const value: unknown = event.data;
      if (isReviewPanelContext(value)) {
        const changed = identity.current?.sessionId !== value.sessionId || !value.valid || value.resetReview === true;
        identity.current = value;
        if (!requestsRef.current.request.current || changed) setTarget(value);
        if (changed) {
          listedBranchSession.current = null;
          requestsRef.current.reset();
          fileRead.current?.queue.dispose(); fileRead.current = null;
          setReview(null); setFileState(null); setFileStatus(null); setPreview(null); setAgent(null);
          setSelectedEdits(new Map()); setOperation(null); setError(null); reviewRef.current = null;
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
        const scopes = requestsRef.current;
        if (message.type === 'review.branches') { scopes.receiveBranches(message); return; }
        if (message.type === 'review.state') {
          if (message.requestId) {
            if (!scopes.matches(message.requestId, sessionId)) return;
            scopes.cancel(); setTarget(identity.current); setPreview(null); setOperation(null); setAgent(null);
          } else if (scopes.request.current || (reviewRef.current &&
            (reviewRef.current.scopeKind !== message.state.scopeKind || reviewRef.current.turnId !== message.state.turnId))) return;
          const read = fileRead.current;
          // Host messages can arrive in one React batch. Invalidate the live
          // request before a following file response can cross this boundary.
          if (read?.scopeId === message.state.reviewScopeId && read.lifecycle !== undefined && read.lifecycle !== message.state.lifecycle)
            read.queue.discardInFlight();
          reviewRef.current = message.state;
          setReview(message.state); setError(null);
        } else if (message.type === 'review.restorePreview') setPreview(message);
        else if (message.type === 'review.operationResult') {
          if (message.requestId && !scopes.matches(message.requestId, sessionId)) return;
          setOperation(message);
          if (!message.ok) {
            if (message.requestId) scopes.cancel();
            setError(message.message);
          }
          if (message.operation === 'restore-file' || message.operation === 'restore-turn') setPreview(null);
        } else setAgent(message);
        return;
      }
      const host = readHostMessage(value);
      if (host?.type === 'ui.theme') applyTheme(host.preference, host.resolved);
      if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'reviewPanel.error' &&
        'message' in value && typeof value.message === 'string') {
        const scopes = requestsRef.current;
        if ('sessionId' in value && value.sessionId !== identity.current?.sessionId) return;
        if ('requestId' in value && typeof value.requestId === 'string') {
          if (scopes.matches(value.requestId)) scopes.cancel();
          else if (value.requestId !== nativeRequest.current || scopes.request.current) return;
        }
        setError(value.message.slice(0, 4_000));
      }
    };
    window.addEventListener('message', receive);
    port.postMessage({ type: 'reviewPanel.ready' });
    return () => window.removeEventListener('message', receive);
  }, [port]);
  useEffect(() => {
    setFileState((previous) => previous?.key === fileKey ? previous : null);
    setFileStatus(null);
    if (!fileKey || !sessionId || !scopeId || !baseline || !path) return;
    const queue = createDiffRefreshQueue<ReviewPanelFile>({
      createId: () => `review-file-${++sequence.current}`,
      send: (requestId) => port.postMessage({ type: 'reviewPanel.readFile', requestId,
        reviewScopeId: scopeId, baseline, path, context, ...(toolUseId ? { toolUseId } : {}) }),
      pending: () => setFileStatus({ key: fileKey, pending: true, error: null }),
      receive: (value) => {
        setFileStatus({ key: fileKey, pending: false, error: value.error });
        setFileState((previous) => value.error && previous?.key === fileKey && !previous.value.error
          ? previous : { key: fileKey, value });
        if (!toolUseId && value.recordedOperations?.length) {
          const entry = [...value.recordedOperations].reverse().find(entry => entry.source === 'tool-result' && entry.outcome === 'applied') ?? value.recordedOperations.at(-1);
          if (entry) setSelectedEdits(previous => previous.has(selectionKey!) ? previous : new Map(previous).set(selectionKey!, entry.toolUseId));
        }
      },
      timeout: () => setFileStatus({ key: fileKey, pending: false, error: 'Could not refresh this diff. Try again.' }),
    });
    fileRead.current = { scopeId, path, version: null, queue };
    return () => { queue.dispose(); fileRead.current = null; };
  }, [port, fileKey, sessionId, scopeId, baseline, path, context, toolUseId, selectionKey]);
  useEffect(() => {
    const read = fileRead.current;
    if (!fileKey || !read) return;
    const version = JSON.stringify([current?.version, review?.lifecycle]);
    if (read.version === version) return;
    const first = read.version === null;
    const phaseChanged = !first && read.lifecycle !== review?.lifecycle;
    read.version = version;
    read.lifecycle = review?.lifecycle;
    read.queue.refresh(first || review?.lifecycle !== 'writing' ? 0 : 200, phaseChanged);
  }, [fileKey, current?.version, review?.lifecycle, toolUseId]);
  const { actions } = useReviewActions(port, target?.valid ? target.sessionId : null, review);
  useEffect(() => {
    if (sessionId && review?.scopeKind === 'branch' && !requests.branches && !requests.pending && listedBranchSession.current !== sessionId) {
      listedBranchSession.current = sessionId;
      requests.chooseBranch(sessionId, false);
    }
  }, [sessionId, review?.scopeKind, requests]);
  const openScope = useCallback((kind: ReviewScopeKind, baseBranch?: string) => {
    if (!target?.valid || !target.sessionId) return;
    const turnScope = kind === 'turn' || kind === 'operations';
    const turnId = turnScope ? review?.turnId ?? target.latestTurnId ?? undefined : undefined;
    if (turnScope && !turnId) return;
    if (kind === 'branch' && !baseBranch) requests.chooseBranch(target.sessionId);
    else requests.open(target.sessionId, kind, turnId, baseBranch);
  }, [requests, target, review?.turnId]);
  const refresh = () => {
    if (!target?.sessionId || !target.valid) return;
    if (review) openScope(review.scopeKind, review.baseBranch);
    else openScope('workspace');
  };
  const openNative = () => {
    nativeRequest.current = `native-${++sequence.current}`;
    if (review && current) port.postMessage({ type: 'reviewPanel.openNative',
      requestId: nativeRequest.current, reviewScopeId: review.reviewScopeId,
      baseline: review.baseline, path: current.path, context, ...(toolUseId ? { toolUseId } : {}) });
  };
  const retryFile = useCallback(() => fileRead.current?.queue.refresh(0), []);
  return { target, review, file, current, preview, operation, agent, error, context, scopePending,
    branches: requests.branches, choosingBranch: requests.choosingBranch,
    fileRefreshing, fileError, retryFile, selectedToolUseId: toolUseId,
    setContext, setPreview, selectRecordedEdit, actions, openScope, refresh, openNative };
}
