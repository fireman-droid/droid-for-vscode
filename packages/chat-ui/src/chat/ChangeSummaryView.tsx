import { ChevronDown, Files, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ChangeLineStats, FileChangeView } from './FileChangeView';
import type { ChangeFile } from './changePresentation';

export type { ChangeFile } from './changePresentation';

export interface ChangeSummaryViewProps {
  readonly files: readonly ChangeFile[];
  readonly onReview?: () => void;
  readonly onReviewEdits?: () => void;
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
  files, onReview, onReviewEdits, onUndo, undoDisabled, undoReason, onSelectFile, renderFileDetails, note, onInteract,
}: ChangeSummaryViewProps) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const countLabel = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  const hasCompleteStats = files.every((file) => file.additions !== null && file.deletions !== null);
  const additions = hasCompleteStats ? files.reduce((total, file) => total + file.additions!, 0) : null;
  const deletions = hasCompleteStats ? files.reduce((total, file) => total + file.deletions!, 0) : null;
  const remaining = files.length - INITIAL_FILE_COUNT;
  const renderFile = (file: ChangeFile) => {
    if (renderFileDetails) {
      return <FileChangeView key={file.path} file={file} label="" onInteract={onInteract}
        actions={onSelectFile ? <Button variant="plain" size="none" className="dvx-change-action" aria-label={`Review changes to ${file.path}`}
          onClick={() => { onInteract?.(); onSelectFile(file.path); }}>Review</Button> : undefined}>
        {renderFileDetails(file.path)}
      </FileChangeView>;
    }
    const content = <>
      <span className="dvx-change-path" title={file.path}>{file.path}</span>
      <ChangeLineStats additions={file.additions} deletions={file.deletions} />
    </>;
    return onSelectFile ? (
      <Button key={file.path} variant="plain" size="none" className="dvx-change-row"
        aria-label={`Review changes to ${file.path}`} onClick={() => { onInteract?.(); onSelectFile(file.path); }}>
        {content}
      </Button>
    ) : <div key={file.path} className="dvx-change-row dvx-change-row-static">{content}</div>;
  };
  return (
    <section className="dvx-change-summary" aria-label={`Changes in ${countLabel}`}>
      <header className="dvx-change-summary-header">
        <Files className="dvx-change-summary-icon" aria-hidden="true" />
        <div className="dvx-change-summary-heading">
          <span className="dvx-change-summary-title">Edited {countLabel}</span>
          <ChangeLineStats additions={additions} deletions={deletions} />
        </div>
        {(onUndo || onReview || onReviewEdits) && <div className="dvx-change-summary-actions">
          {onReviewEdits && <Button variant="plain" size="none" className="dvx-change-action" aria-label={`View recorded edits in ${countLabel}`}
            onClick={() => { onInteract?.(); onReviewEdits(); }}>Edits</Button>}
          {onUndo && <span title={undoReason}>
            <Button variant="plain" size="none" className="dvx-change-action" disabled={undoDisabled}
              aria-label={`Undo changes in ${countLabel}`} aria-description={undoReason}
              onClick={() => { onInteract?.(); onUndo(); }}>Undo…<Undo2 aria-hidden="true" /></Button>
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
