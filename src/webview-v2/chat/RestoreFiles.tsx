import type { RewindFileInfo } from './editing/editTypes';
import { useId } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Checkbox } from '../ui/selection';
import { Button } from '../ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { rewindDetailSummary } from '../../shared/protocol/rewindDetails';
import { useContent } from '../content/context';

export function RestoreFiles({ impact, checked, onChange, disabled = false, restored = false, openDisabled = false }: {
  readonly impact: RewindFileInfo;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly restored?: boolean;
  readonly openDisabled?: boolean;
}) {
  const { actions } = useContent();
  const id = useId();
  const count = impact.restorableCount + impact.createdCount;
  const { details, unavailableCount, omittedAffected, omittedUnavailable } = rewindDetailSummary(impact);
  if (count === 0 && unavailableCount === 0) return null;
  return <Popover><div data-transcript-selection-exclude="" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 select-none text-[11.5px]" role="group" aria-label="File restoration">
      {count > 0 ? <label className="v2-chat-choice flex min-w-0 items-center gap-1.5 rounded">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
        <span>{restored ? 'File restore already requested' : <>Also restore files <span className="text-muted-foreground">({count})</span></>}</span>
      </label> : <span>{unavailableCount} {unavailableCount === 1 ? 'file' : 'files'} cannot be restored</span>}
      <PopoverTrigger asChild><Button variant="link" size="none" className="min-h-6 shrink-0 text-[11.5px]">View details</Button></PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-[420px] p-3 text-[11.5px]" data-editor-popup-owner={impact.messageId} data-transcript-selection-exclude="" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2">
        <span id={id} className="font-medium">Restore to before this message</span>
        <PopoverClose asChild><Button variant="ghost" size="icon-sm" aria-label="Close file restoration details"><X aria-hidden="true" /></Button></PopoverClose>
      </div>
      <p className="py-2 text-muted-foreground">Applies from this message onward, including later turns. Restores previous contents and deletes newly created files; later manual edits to those files can be replaced. Leave unchecked to rewind the conversation only.</p>
      {restored ? <p role="status" className="pb-2 text-muted-foreground">File restore will not be repeated when reconnecting.</p> : null}
      <ul className="space-y-2 border-t border-[var(--panel-edge)] py-2">
        {details.map((file, index) => <li key={`${file.action}:${file.label}:${index}`} className="flex min-w-0 items-start justify-between gap-2">
          <span className="min-w-0">
            {file.location === 'workspace' && actions?.openPath ? <Button textSelectable variant="link" size="none"
              disabled={openDisabled} aria-label={`Open current file ${file.label}`} title={`Open current file: ${file.label}`}
              className="max-w-full min-w-0 justify-start gap-1.5 text-left text-[11px] leading-4"
              onClick={() => actions.openPath?.({ path: file.label })}>
              <span className="min-w-0 truncate">{file.label}</span><ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </Button> : <span className="block truncate" title={file.label}>{file.label}</span>}
            {file.location !== 'workspace' ? <span className="block text-[10.5px] text-muted-foreground">{file.location === 'outside-workspace' ? 'Outside workspace' : 'Workspace location unavailable'}</span> : null}
            {file.reason ? <span className="block break-words text-[10.5px] text-muted-foreground">{file.reason}</span> : null}
          </span>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">{file.action === 'delete' ? 'Delete newly created file' : file.action === 'unavailable' ? 'Cannot restore' : 'Restore previous contents'}</span>
        </li>)}
        {omittedAffected > 0 ? <li className="text-muted-foreground">{omittedAffected} additional affected {omittedAffected === 1 ? 'file is' : 'files are'} not listed. Restore applies to all {count} affected {count === 1 ? 'file' : 'files'}.</li> : null}
        {omittedUnavailable > 0 ? <li className="text-muted-foreground">{omittedUnavailable} additional {omittedUnavailable === 1 ? 'file cannot' : 'files cannot'} be restored.</li> : null}
      </ul>
      {actions?.openPath && details.some((file) => file.location === 'workspace') ? <p role="note" className="pb-2 text-muted-foreground">Click a filename to inspect its current contents in the editor. This is not a restore Diff; opening a file does not restore or delete it.</p> : null}
      {count > 0 && unavailableCount > 0 ? <p role="status" className="pb-2 text-muted-foreground">{unavailableCount} {unavailableCount === 1 ? 'file cannot' : 'files cannot'} be restored and will stay unchanged.</p> : null}
      {details.some((file) => file.location !== 'workspace' && file.action !== 'unavailable') ? <p role="note" className="text-muted-foreground">Restoring also affects the listed files outside this workspace.</p> : null}
    </PopoverContent>
  </div></Popover>;
}
