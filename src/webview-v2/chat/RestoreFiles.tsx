import { useI18n } from '@droidvisx/chat-ui/i18n';
import type { RewindFileInfo } from './editing/editTypes';
import { useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { rewindDetailSummary } from '../../shared/protocol/rewindDetails';
import { useContent } from '../content/context';

const actionLabels = { restore: 'Restore', delete: 'Delete', unavailable: 'Unavailable' } as const;
const itemClass = 'h-6 min-w-0 px-1.5 py-0 text-[11.5px] leading-none';

export function RestoreFiles({ impact, onResend, disabled = false, resumeOnly = false, restored = false, openDisabled = false }: {
  readonly impact: RewindFileInfo;
  readonly onResend: (restoreFiles: boolean) => void;
  readonly disabled?: boolean;
  readonly resumeOnly?: boolean;
  readonly restored?: boolean;
  readonly openDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { actions } = useContent();
  const [showFiles, setShowFiles] = useState(false);
  const count = impact.restorableCount + impact.createdCount;
  const { details, unavailableCount, omittedAffected, omittedUnavailable } = rewindDetailSummary(impact);
  const total = count + unavailableCount;
  const mixed = [impact.restorableCount, impact.createdCount, unavailableCount].filter((value) => value > 0).length > 1;
  const summary = mixed ? `${total} files` : impact.createdCount > 0 ? `Delete ${total} new ${total === 1 ? 'file' : 'files'}`
    : impact.restorableCount > 0 ? `Restore ${total} ${total === 1 ? 'file' : 'files'}` : `${total} unavailable ${total === 1 ? 'file' : 'files'}`;
  const restoreHint = restored ? 'Already requested; reconnecting will not restore again.'
    : resumeOnly ? 'The conversation has already been rewound; reconnect to resend.'
      : 'Undo file changes from this message onward, including later manual edits, then resend.';
  if (total === 0) return null;
  return <DropdownMenu modal={false} onOpenChange={(open) => { if (open) setShowFiles(false); }}>
    <DropdownMenuTrigger asChild><Button variant="plain" size="none" className="v2-user-edit-send v2-user-edit-options"
      aria-label={t("Resend options")} title={t("Resend options")} data-transcript-selection-exclude=""><ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end" loop className="grid w-60 grid-cols-[1fr_auto] p-1 [--hover-surface:transparent]"
      data-editor-popup-owner={impact.messageId} data-transcript-selection-exclude="" aria-label={showFiles ? t("Files affected by restore") : t("Resend options")}>
      {!showFiles && <DropdownMenuItem className={`${itemClass} col-span-2`} disabled={disabled} onSelect={() => onResend(false)}>
        {resumeOnly ? t("Reconnect & resend") : t("Resend")}
      </DropdownMenuItem>}
      {!showFiles && <DropdownMenuItem className={itemClass} disabled={disabled || resumeOnly || count === 0}
        title={restoreHint} aria-label={t("Restore & resend. {p0}", { p0: restoreHint })} onSelect={() => onResend(true)}>
        {restored ? t("Restore requested") : count > 0 ? t("Restore & resend") : t("Restore unavailable")}
      </DropdownMenuItem>}
      {/* Keep this item mounted so keyboard focus survives both directions of the view switch. */}
      <DropdownMenuItem className={`${itemClass} ${showFiles ? 'col-span-2 gap-1.5' : 'min-w-6 justify-center text-muted-foreground'}`}
        aria-label={showFiles ? t("Back to resend options") : t("View {p0} file details", { p0: total })} title={showFiles ? t("Back to resend options") : t("View files affected by restore")}
        onSelect={(event) => { event.preventDefault(); setShowFiles(!showFiles); }}>
        {showFiles ? <><ArrowLeft className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{summary}</span></> : total}
      </DropdownMenuItem>
      {showFiles && <div className="col-span-2 max-h-[72px] overflow-y-auto overscroll-contain" role="group" aria-label={t("File list")}>
        {details.map((file, index) => {
          const location = file.location === 'workspace' ? '' : file.location === 'outside-workspace' ? 'Outside workspace' : 'Workspace location unavailable';
          const description = [file.label, actionLabels[file.action], location, file.reason].filter(Boolean).join(' · ');
          const content = <><span className="min-w-0 truncate">{file.label.split(/[\\/]/u).at(-1)}</span>
            {mixed || location ? <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{[mixed ? actionLabels[file.action] : '', location ? file.location === 'outside-workspace' ? 'Outside' : 'Unknown' : ''].filter(Boolean).join(' · ')}</span> : null}</>;
          return file.location === 'workspace' && actions?.openPath ? <DropdownMenuItem key={`${file.label}:${index}`}
            className={itemClass} disabled={openDisabled} title={t("Open current file: {p0}", { p0: description })} aria-label={t("Open current file: {p0}", { p0: description })}
            onSelect={(event) => { event.preventDefault(); actions.openPath?.({ path: file.label }); }}>{content}</DropdownMenuItem>
            : <div key={`${file.label}:${index}`} className={`${itemClass} flex items-center gap-1.5`} title={description} aria-label={description}>{content}</div>;
        })}
        {omittedAffected > 0 ? <p className={`${itemClass} flex items-center text-muted-foreground`} title={t("Restoration applies to all {p0} affected files.", { p0: count })}>{omittedAffected} {t("more affected files not listed")}</p> : null}
        {omittedUnavailable > 0 ? <p className={`${itemClass} flex items-center text-muted-foreground`}>{omittedUnavailable} {t("more unavailable files not listed")}</p> : null}
      </div>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
