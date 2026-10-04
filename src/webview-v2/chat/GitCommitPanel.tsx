import { MAX_GIT_COMMIT_MESSAGE_LENGTH } from '../../shared/protocol/gitCommitFlow';
import { GIT_FILE_STATUS_LABELS, useGitCommitDraft, useGitCommitEntry, type GitCommitFlowContextValue } from '../review/gitCommitFlow';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Checkbox } from '../ui/selection';
import { useState } from 'react';

export function ChangesCommitEntry({ turnId }: { readonly turnId: string | null }) {
  const entry = useGitCommitEntry(turnId);
  if (entry.kind === 'hidden') return null;
  if (entry.kind === 'notice') return <p role="status" className="text-xs text-muted-foreground">{entry.text}</p>;
  if (entry.kind === 'button') return <Button variant="ghost" size="sm" onClick={entry.open}>Commit…</Button>;
  return <GitCommitPanel flow={entry.flow} turnId={entry.turnId} onClose={entry.close} />;
}

function GitCommitPanel({ flow, turnId, onClose }: { readonly flow: GitCommitFlowContextValue; readonly turnId: string; readonly onClose: () => void }) {
  const { state } = flow;
  const draft = useGitCommitDraft(flow, turnId);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(state.files.length / 100));
  const visiblePage = Math.min(page, pages - 1);
  return <div role="group" aria-label="Commit changes" className="space-y-3 p-2 text-xs">
    <header className="flex items-center gap-2"><span className="font-medium">Commit</span>{state.branch === null ? null : <span className="text-[11px] text-muted-foreground">on {state.branch}</span>}</header>
    {!draft.initialized ? <p role="status">Reading git status…</p> : state.files.length === 0 ? <p>No uncommitted changes.</p> : <>
      <div className="flex items-center justify-between gap-2"><span>{draft.selected.size} selected · {state.files.length} files</span>
        <Button variant="ghost" size="sm" disabled={state.commitPending || state.statusPending} onClick={draft.selectAll}>Select all {state.files.length} files</Button>
        <Button variant="ghost" size="sm" disabled={state.commitPending} onClick={draft.clear}>Clear</Button></div>
      <div role="group" aria-label="Files to commit" className="max-h-60 space-y-2 overflow-auto">
        {state.files.slice(visiblePage * 100, (visiblePage + 1) * 100).map((file) => <label key={file.path} className="v2-chat-choice flex items-start gap-2 rounded">
          <Checkbox className="mt-0.5" checked={draft.selected.has(file.path)} disabled={state.commitPending} onCheckedChange={() => draft.toggle(file.path)} />
          <span className="min-w-0 flex-1 break-words">{file.path}</span>
          <span className="shrink-0 text-muted-foreground">{GIT_FILE_STATUS_LABELS[file.status]}{file.staged ? ' · staged' : ''}</span>
        </label>)}
      </div>
      {pages > 1 ? <div className="flex items-center justify-between"><Button variant="ghost" size="sm" disabled={!visiblePage || state.commitPending} onClick={() => setPage(visiblePage - 1)}>Previous</Button>
        <span>Page {visiblePage + 1} of {pages}</span><Button variant="ghost" size="sm" disabled={visiblePage + 1 >= pages || state.commitPending} onClick={() => setPage(visiblePage + 1)}>Next</Button></div> : null}
      <p className="text-muted-foreground">Selected files will be staged in full. To preserve partial staging, use Index mode in Review → Commit.</p>
      {draft.unselectedStaged ? <p role="status">Include the {draft.unselectedStaged} already-staged file(s), or adjust the index before committing.</p> : null}
      <Textarea aria-label="Commit message" rows={3} maxLength={MAX_GIT_COMMIT_MESSAGE_LENGTH} placeholder="Commit message" value={draft.message} disabled={state.commitPending} onChange={(event) => draft.setMessage(event.target.value)} />
      {draft.failure === null ? null : <p role="alert" className="break-words text-destructive">{draft.failure}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!draft.canCommit} onClick={() => flow.onCommit(turnId, [...draft.selected], draft.message, state.snapshotId ?? undefined, 'files')}>{state.commitPending ? 'Committing…' : 'Commit'}</Button>
      </div>
    </>}
  </div>;
}
