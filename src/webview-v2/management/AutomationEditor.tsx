import { useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Input, Textarea } from '@droidvisx/chat-ui/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@droidvisx/chat-ui/ui/overlays';
import { AUTOMATION_PROMPT_LIMIT, isAutomationDraft, isAutomationSchedule, type AutomationDraft,
  type ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { SettingsModelPicker } from '../models/SettingsModelPicker';

export function AutomationEditor({ row, state, onClose, onSaved }: {
  row: ManagedAutomation | null; state: ManagementState; onClose(): void; onSaved(message?: string): void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AutomationDraft>(() => row ? {
    name: row.name, description: row.description, prompt: row.prompt, schedule: row.schedule,
    model: row.model, reasoningEffort: row.reasoningEffort, workingDirectory: row.workingDirectory,
  } : { name: '', description: '', prompt: '', schedule: '0 9 * * 1-5', model: '', reasoningEffort: '', workingDirectory: '' });
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = saving || state.busy;
  const set = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    setDraft(previous => ({ ...previous, [key]: value }));
  const save = async () => {
    if (disabled || pending.current || !isAutomationDraft(draft)) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      const result = await state.run(row
        ? { kind: 'automations.update', id: row.id, revision: row.revision, draft }
        : { kind: 'automations.create', draft });
      if (result.ok) onSaved(result.message);
      else setError(result.message ?? 'Automation could not be saved.');
    } finally { pending.current = false; setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !disabled) onClose(); }}>
    <DialogContent className="management-dialog max-w-2xl" closeDisabled={disabled}>
      <DialogTitle data-ui-notice="">{t(row ? 'Edit automation' : 'New automation')}</DialogTitle>
      <DialogDescription className="management-caption">
        {t(row ? 'Changes apply to future runs.' : 'New automations are private and paused. Enable the schedule separately.')}
      </DialogDescription>
      <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Name')}</span>
          <Input value={draft.name} maxLength={200} disabled={disabled} onChange={e => set('name', e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Description')}</span>
          <Input value={draft.description} maxLength={1024} disabled={disabled} onChange={e => set('description', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Instructions')}</span>
          <Textarea value={draft.prompt} rows={7} maxLength={AUTOMATION_PROMPT_LIMIT} disabled={disabled}
            onChange={e => set('prompt', e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Schedule (UTC cron)')}</span>
          <Input value={draft.schedule} placeholder="0 9 * * 1-5" maxLength={128} disabled={disabled}
            aria-invalid={!isAutomationSchedule(draft.schedule)} aria-describedby="automation-cron-help"
            onChange={e => set('schedule', e.target.value)} required />
        </label>
        <p id="automation-cron-help" data-ui-notice="" className="management-caption">
          {t('Five fields: minute, hour, day, month, weekday. 0 9 * * 1-5 runs weekdays at 09:00 UTC.')}
        </p>
        <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Working directory')}</span>
          <Input value={draft.workingDirectory} maxLength={4096} disabled={disabled}
            placeholder={t('Blank uses the automation folder')} onChange={e => set('workingDirectory', e.target.value)} />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span data-ui-notice="">{t('Model')}</span>
          <SettingsModelPicker label={t('Automation model')} models={state.settings?.reviewQuestion.models ?? []}
            modelId={draft.model || null} reasoningEffort={draft.reasoningEffort || null} disabled={disabled}
            inherit={{ label: t('Droid default') }} defaultEffortLabel={t('Model default')}
            onModelChange={model => setDraft(current => ({ ...current, model: model ?? '', reasoningEffort: '' }))}
            onEffortChange={effort => set('reasoningEffort', (effort ?? '') as AutomationDraft['reasoningEffort'])} />
        </div>
        {error && <p role="alert" data-ui-notice="" className="management-caption text-destructive">{t(error)}</p>}
        <div className="management-actions justify-end">
          <Button variant="plain" type="button" disabled={disabled} onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="outline" type="submit" disabled={disabled || !isAutomationDraft(draft)}>
            {t(saving ? 'Saving…' : row ? 'Save' : 'Create paused')}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
