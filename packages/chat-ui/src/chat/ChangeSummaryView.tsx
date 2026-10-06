import { ChevronDown, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { FileChangeView } from './FileChangeView';
import type { ChangeFile } from './changePresentation';

export type { ChangeFile } from './changePresentation';

export interface ChangeSummaryViewProps {
  readonly files: readonly ChangeFile[];
  readonly onReview?: () => void;
  readonly onUndo?: () => void;
  readonly undoDisabled?: boolean;
  readonly undoReason?: string;
  readonly onSelectFile?: (path: string) => void;
  readonly renderFileDetails?: (path: string) => ReactNode;
  readonly note?: ReactNode;
  readonly onInteract?: () => void;
}

const INITIAL_FILE_COUNT = 3;

export function ChangeSummaryView({
  files, onReview, onUndo, undoDisabled, undoReason, onSelectFile, renderFileDetails, note, onInteract,
}: ChangeSummaryViewProps) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const countLabel = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  const remaining = files.length - INITIAL_FILE_COUNT;
  const renderFile = (file: ChangeFile) => <FileChangeView key={file.path} file={file} label="" compact onInteract={onInteract}
    onSelect={onSelectFile ? () => onSelectFile(file.path) : undefined}>
    {renderFileDetails?.(file.path)}
  </FileChangeView>;
  return (
    <section className="dvx-change-summary" aria-label={`Changes in ${countLabel}`}>
      <header className="dvx-change-summary-header">
        <span className="dvx-change-summary-title">{files.length} {files.length === 1 ? 'File' : 'Files'} Changed</span>
        {(onUndo || onReview) && <div className="dvx-change-summary-actions">
          {onUndo && <span title={undoReason ?? `Undo changes in ${countLabel}`}>
            <Button variant="plain" size="none" className="dvx-change-action dvx-change-undo" disabled={undoDisabled}
              aria-label={`Undo changes in ${countLabel}`} aria-description={undoReason}
              onClick={() => { onInteract?.(); onUndo(); }}><Undo2 aria-hidden="true" /></Button>
          </span>}
          {onReview && <Button variant="plain" size="none" className="dvx-change-action dvx-change-review"
            aria-label={`Review changes in ${countLabel}`} onClick={() => { onInteract?.(); onReview(); }}>Review</Button>}
        </div>}
      </header>
      <Collapsible className="dvx-change-file-list" open={expanded} onOpenChange={(nextExpanded) => {
        onInteract?.(); setExpanded(nextExpanded);
      }}>
        {files.slice(0, INITIAL_FILE_COUNT).map(renderFile)}
        {remaining > 0 && <>
          <CollapsibleContent>{files.slice(INITIAL_FILE_COUNT).map(renderFile)}</CollapsibleContent>
          <CollapsibleTrigger asChild>
            <Button variant="plain" size="none" className="dvx-change-more">
              {expanded ? 'Show less' : `Show ${remaining} more ${remaining === 1 ? 'file' : 'files'}`}
              <ChevronDown className="dvx-change-chevron" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </>}
      </Collapsible>
      {note && <div className="dvx-change-note">{note}</div>}
    </section>
  );
}
