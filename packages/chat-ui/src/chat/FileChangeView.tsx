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
  readonly onOpenPath?: () => void;
  readonly openPathLabel?: string;
  readonly pillTitle?: string;
  readonly pillBadge?: string;
  readonly label?: string;
  readonly compact?: boolean;
  readonly alwaysExpanded?: boolean;
  readonly metadata?: ReactNode;
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

export function FileChangeView({ file, children, onInteract, onSelect, onOpenPath, openPathLabel, pillTitle, pillBadge, label, compact = false, alwaysExpanded = false, metadata }: FileChangeViewProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasDetails = !onSelect && children !== null && children !== undefined && children !== false;
  const shortName = file.path.split(/[\\/]/u).pop() || file.path;
  const hasStats = file.additions !== null || file.deletions !== null;
  const pillBody = <>
    <span className="dvx-change-pill-name">{shortName}</span>
    {(hasStats || pillBadge) ? <span className="dvx-change-pill-sep" aria-hidden="true" /> : null}
    <ChangeLineStats additions={file.additions} deletions={file.deletions} />
    {pillBadge ? <span className="text-[11px] text-muted-foreground">{pillBadge}</span> : null}
  </>;
  const contents = <>
    {!alwaysExpanded && (onSelect || compact) && <ChangeFileIcon path={file.path} />}
    {!alwaysExpanded && hasDetails && <ChevronRight className="dvx-change-chevron" aria-hidden="true" />}
    <span className="dvx-change-label">{label ?? file.kind ?? t("Edited")}</span>
    {alwaysExpanded ? (
      onOpenPath ? (
        <Button variant="plain" size="none" className="dvx-change-pill" title={pillTitle ?? file.path}
          aria-label={openPathLabel ?? t("Open current file")}
          onClick={() => { onInteract?.(); onOpenPath(); }}>
          {pillBody}
        </Button>
      ) : (
        <span className="dvx-change-pill" title={pillTitle ?? file.path}>
          {pillBody}
        </span>
      )
    ) : <>
      <span className="dvx-change-path" title={file.path}>{compact ? shortName : file.path}</span>
      <ChangeLineStats additions={compact ? file.additions || null : file.additions} deletions={compact ? file.deletions || null : file.deletions} />
    </>}
    {metadata ? <span className="shrink-0 text-[11px] text-muted-foreground">{metadata}</span> : null}
  </>;
  if (alwaysExpanded) return <div className="dvx-change-file operation-diff">
    <div className="dvx-change-file-header">
      <div className="dvx-change-row dvx-change-row-static">
        <ChangeFileIcon path={file.path} />
        {contents}
      </div>
      {onSelect ? <Button variant="plain" size="none" className="dvx-change-action mr-1"
        aria-label={t("Review changes to {p0}", { p0: file.path })}
        onClick={() => { onInteract?.(); onSelect(); }}>{t("Review")}</Button> : null}
    </div>
    {children ? <div className="dvx-operation-body">{children}</div> : null}
  </div>;
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
