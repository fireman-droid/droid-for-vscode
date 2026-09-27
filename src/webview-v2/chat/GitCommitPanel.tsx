import { MAX_GIT_COMMIT_MESSAGE_LENGTH } from '../../shared/protocol/gitCommitFlow';
import { GIT_FILE_STATUS_LABELS, useGitCommitDraft, useGitCommitEntry, type GitCommitFlowContextValue } from '../review/gitCommitFlow';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Checkbox } from '../ui/selection';

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
  return <div role="group" aria-label="Commit changes" className="space-y-3 p-2 text-xs">
    <header className="flex items-center gap-2"><span className="font-medium">Commit</span>{state.branch === null ? null : <span className="text-[11px] text-muted-foreground">on {state.branch}</span>}</header>
    {!draft.initialized ? <p role="status">Reading git status…</p> : state.files.length === 0 ? <p>No uncommitted changes.</p> : <>
      <div role="group" aria-label="Files to commit" className="max-h-60 space-y-2 overflow-auto">
        {state.files.map((file) => <label key={file.path} className="v2-chat-choice flex items-start gap-2 rounded">
          <Checkbox className="mt-0.5" checked={draft.selected.has(file.path)} disabled={state.commitPending} onCheckedChange={() => draft.toggle(file.path)} />
          <span className="min-w-0 flex-1 break-words">{file.path}</span>
          <span className="shrink-0 text-muted-foreground">{GIT_FILE_STATUS_LABELS[file.status]}{file.staged ? ' · staged' : ''}</span>
        </label>)}
      </div>
      <Textarea aria-label="Commit message" rows={3} maxLength={MAX_GIT_COMMIT_MESSAGE_LENGTH} placeholder="Commit message" value={draft.message} disabled={state.commitPending} onChange={(event) => draft.setMessage(event.target.value)} />
      {draft.failure === null ? null : <p role="alert" className="break-words text-destructive">{draft.failure}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!draft.canCommit} onClick={() => flow.onCommit(turnId, [...draft.selected], draft.message)}>{state.commitPending ? 'Committing…' : 'Commit'}</Button>
      </div>
    </>}
  </div>;
}
