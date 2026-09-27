import { useEffect, useState } from 'react';
import type { GitStatusMessage } from '../../shared/protocol/gitCommitFlow';
import { readHostMessage } from '../bridge/validateHostMessage';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Checkbox } from '../ui/selection';
import type { ReviewPort } from './useReviewWorkbench';
export function ReviewCommit({ port, sessionId, onClose }: { port: ReviewPort; sessionId: string; onClose(): void }) {
  const [status, setStatus] = useState<GitStatusMessage | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const value = readHostMessage(event.data);
      if (value?.type === 'git.status' && value.sessionId === sessionId && value.turnId === 'review') setStatus(value);
      if (value?.type === 'git.commitResult' && value.sessionId === sessionId && value.turnId === 'review') {
        setPending(false);
        if (value.ok) onClose(); else setFailure(value.error);
      }
      if (event.data?.type === 'reviewPanel.error' && typeof event.data.message === 'string') {
        setPending(false); setFailure(event.data.message.slice(0, 4_000));
      }
    };
    window.addEventListener('message', receive);
    port.postMessage({ type: 'reviewPanel.gitStatus' });
    return () => window.removeEventListener('message', receive);
  }, [port, sessionId, onClose]);
  const unselectedStaged = status?.files.filter((file) => file.staged && !selected.has(file.path)) ?? [];
  return <section className="review-commit" role="group" aria-label="Commit changes" aria-busy={pending}>
    <header><strong>Commit changes</strong><span>{status?.branch ?? ''}</span></header>
    {!status ? <p className="review-commit-notice" role="status">Reading Git status…</p> : status.unavailableReason ? <p className="review-commit-notice review-error" role="alert">Git unavailable: {status.unavailableReason}</p> : <>
      <div className="review-commit-files">{status.files.map((file) => <label key={file.path} data-selected={selected.has(file.path)} data-disabled={pending}>
        <Checkbox checked={selected.has(file.path)} disabled={pending} onCheckedChange={() => setSelected((old) => {
          const next = new Set(old); if (next.has(file.path)) next.delete(file.path); else next.add(file.path); return next;
        })} /><span>{file.path}</span><small>{file.status}{file.staged ? ' · staged' : ''}</small>
      </label>)}</div>
      <p className="review-muted">Selected files will be staged in full and committed locally. Nothing is pushed.</p>
      <Textarea aria-label="Commit message" placeholder="Commit message" rows={3} maxLength={4_000} disabled={pending} value={message} onChange={(event) => setMessage(event.target.value)} />
      {unselectedStaged.length ? <p className="review-commit-notice" role="status">Include the {unselectedStaged.length} already-staged file(s), or adjust the index before committing.</p> : null}
    </>}
    {failure ? <p role="alert" className="review-commit-notice review-error">{failure}</p> : null}
    <footer><Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
      <Button disabled={pending || !message.trim() || !selected.size || unselectedStaged.length > 0 || !!status?.unavailableReason} onClick={() => {
        setPending(true); setFailure(null); port.postMessage({ type: 'reviewPanel.commit', paths: [...selected], message });
      }}>{pending ? 'Committing…' : 'Commit selected files'}</Button>
    </footer>
  </section>;
}
