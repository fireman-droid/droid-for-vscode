import { useI18n } from '@droidvisx/chat-ui/i18n';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';
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
  const { t } = useI18n();
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
  return <section className="review-commit" role="group" aria-label={t("Commit changes")} aria-busy={pending || !report?.complete}>
    {status?.branch ? <div data-ui-notice="" className="review-commit-branch"><span>{status.branch}</span></div> : null}
    {!report?.complete ? <p data-ui-notice="" className="review-commit-notice" role="status">{t("Reading Git status…")}</p> : status?.unavailableReason ? <p data-ui-notice="" className="review-commit-notice review-error" role="alert">{t("Git unavailable:")} {status.unavailableReason}</p> : <>
      <Select value={mode} disabled={pending} onValueChange={value => {
        if (value === 'files' || value === 'staged') { setMode(value); setSelected(new Set()); setPage(0); }
      }}><SelectTrigger aria-label={t("Commit source")}><SelectValue /></SelectTrigger><SelectContent align="start">
        <SelectItem value="files">{t("Working files · stage selected files in full")}</SelectItem>
        <SelectItem value="staged">{t("Index · preserve staged changes")}</SelectItem>
      </SelectContent></Select>
      <div className="flex items-center justify-between gap-2"><span data-ui-notice="">{selected.size} {t("selected ·")} {files.length} {t("files")}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={pending || !ready} onClick={() => setSelected(new Set(files.map(file => file.path)))}>{t("Select all")} {files.length} {t("files")}</Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setSelected(new Set())}>{t("Clear")}</Button>
        </div>
      </div>
      {files.length > 0 ? <ScrollArea className="review-commit-files" viewportClassName="review-commit-files-viewport"><div className="review-commit-files-list">{files.slice(visiblePage * 100, (visiblePage + 1) * 100).map((file) => <label key={file.path} data-selected={selected.has(file.path)} data-disabled={pending}>
        <Checkbox checked={selected.has(file.path)} disabled={pending || !ready} onCheckedChange={() => setSelected((old) => {
          const next = new Set(old); if (next.has(file.path)) next.delete(file.path); else next.add(file.path); return next;
        })} /><span>{file.path}</span><small>{file.status}{file.staged ? t("· staged") : ''}</small>
      </label>)}</div></ScrollArea> : null}
      {pages > 1 ? <div className="flex items-center justify-between"><Button variant="ghost" size="sm" disabled={!visiblePage || pending} onClick={() => setPage(visiblePage - 1)}>{t("Previous")}</Button>
        <span data-ui-notice="">{t("Page")} {visiblePage + 1} {t("of")} {pages}</span><Button variant="ghost" size="sm" disabled={visiblePage + 1 >= pages || pending} onClick={() => setPage(visiblePage + 1)}>{t("Next")}</Button></div> : null}
      <p data-ui-notice="" className="review-muted">{mode === 'staged' ? t("Commit the current index. Unstaged edits stay in the working tree.") : t("Selected files will be staged in full, including unstaged edits.")} {t("Nothing is pushed.")}</p>
      <Textarea aria-label={t("Commit message")} placeholder={t("Commit message")} rows={3} maxLength={4_000} disabled={pending} value={message} onChange={(event) => setMessage(event.target.value)} />
      {unselectedStaged ? <p data-ui-notice="" className="review-commit-notice" role="status">{t("Include the")} {unselectedStaged} {t("already-staged file(s), or adjust the index before committing.")}</p> : null}
    </>}
    {failure ? <p data-ui-notice="" role="alert" className="review-commit-notice review-error">{failure}</p> : null}
    <footer><Button variant="ghost" disabled={pending} onClick={onClose}>{t("Cancel")}</Button>
      <Button disabled={!canCommit} onClick={() => {
        setPending(true); setFailure(null); port.postMessage({ type: 'reviewPanel.commit', paths: [...selected], message, snapshotId: status!.snapshotId, mode });
      }}>{pending ? t("Committing…") : mode === 'staged' ? t("Commit staged changes") : t("Commit selected files")}</Button>
    </footer>
  </section>;
}
