import { MoreHorizontal } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger } from '@droidvisx/chat-ui/ui/dropdown-menu';
import type { AutomationAction, ManagedAutomation } from '../../shared/protocol/automationProtocol';

export function AutomationActions({ row, disabled, onAction, onEdit, onHistory, primary = false }: {
  row: ManagedAutomation; disabled: boolean; onAction(action: AutomationAction): void;
  onEdit(): void; onHistory(): void; primary?: boolean;
}) {
  const { t } = useI18n();
  const runDisabled = !row.editable || !row.valid || !!row.blockedReason || row.status === 'running';
  const scheduleDisabled = !row.editable || !['active', 'paused', 'running', 'degraded'].includes(row.status)
    || row.status === 'paused' && (!row.valid || !!row.blockedReason);
  return <div className="management-actions">
    {primary && <>
      <Button variant="outline" size="sm" disabled={disabled || runDisabled} onClick={() => onAction({ kind: 'automations.run', id: row.id, revision: row.revision })}>{t('Run now')}</Button>
      <Button variant="plain" size="sm" disabled={disabled || !row.editable} onClick={onEdit}>{t('Edit')}</Button>
    </>}
    <DropdownMenu><DropdownMenuTrigger asChild>
      <Button variant="plain" size="icon-sm" aria-label={t('Automation actions for {p0}', { p0: row.name })} disabled={disabled}><MoreHorizontal /></Button>
    </DropdownMenuTrigger><DropdownMenuContent className="management-menu" align="end">
      {!primary && <>
        <DropdownMenuItem disabled={runDisabled} onSelect={() => onAction({ kind: 'automations.run', id: row.id, revision: row.revision })}>{t('Run now')}</DropdownMenuItem>
        <DropdownMenuItem disabled={!row.editable} onSelect={onEdit}>{t('Edit')}</DropdownMenuItem>
      </>}
      <DropdownMenuItem disabled={scheduleDisabled}
        onSelect={() => onAction({ kind: row.status === 'paused' ? 'automations.resume' : 'automations.pause', id: row.id, revision: row.revision })}>
        {t(row.status === 'paused' ? 'Enable schedule' : 'Pause schedule')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onHistory}>{t('Run history')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!row.editable || row.status === 'running'}
        onSelect={() => onAction({ kind: 'automations.delete', id: row.id, revision: row.revision })}>{t('Delete')}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
  </div>;
}
