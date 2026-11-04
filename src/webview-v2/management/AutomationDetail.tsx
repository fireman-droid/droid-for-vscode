import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@droidvisx/chat-ui/ui/selection';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@droidvisx/chat-ui/ui/collapsible';
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
  const disabled = loading || state.busy;
  return <section aria-label={row.name}>
    <Button variant="plain" size="sm" disabled={disabled} onClick={onBack} className="mb-4"><ArrowLeft />{t('Back to automations')}</Button>
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
      <TabsContent value="overview" className="flex flex-col gap-5">
        {row.description && <p className="break-words">{row.description}</p>}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h2 data-ui-notice="" className="font-medium">{t('Schedule')}</h2>
            <AutomationScheduleSummary schedule={row.schedule} />
            <code>{row.schedule} UTC</code>
            <p data-ui-notice="">{t('Next run')}: {row.status === 'paused' ? '—' : row.nextRunAt ? automationTime(row.nextRunAt, locale) : t('Unknown')}</p>
            <p data-ui-notice="" className="management-caption">{t('Run timestamps use this computer’s timezone.')}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 data-ui-notice="" className="font-medium">{t('Session')}</h2>
            <p data-ui-notice="">{t(row.targetSessionId ? 'Deliver to a fixed session' : 'New session for each run')}</p>
            {row.targetSessionId ? <>
              <AutomationTarget key={`${row.targetSessionId}-${refreshKey}`} id={row.id} sessionId={row.targetSessionId}
                state={state} active={active && tab === 'overview'} />
              <p data-ui-notice="" className="management-caption">{t('Model, reasoning, autonomy and working directory follow the target session. The target is fixed at creation.')}</p>
            </> : <p data-ui-notice="" className="management-caption">{t('Open each run’s session from run history. The creation conversation is not its destination.')}</p>}
          </section>
          {!row.targetSessionId && <section className="flex flex-col gap-2">
            <h2 data-ui-notice="" className="font-medium">{t('Execution settings')}</h2>
            <p className="break-words">{row.workingDirectory || t('Blank uses the automation folder')}</p>
            <p>{state.settings?.reviewQuestion.models.find(model => model.id === row.model)?.label || row.model || t('Droid default')} · {row.reasoningEffort || t('Model default')}</p>
          </section>}
          <section className="flex flex-col gap-2">
            <h2 data-ui-notice="" className="font-medium">{t('Latest run')}</h2>
            <p data-ui-notice="">{automationTime(row.lastRunAt, locale)} · {row.lastRunStatus ? t(row.lastRunStatus) : t('Unknown')}</p>
            <Button variant="plain" size="sm" disabled={disabled} onClick={() => onTab('history')}>{t('Run history')}</Button>
          </section>
        </div>
        <Collapsible>
          <CollapsibleTrigger asChild><Button variant="plain" size="sm">{t('Show instructions')}</Button></CollapsibleTrigger>
          <CollapsibleContent><pre className="mt-3 whitespace-pre-wrap break-words text-sm">{row.prompt}</pre></CollapsibleContent>
        </Collapsible>
        <p data-ui-notice="" className="management-caption">{t('Local schedules need this computer awake, online, and running Droid. Closing this page does not pause them.')}</p>
        <p data-ui-notice="" className="management-caption">{t('Pause affects future schedules only. It does not stop a running task or retract a delivered message.')}</p>
      </TabsContent>
      <TabsContent value="history"><AutomationHistory key={`${row.id}-${refreshKey}`} row={row} state={state} active={active && tab === 'history'} /></TabsContent>
      <TabsContent value="visual"><AutomationVisual key={`${row.id}-${refreshKey}`} id={row.id} state={state} active={active && tab === 'visual'} onHistory={() => onTab('history')} /></TabsContent>
    </Tabs>
  </section>;
}
