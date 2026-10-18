import { useI18n } from '../i18n';
import { Button } from '../ui/button';
import { ChangeLineStats, type ChangeFile } from './FileChangeView';

/** A process receipt links to the separate file result, without another Diff body. */
export function FileChangeRecord({ file, onSelect }: { readonly file: ChangeFile; readonly onSelect: () => void }) {
  const { t } = useI18n();
  return <Button variant="plain" size="none" className="flex min-h-6 w-full min-w-0 items-center gap-2 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
    aria-label={t('Show recorded changes to {path}', { path: file.path })} onClick={onSelect}>
    <span className="shrink-0">{t(file.kind === 'added' ? 'Created' : file.kind === 'deleted' ? 'Deleted' : file.kind === 'renamed' ? 'Renamed' : 'Edited')}</span>
    <span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>
    <ChangeLineStats additions={file.additions} deletions={file.deletions} />
    <span className="shrink-0 text-[11px]">{t('View changes')} ↓</span>
  </Button>;
}
