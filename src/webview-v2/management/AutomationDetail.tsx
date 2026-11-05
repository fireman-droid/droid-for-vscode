import { useState } from 'react';
import { ArrowLeft, ChevronDown, RefreshCw } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@droidvisx/chat-ui/ui/selection';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '@droidvisx/chat-ui/ui/collapsible';
import { SettingsRow, SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import type { AutomationAction, ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { AutomationActions } from './AutomationActions';
import { AutomationHistory, automationTime } from './AutomationHistory';
import { AutomationVisual } from './AutomationVisual';
import { AutomationTarget } from './AutomationTarget';
import { AUTOMATION_WEEKDAYS, readSimpleSchedule } from './automationSchedule';

export function AutomationScheduleSummary({ schedule }: { schedule: string }) {
  const { t } = useI18n();
  const simple = readSimpleSchedule(schedule);
  return <span data-ui-notice="">{simple
    ? `${t(simple.day === null ? 'Daily' : AUTOMATION_WEEKDAYS[simple.day])} ${simple.time} · UTC+08:00`
    : `${schedule || '—'} · UTC`}</span>;
}
export function AutomationDetail({ row, state, active, loading, tab, onTab, onBack, onRefresh, onEdit, onAction, refreshKey }: {
  row: ManagedAutomation; state: ManagementState; active: boolean; loading: boolean; tab: string; onTab(value: string): void;
  onBack(): void; onRefresh(): void; onEdit(): void; onAction(action: AutomationAction): void; refreshKey: number;
}) {
  const { t, locale } = useI18n();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const disabled = loading || state.busy;
  const modelLabel = state.settings?.reviewQuestion.models.find(model => model.id === row.model)?.label || row.model || t('Droid default');
  return <section aria-label={row.name}>
    <Button variant="plain" size="none" disabled={disabled} onClick={onBack} className="management-back-link"><ArrowLeft />{t('Back to automations')}</Button>
    <header className="management-heading">
      <div className="min-w-0"><h1 className="break-words">{row.name}</h1><p data-ui-notice="">{t(row.status)} · {t('This computer')}</p></div>
      <div className="management-actions">
        <Button variant="plain" size="icon-sm" aria-label={t('Refresh automations')} disabled={disabled} onClick={onRefresh}><RefreshCw /></Button>
        <AutomationActions row={row} disabled={disabled} primary onAction={onAction} onEdit={onEdit} onHistory={() => onTab('history')} />
      </div>
    </header>
    {row.blockedReason && <p data-ui-notice="" role="alert" className="mb-4 text-destructive">{t(row.blockedReason)}</p>}
    {!row.valid && <p data-ui-notice="" role="alert" className="mb-4 text-destructive">{t('Invalid configuration')}</p>}
    {!row.editable && <p data-ui-notice="" className="mb-4 management-caption">{t('This automation is managed elsewhere or has unsupported settings.')}</p>}
    <Tabs value={tab} onValueChange={onTab} className="management-page-tabs">
      <TabsList aria-label={t('Automation details')} animatedIndicator>
        <TabsTrigger value="overview">{t('Overview')}</TabsTrigger>
        <TabsTrigger value="history">{t('Run history')}</TabsTrigger>
        <TabsTrigger value="visual">{t('Result dashboard')}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        {row.description && <p className="mb-5 break-words text-muted-foreground">{row.description}</p>}
        <SettingsSection title={t('Schedule')}>
          <SettingsRow
            label={<AutomationScheduleSummary schedule={row.schedule} />}
            detail={`${t('Next run')}: ${row.status === 'paused' ? '—' : row.nextRunAt ? automationTime(row.nextRunAt, locale) : t('Unknown')}`}
          >
            <span className="management-code-pill">{row.schedule} UTC</span>
          </SettingsRow>
          <SettingsRow
            label={t('Latest run')}
            detail={`${automationTime(row.lastRunAt, locale)} · ${row.lastRunStatus ? t(row.lastRunStatus) : t('Unknown')}`}
          >
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => onTab('history')}>{t('Run history')}</Button>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection title={t('Session')}>
          {row.targetSessionId
            ? <AutomationTarget key={`${row.targetSessionId}-${refreshKey}`} id={row.id} sessionId={row.targetSessionId}
                state={state} active={active && tab === 'overview'} />
            : <>
              <SettingsRow
                label={t('Session mode')}
                detail={t('Open each run’s session from run history. The creation conversation is not its destination.')}
              >
                <span data-ui-notice="" className="text-muted-foreground">{t('New session for each run')}</span>
              </SettingsRow>
              <SettingsRow
                label={t('Execution settings')}
                detail={row.workingDirectory || t('Blank uses the automation folder')}
              >
                <span>{modelLabel} · {row.reasoningEffort || t('Model default')}</span>
              </SettingsRow>
            </>}
        </SettingsSection>
        <SettingsSection title={t('Instructions')}>
          <Collapsible open={instructionsOpen} onOpenChange={setInstructionsOpen}>
            <SettingsRow label={row.prompt.split(/\r?\n/, 1)[0] || t('Instructions')}>
              <CollapsibleTrigger asChild>
                <Button variant="plain" size="sm" className="management-advanced">{t('Show instructions')}<ChevronDown /></Button>
              </CollapsibleTrigger>
            </SettingsRow>
            <AnimatedCollapsibleContent open={instructionsOpen}>
              <pre className="management-prompt-pre">{row.prompt}</pre>
            </AnimatedCollapsibleContent>
          </Collapsible>
        </SettingsSection>
        <p data-ui-notice="" className="management-caption">{t('Local schedules need this computer awake, online, and running Droid. Closing this page does not pause them.')}</p>
      </TabsContent>
      <TabsContent value="history"><AutomationHistory key={`${row.id}-${refreshKey}`} row={row} state={state} active={active && tab === 'history'} /></TabsContent>
      <TabsContent value="visual"><AutomationVisual key={`${row.id}-${refreshKey}`} row={row} state={state} active={active && tab === 'visual'} onHistory={() => onTab('history')} /></TabsContent>
    </Tabs>
  </section>;
}
