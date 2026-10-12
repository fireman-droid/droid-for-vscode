import { useI18n } from '../i18n';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import type { ChangeFile } from './changePresentation';
import { ChangeFileIcon } from './ChangeFileIcon';

export type { ChangeFile } from './changePresentation';

export interface FileChangeViewProps {
  readonly file: ChangeFile;
  readonly children?: ReactNode;
  readonly onInteract?: () => void;
  readonly onSelect?: () => void;
  readonly label?: string;
  readonly compact?: boolean;
}

export function ChangeLineStats({ additions, deletions }: Pick<ChangeFile, 'additions' | 'deletions'>) {
  const { t } = useI18n();
  if (additions === null && deletions === null) return null;
  const description = [
    additions === null ? null : `${additions} added`,
    deletions === null ? null : `${deletions} removed`,
  ].filter(Boolean).join(', ');
  return (
    <span className="dvx-change-stats" title={t("Recorded operation lines")} aria-label={t("Recorded operation lines: {p0}", { p0: description })}>
      {additions !== null && <span className="dvx-change-added" aria-hidden="true">+{additions}</span>}
      {deletions !== null && <span className="dvx-change-removed" aria-hidden="true">−{deletions}</span>}
    </span>
  );
}

export function FileChangeView({ file, children, onInteract, onSelect, label, compact = false }: FileChangeViewProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasDetails = !onSelect && children !== null && children !== undefined && children !== false;
  const contents = <>
    {(onSelect || compact) && <ChangeFileIcon path={file.path} />}
    {hasDetails && <ChevronRight className="dvx-change-chevron" aria-hidden="true" />}
    <span className="dvx-change-label">{label ?? file.kind ?? t("Edited")}</span>
    <span className="dvx-change-path" title={file.path}>{compact ? file.path.split(/[\\/]/u).pop() : file.path}</span>
    <ChangeLineStats additions={compact ? file.additions || null : file.additions} deletions={compact ? file.deletions || null : file.deletions} />
  </>;
  return (
    <Collapsible className="dvx-change-file" open={open} onOpenChange={(nextOpen) => {
      onInteract?.();
      setOpen(nextOpen);
    }}>
      <div className="dvx-change-file-header">
        {onSelect ? (
          <Button variant="plain" size="none" className="dvx-change-row" title={file.path} aria-label={t("Review changes to {p0}", { p0: file.path })}
            onClick={() => { onInteract?.(); onSelect(); }}>
            {contents}
          </Button>
        ) : hasDetails ? (
          <CollapsibleTrigger asChild>
            <Button variant="plain" size="none" className="dvx-change-row" aria-label={t("{p0} changes to {p1}", { p0: open ? t("Hide") : t("Show"), p1: file.path })}>
              {contents}
            </Button>
          </CollapsibleTrigger>
        ) : <div className="dvx-change-row dvx-change-row-static">{contents}</div>}
      </div>
      {hasDetails && <CollapsibleContent className="dvx-change-details">{children}</CollapsibleContent>}
    </Collapsible>
  );
}
