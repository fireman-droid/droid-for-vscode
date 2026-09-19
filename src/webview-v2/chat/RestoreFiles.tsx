import type { RewindFileInfo } from '../../webview/assistant/editing/editTypes';
import { useId, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { Checkbox } from '../ui/selection';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';
import { rewindDetailSummary } from '../../shared/protocol/rewindDetails';
import { useContent } from '../content/context';

export function RestoreFiles({ impact, checked, onChange, openDisabled = false }: {
  readonly impact: RewindFileInfo;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly openDisabled?: boolean;
}) {
  const { actions } = useContent();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const count = impact.restorableCount + impact.createdCount;
  const { details, unavailableCount, omittedAffected, omittedUnavailable } = rewindDetailSummary(impact);
  if (count === 0 && unavailableCount === 0) return null;
  return <Collapsible open={expanded} onOpenChange={setExpanded} asChild><section data-transcript-selection-exclude="" className="mt-2 select-none overflow-hidden rounded-[10px] border border-border bg-input-background text-[11.5px]" aria-label="File restoration">
    <div className="flex min-h-8 items-center justify-between gap-2 px-3 py-1.5">
      {count > 0 ? <label className="flex min-w-0 items-center gap-2">
        <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
        <span>Restore {count} {count === 1 ? 'file' : 'files'} changed after this point</span>
      </label> : <span>{unavailableCount} {unavailableCount === 1 ? 'file' : 'files'} cannot be restored</span>}
      <CollapsibleTrigger asChild><Button variant="plain" size="none" aria-label="Restorable files" aria-controls={id} className="shrink-0 rounded">
        <ChevronDown className={`size-[13px] text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </Button></CollapsibleTrigger>
    </div>
    <AnimatedCollapsibleContent id={id} open={expanded}>
      <ul className="max-h-36 space-y-1 overflow-auto border-t border-border px-3 py-2 text-[11px]">
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
      {actions?.openPath && details.some((file) => file.location === 'workspace') ? <p role="note" className="px-3 pb-2 text-[10.5px] text-muted-foreground">Click a filename to inspect its current contents in the editor. This is not a restore Diff; opening a file does not restore or delete it.</p> : null}
      {count > 0 && unavailableCount > 0 ? <p role="status" className="px-3 pb-2 text-[10.5px] text-muted-foreground">{unavailableCount} {unavailableCount === 1 ? 'file cannot' : 'files cannot'} be restored and will stay unchanged.</p> : null}
      {details.some((file) => file.location !== 'workspace' && file.action !== 'unavailable') ? <p role="note" className="px-3 pb-2 text-[10.5px] text-muted-foreground">Restoring also affects the listed files outside this workspace.</p> : null}
    </AnimatedCollapsibleContent>
  </section></Collapsible>;
}
