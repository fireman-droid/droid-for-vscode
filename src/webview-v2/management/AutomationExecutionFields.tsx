import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Input } from '@droidvisx/chat-ui/ui/input';
import { RadioGroup, RadioGroupItem } from '@droidvisx/chat-ui/ui/controls';
import type { AutomationDraft, AutomationSessionChoice } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { SettingsModelPicker } from '../models/SettingsModelPicker';
import { AutomationSessionPicker } from './AutomationSessionPicker';

export function AutomationExecutionFields({ draft, setDraft, state, editing, bound, onBound, disabled, onSession }: {
  draft: AutomationDraft; setDraft(update: (value: AutomationDraft) => AutomationDraft): void; state: ManagementState;
  editing: boolean; bound: boolean; onBound(value: boolean): void; disabled: boolean; onSession(session: AutomationSessionChoice): void;
}) {
  const { t } = useI18n();
  return <div className="flex flex-col gap-3">
    <p data-ui-notice="" className="management-caption">{t('Execution location')}: {t('This computer')}</p>
    {editing ? <p data-ui-notice="">{t(bound ? 'Deliver to a fixed session' : 'New session for each run')}</p>
      : <RadioGroup aria-label={t('Session mode')} value={bound ? 'target' : 'new'} disabled={disabled} onValueChange={v => onBound(v === 'target')}>
        {[['new', 'New session for each run'], ['target', 'Deliver to a fixed session']].map(([value, label]) =>
          <label key={value} className="flex items-center gap-2 py-1"><RadioGroupItem value={value} /><span data-ui-notice="">{t(label)}</span></label>)}
      </RadioGroup>}
    {bound ? <>
      {editing ? <code>{draft.targetSessionId}</code>
        : <AutomationSessionPicker state={state} value={draft.targetSessionId} onChange={onSession} />}
      <p data-ui-notice="" className="management-caption">{t('Model, reasoning, autonomy and working directory follow the target session. The target is fixed at creation.')}</p>
    </> : <>
      <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Working directory')}</span>
        <div className="flex gap-2"><Input value={draft.workingDirectory} maxLength={4096} disabled={disabled}
          placeholder={t('Blank uses the automation folder')}
          onChange={e => setDraft(value => ({ ...value, workingDirectory: e.target.value }))} />
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void state.run({ kind: 'automations.directory' }).then(result => {
            if (result.ok && result.automationDirectory) setDraft(value => ({ ...value, workingDirectory: result.automationDirectory! }));
          })}>{t('Browse')}</Button></div>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span data-ui-notice="">{t('Model')}</span>
        <SettingsModelPicker label={t('Automation model')} models={state.settings?.reviewQuestion.models ?? []}
          modelId={draft.model || null} reasoningEffort={draft.reasoningEffort || null} disabled={disabled}
          inherit={{ label: t('Droid default') }} defaultEffortLabel={t('Model default')}
          onModelChange={model => setDraft(current => current.model === (model ?? '') ? current : { ...current, model: model ?? '', reasoningEffort: '' })}
          onEffortChange={effort => setDraft(current => ({ ...current, reasoningEffort: (effort ?? '') as AutomationDraft['reasoningEffort'] }))} />
      </div>
      <p data-ui-notice="" className="management-caption">{t('Each run has its own session and does not inherit the current chat context.')}</p>
    </>}
  </div>;
}
