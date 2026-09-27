import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { GitStatusFile } from '../../shared/protocol/gitCommitFlow';
import type { GitCommitFlowState } from './gitCommitStore';
import { buildCommitMessageDraft } from './gitCommitDraft';

export interface GitCommitFlowContextValue {
  readonly state: GitCommitFlowState;
  readonly latestChangesTurnId: string | null;
  readonly promptText: string | null;
  readonly onRequestStatus: (turnId: string) => void;
  readonly onCommit: (turnId: string, paths: readonly string[], message: string) => void;
}
export const GitCommitFlowContext = createContext<GitCommitFlowContextValue | null>(null);
export const GIT_FILE_STATUS_LABELS: Record<GitStatusFile['status'], string> = {
  modified: 'modified', added: 'added', deleted: 'deleted', renamed: 'renamed', untracked: 'new', conflicted: 'conflicted',
};

export function useGitCommitEntry(turnId: string | null) {
  const flow = useContext(GitCommitFlowContext);
  const [expanded, setExpanded] = useState(false);
  const isLatest = flow !== null && turnId !== null && flow.latestChangesTurnId === turnId;
  const availability = flow?.state.availability ?? 'unavailable';
  const statusPending = flow?.state.statusPending ?? false;
  const statusIsCurrent = flow?.state.statusTurnId === turnId;
  const currentStatusPending = statusPending && statusIsCurrent;
  const onRequestStatus = flow?.onRequestStatus;
  useEffect(() => {
    if (isLatest && availability !== 'unavailable' && (!statusIsCurrent || availability === 'unknown') && !currentStatusPending && onRequestStatus !== undefined) onRequestStatus(turnId);
  }, [isLatest, availability, statusIsCurrent, currentStatusPending, onRequestStatus, turnId]);
  const committedOk = flow !== null && flow.state.lastResult?.ok === true && flow.state.commitTurnId === turnId;
  useEffect(() => { if (committedOk) setExpanded(false); }, [committedOk]);
  if (flow === null || turnId === null || !isLatest) return { kind: 'hidden' as const };
  if (committedOk && flow.state.lastResult?.ok === true) {
    const { hash, subject } = flow.state.lastResult;
    return { kind: 'notice' as const, text: `Committed${hash === '' ? '' : ` ${hash}`}${subject === '' ? '' : ` · ${subject}`}` };
  }
  if (!statusIsCurrent) return { kind: 'hidden' as const };
  if (flow.state.committedHash !== null) return { kind: 'notice' as const, text: `Committed ${flow.state.committedHash.slice(0, 7)}` };
  if (availability !== 'available') return { kind: 'hidden' as const };
  if (!statusPending && !flow.state.files.some((file) => file.inTurn)) return { kind: 'notice' as const, text: 'No pending turn changes' };
  return {
    kind: expanded ? 'form' as const : 'button' as const,
    flow, turnId,
    open: () => { flow.onRequestStatus(turnId); setExpanded(true); },
    close: () => setExpanded(false),
  };
}

export function useGitCommitDraft(flow: GitCommitFlowContextValue, turnId: string) {
  const { state, promptText } = flow;
  const ready = state.availability === 'available' && !state.statusPending;
  const [initialized, setInitialized] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!ready || initialized) return;
    const defaults = state.files.filter((file) => file.inTurn).map((file) => file.path);
    setSelected(new Set(defaults));
    setMessage(buildCommitMessageDraft(promptText, defaults.length));
    setInitialized(true);
  }, [ready, initialized, state.files, promptText]);
  const toggle = (path: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const failedResult = state.lastResult !== null && !state.lastResult.ok && state.commitTurnId === turnId ? state.lastResult : null;
  const refreshedFailure = useRef<GitCommitFlowState['lastResult']>(null);
  useEffect(() => {
    if (failedResult === null) { refreshedFailure.current = null; return; }
    if (state.statusPending || refreshedFailure.current === failedResult) return;
    refreshedFailure.current = failedResult;
    flow.onRequestStatus(turnId);
  }, [failedResult, flow.onRequestStatus, state.statusPending, turnId]);
  useEffect(() => {
    if (!initialized || state.statusPending) return;
    const available = new Set(state.files.map((file) => file.path));
    setSelected((current) => {
      const next = new Set([...current].filter((path) => available.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [initialized, state.files, state.statusPending]);
  const selectedFilesAreCurrent = [...selected].every((path) => state.files.some((file) => file.path === path));
  const canCommit = initialized && !state.statusPending && !state.commitPending && selected.size > 0 && selectedFilesAreCurrent && message.trim() !== '';
  return { initialized, selected, message, setMessage, toggle, failure: failedResult?.error ?? null, canCommit };
}
