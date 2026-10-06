import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseReviewHostMessage, type ReviewAgentStateMessage, type ReviewOperationResultMessage,
  type ReviewRestorePreviewStateMessage, type ReviewScopeKind, type ReviewScopeState,
} from '../../shared/protocol/reviewProtocol';
import { isReviewPanelContext, isReviewPanelFile, type ReviewContext, type ReviewPanelContext } from '../../shared/protocol/reviewPanelProtocol';
import { readHostMessage } from '../bridge/validateHostMessage';
import { useReviewActions } from './useReviewActions';
import { ReviewFileReads } from './reviewFileReads';
import { applyTheme } from '../shell/theme';
import { useReviewScopeRequests } from './useReviewScopeRequests';
export interface ReviewPort { postMessage(message: unknown): void }

export function useReviewWorkbench(port: ReviewPort) {
  const [target, setTarget] = useState<ReviewPanelContext | null>(null);
  const [review, setReview] = useState<ReviewScopeState | null>(null);
  const [, renderFiles] = useState(0);
  const [fileReads] = useState(() => new ReviewFileReads(port, () => renderFiles(value => value + 1)));
  const [preview, setPreview] = useState<ReviewRestorePreviewStateMessage | null>(null);
  const [operation, setOperation] = useState<ReviewOperationResultMessage | null>(null);
  const [agent, setAgent] = useState<ReviewAgentStateMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextPreference, setContext] = useState<ReviewContext>(3);
  const requests = useReviewScopeRequests(port, setError);
  const requestsRef = useRef(requests); requestsRef.current = requests;
  const reviewRef = useRef(review); reviewRef.current = review;
  const scopePending = requests.pending;
  const identity = useRef<ReviewPanelContext | null>(null);
  const sequence = useRef(0);
  const listedBranchSession = useRef<string | null>(null);
  const nativeRequest = useRef<string | null>(null);
  const current = review?.currentIndex == null ? null : review.files[review.currentIndex] ?? null;
  const sessionId = target?.valid && !target.operation ? target.sessionId : null;
  const context = review?.scopeKind === 'operations' || review?.recordedOnly ? 3 : contextPreference;
  const contextRef = useRef(context); contextRef.current = contextPreference;
  const currentRead = fileReads.get(current?.path);
  const { file, pending: fileRefreshing, error: fileError, toolUseId } = currentRead;
  const selectRecordedEdit = useCallback((toolUseId: string | undefined, path = current?.path) => {
    if (path) fileReads.selectEdit(path, toolUseId);
  }, [fileReads, current?.path]);
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
          fileReads.reset();
          setReview(null); setPreview(null); setAgent(null);
          setOperation(null); setError(null); reviewRef.current = null;
        }
        return;
      }
      if (isReviewPanelFile(value)) {
        if (identity.current?.valid) fileReads.receive(value);
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
          fileReads.update(identity.current, message.state,
            message.state.scopeKind === 'operations' || message.state.recordedOnly ? 3 : contextRef.current);
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
  }, [port, fileReads]);
  useEffect(() => {
    fileReads.update(target, review, context);
    if (current) fileReads.ensure(current.path);
  }, [fileReads, target, review, context, current]);
  useEffect(() => () => fileReads.reset(), [fileReads]);
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
  const openNative = (path = current?.path) => {
    nativeRequest.current = `native-${++sequence.current}`;
    const selectedEdit = fileReads.get(path).toolUseId;
    if (review && path) port.postMessage({ type: 'reviewPanel.openNative',
      requestId: nativeRequest.current, reviewScopeId: review.reviewScopeId,
      baseline: review.baseline, path, context, ...(selectedEdit ? { toolUseId: selectedEdit } : {}) });
  };
  const retryFile = useCallback((path = current?.path) => { if (path) fileReads.retry(path); }, [fileReads, current?.path]);
  return { target, review, fileReads, file, current, preview, operation, agent, error, context, scopePending,
    branches: requests.branches, choosingBranch: requests.choosingBranch,
    fileRefreshing, fileError, retryFile, selectedToolUseId: toolUseId,
    setContext, setPreview, selectRecordedEdit, actions, openScope, refresh, openNative };
}
