import type { RewindFileInfo } from './editing/editTypes';
import { useId } from 'react';
import { Check, ChevronDown, ExternalLink, RotateCcw, X } from 'lucide-react';
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
  const groups = [
    { action: 'restore', label: 'Restore previous versions', count: impact.restorableCount },
    { action: 'delete', label: 'Delete new files', count: impact.createdCount },
    { action: 'unavailable', label: 'Unavailable · unchanged', count: unavailableCount },
  ] as const;
  const label = restored ? 'Restore requested' : count > 0 ? 'Restore files' : 'Restore unavailable';
  if (count === 0 && unavailableCount === 0) return null;
  return <Popover><div data-transcript-selection-exclude="" className="min-w-0 select-none text-[11.5px]" role="group" aria-label="File restoration">
    <PopoverTrigger asChild><Button variant="plain" size="none"
      aria-label={`${label} (${count || unavailableCount})${count > 0 && !restored ? `, ${checked ? 'on' : 'off'}` : ''}`}
      className="inline-flex h-6 max-w-full items-center gap-1 bg-transparent text-[11.5px] text-muted-foreground hover:text-foreground">
      {checked && count > 0 ? <Check className="size-3 shrink-0" aria-hidden="true" /> : <RotateCcw className="size-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">{label} ({count || unavailableCount})</span><ChevronDown className="size-3 shrink-0" aria-hidden="true" />
    </Button></PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-80 p-2.5 text-[11.5px]" data-editor-popup-owner={impact.messageId} data-transcript-selection-exclude="" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2">
        {count > 0 ? <label className="flex min-w-0 items-center gap-1.5 has-[:enabled]:cursor-pointer">
          <Checkbox checked={checked} disabled={disabled || restored} onCheckedChange={(value) => onChange(value === true)} />
          <span id={id} className="font-medium">{label} ({count})</span>
        </label> : <span id={id} className="font-medium">{label}</span>}
        <PopoverClose asChild><Button variant="plain" size="icon-sm" className="inline-flex items-center justify-center bg-transparent text-muted-foreground hover:text-foreground" aria-label="Close file restoration details"><X className="size-3.5" aria-hidden="true" /></Button></PopoverClose>
      </div>
      {count > 0 ? <p className="mt-1 text-muted-foreground">{restored ? 'Already requested; reconnecting will not restore again.' : 'On resend, undo file changes from this message onward, including later manual edits.'}</p> : null}
      <div className="mt-2 space-y-2 border-t border-[var(--panel-edge)] pt-2">
        {groups.filter((group) => group.count > 0).map((group) => <section key={group.action} aria-label={group.label}>
          <p className="mb-1 text-[10.5px] text-muted-foreground">{group.label} ({group.count})</p>
          <ul className="space-y-1">
            {details.filter((file) => file.action === group.action).map((file, index) => <li key={`${file.label}:${index}`} className="min-w-0">
              {file.location === 'workspace' && actions?.openPath ? <Button textSelectable variant="link" size="none"
                disabled={openDisabled} aria-label={`Open current file ${file.label}`} title={`Open current file: ${file.label}`}
                className="max-w-full min-w-0 justify-start gap-1 bg-transparent text-left text-[11px] leading-4"
                onClick={() => actions.openPath?.({ path: file.label })}>
                <span className="min-w-0 truncate">{file.label}</span><ExternalLink className="size-3! shrink-0" aria-hidden="true" />
              </Button> : <span className="block truncate" title={file.label}>{file.label}</span>}
              {file.location !== 'workspace' ? <span className="block text-[10.5px] text-muted-foreground">{file.location === 'outside-workspace' ? 'Outside workspace' : 'Workspace location unavailable'}</span> : null}
              {file.reason ? <span className="block break-words text-[10.5px] text-muted-foreground">{file.reason}</span> : null}
            </li>)}
          </ul>
        </section>)}
        {omittedAffected > 0 ? <p className="text-muted-foreground">Applies to all {count} files; {omittedAffected} more not listed.</p> : null}
        {omittedUnavailable > 0 ? <p className="text-muted-foreground">{omittedUnavailable} more unavailable {omittedUnavailable === 1 ? 'file' : 'files'} not listed.</p> : null}
      </div>
    </PopoverContent>
  </div></Popover>;
}
