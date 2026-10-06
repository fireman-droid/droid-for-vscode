import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import { ChangeLineStats } from './FileChangeView';
import type { ChangeFile } from './changePresentation';
import { ChangeFileIcon } from './ChangeFileIcon';

export function ComposerChangesView({ files, disabled, onReview, onStop, stopLabel = 'Stop' }: {
  readonly files: readonly ChangeFile[];
  readonly disabled?: boolean;
  readonly onReview: (path?: string) => void;
  readonly onStop?: () => void;
  readonly stopLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!files.length) return null;
  return <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
    <section className="v2-composer-changes" aria-label="Files changed in this turn">
      <div className="v2-composer-changes-header">
        <CollapsibleTrigger asChild>
          <Button variant="plain" size="none" className="v2-composer-changes-toggle" aria-controls={id} title="Confirmed edits in this turn">
            <ChevronRight aria-hidden className={expanded ? 'rotate-90' : undefined} />
            <span>{files.length} {files.length === 1 ? 'File' : 'Files'} Changed</span>
          </Button>
        </CollapsibleTrigger>
        {onStop ? <Button variant="plain" size="none" className="v2-composer-changes-stop" disabled={disabled} onClick={onStop}>{stopLabel}</Button> : null}
        <Button variant="plain" size="none" className="dvx-change-action v2-composer-changes-review" disabled={disabled} onClick={() => onReview()}>Review</Button>
      </div>
      <AnimatedCollapsibleContent id={id} open={expanded}>
        <ul className="v2-composer-changes-list">
          {files.map((file) => {
            const parts = file.path.split(/[\\/]/u);
            const name = parts.pop();
            const folder = parts.join('/');
            return <li key={file.path}>
              <Button variant="plain" size="none" className="v2-composer-changes-file" disabled={disabled}
                title={file.path} aria-label={`Review changes to ${file.path}`} onClick={() => onReview(file.path)}>
                <ChangeFileIcon path={file.path} />
                <span className="v2-composer-changes-name">{name}{folder ? <span className="v2-composer-changes-folder">{folder}</span> : null}</span>
                <ChangeLineStats additions={file.additions || null} deletions={file.deletions || null} />
              </Button>
            </li>;
          })}
        </ul>
      </AnimatedCollapsibleContent>
    </section>
  </Collapsible>;
}
