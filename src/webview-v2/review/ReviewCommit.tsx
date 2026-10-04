import { useEffect, useRef, useState } from 'react';
import type { GitCommitMode, GitStatusMessage } from '../../shared/protocol/gitCommitFlow';
import { mergeGitStatusPage } from '../../shared/protocol/gitStatusPaging';
import { readHostMessage } from '../bridge/validateHostMessage';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import type { ReviewPort } from './useReviewWorkbench';
export function ReviewCommit({ port, sessionId, onClose, initialMode = 'files' }: {
  port: ReviewPort; sessionId: string; onClose(): void; initialMode?: GitCommitMode;
}) {
  const [report, setReport] = useState<{ status: GitStatusMessage; complete: boolean } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<GitCommitMode>(initialMode);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const value = readHostMessage(event.data);
      if (value?.type === 'git.status' && value.sessionId === sessionId && value.turnId === 'review') {
        setReport(previous => {
          const merged = mergeGitStatusPage(previous?.status ?? null, value);
          if (!merged) return previous;
          return { status: { ...value, files: merged.files }, complete: merged.complete };
        });
      }
      if (value?.type === 'git.commitResult' && value.sessionId === sessionId && value.turnId === 'review') {
        setPending(false);
        if (value.ok) close.current(); else setFailure(value.error);
      }
      if (event.data?.type === 'reviewPanel.error' && !event.data.requestId &&
        (event.data.sessionId === undefined || event.data.sessionId === sessionId) && typeof event.data.message === 'string') {
        setPending(false); setFailure(event.data.message.slice(0, 4_000));
      }
    };
    window.addEventListener('message', receive);
    port.postMessage({ type: 'reviewPanel.gitStatus' });
    return () => window.removeEventListener('message', receive);
  }, [port, sessionId]);
  const status = report?.status;
  const ready = !!report?.complete && !!status?.snapshotId && !status.unavailableReason;
  const files = status?.files.filter(file => mode === 'files' || file.staged) ?? [];
  const pages = Math.max(1, Math.ceil(files.length / 100));
  const visiblePage = Math.min(page, pages - 1);
  const unselectedStaged = status?.files.filter(file => file.staged && !selected.has(file.path)).length ?? 0;
  const selectedCurrent = [...selected].every(path => files.some(file => file.path === path));
  const canCommit = ready && !pending && !!message.trim() && selected.size > 0 && selectedCurrent && !unselectedStaged;
  return <section className="review-commit" role="group" aria-label="Commit changes" aria-busy={pending || !report?.complete}>
    <header><strong>Commit changes</strong><span>{status?.branch ?? ''}</span></header>
    {!report?.complete ? <p className="review-commit-notice" role="status">Reading Git status…</p> : status?.unavailableReason ? <p className="review-commit-notice review-error" role="alert">Git unavailable: {status.unavailableReason}</p> : <>
      <Select value={mode} disabled={pending} onValueChange={value => {
        if (value === 'files' || value === 'staged') { setMode(value); setSelected(new Set()); setPage(0); }
      }}><SelectTrigger aria-label="Commit source"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="files">Working files · stage selected files in full</SelectItem>
        <SelectItem value="staged">Index · preserve staged changes</SelectItem>
      </SelectContent></Select>
      <div className="flex items-center justify-between gap-2"><span>{selected.size} selected · {files.length} files</span>
        <Button variant="ghost" size="sm" disabled={pending || !ready} onClick={() => setSelected(new Set(files.map(file => file.path)))}>Select all {files.length} files</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setSelected(new Set())}>Clear</Button>
      </div>
      <div className="review-commit-files">{files.slice(visiblePage * 100, (visiblePage + 1) * 100).map((file) => <label key={file.path} data-selected={selected.has(file.path)} data-disabled={pending}>
        <Checkbox checked={selected.has(file.path)} disabled={pending || !ready} onCheckedChange={() => setSelected((old) => {
          const next = new Set(old); if (next.has(file.path)) next.delete(file.path); else next.add(file.path); return next;
        })} /><span>{file.path}</span><small>{file.status}{file.staged ? ' · staged' : ''}</small>
      </label>)}</div>
      {pages > 1 ? <div className="flex items-center justify-between"><Button variant="ghost" size="sm" disabled={!visiblePage || pending} onClick={() => setPage(visiblePage - 1)}>Previous</Button>
        <span>Page {visiblePage + 1} of {pages}</span><Button variant="ghost" size="sm" disabled={visiblePage + 1 >= pages || pending} onClick={() => setPage(visiblePage + 1)}>Next</Button></div> : null}
      <p className="review-muted">{mode === 'staged' ? 'Commit the current index. Unstaged edits stay in the working tree.' : 'Selected files will be staged in full, including unstaged edits.'} Nothing is pushed.</p>
      <Textarea aria-label="Commit message" placeholder="Commit message" rows={3} maxLength={4_000} disabled={pending} value={message} onChange={(event) => setMessage(event.target.value)} />
      {unselectedStaged ? <p className="review-commit-notice" role="status">Include the {unselectedStaged} already-staged file(s), or adjust the index before committing.</p> : null}
    </>}
    {failure ? <p role="alert" className="review-commit-notice review-error">{failure}</p> : null}
    <footer><Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
      <Button disabled={!canCommit} onClick={() => {
        setPending(true); setFailure(null); port.postMessage({ type: 'reviewPanel.commit', paths: [...selected], message, snapshotId: status!.snapshotId, mode });
      }}>{pending ? 'Committing…' : mode === 'staged' ? 'Commit staged changes' : 'Commit selected files'}</Button>
    </footer>
  </section>;
}
