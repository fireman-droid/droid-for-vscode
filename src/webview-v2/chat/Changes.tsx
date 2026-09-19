import type { ChangesTranscriptItem } from '../../shared/protocol/transcript';
import { useToolActions } from '../content/toolActions';
import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import { Button } from '../ui/button';
import { InlineFileDiff } from '../content/InlineFileDiff';

export function Changes({ item }: { readonly item: ChangesTranscriptItem; readonly messageId: string }) {
  const actions = useToolActions();
  if (item.files.length === 0) return null;
  const complete = item.files.every((file) => file.additions !== null && file.deletions !== null);
  const additions = item.files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = item.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const hasCounts = complete && (additions > 0 || deletions > 0);
  const countStatus = complete ? 'No net line changes' : item.writing ? 'Calculating line changes…'
    : item.files.some((file) => file.additions !== null || file.deletions !== null) ? 'Line counts incomplete' : 'Line counts unavailable';
  return <div className="min-w-0 space-y-1">
    <Button variant="plain" size="none" title={`Review workspace changes during this turn (${item.files.length} files)`} onClick={() => actions.openReviewTurn?.(item.turnId)}
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 py-1 text-left text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
      <span>Workspace changes</span><span>·</span><span>{item.files.length} {item.files.length === 1 ? 'file' : 'files'}{item.files.length === MAX_CHANGED_FILES_PER_TURN ? ' shown' : ''}</span>
      <span>·</span>
      {hasCounts ? <>
        <span className="text-[var(--vscode-gitDecoration-addedResourceForeground,#3f9d5f)]">+{additions}</span>
        <span className="text-destructive">−{deletions}</span>
      </> : <span>{countStatus}</span>}
    </Button>
    <p className="text-[11px] text-muted-foreground">Net workspace changes during this turn. May include manual edits or other processes; authorship is not confirmed.</p>
    {item.files.map((file) => <div key={file.path} className="min-w-0 space-y-1">
      <p className="break-all font-mono text-xs text-muted-foreground">{file.path}</p>
      <InlineFileDiff path={file.path} turnId={item.turnId} expanded />
    </div>)}
  </div>;
}
