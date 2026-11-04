import { useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Input, Textarea } from '@droidvisx/chat-ui/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@droidvisx/chat-ui/ui/overlays';
import { AUTOMATION_PROMPT_LIMIT, isAutomationDraft, isAutomationSchedule, type AutomationDraft,
  type ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementResult } from '../../shared/protocol/managementPageProtocol';
import type { ManagementState } from './useManagement';
import { AutomationScheduleFields } from './AutomationScheduleFields';
import { AutomationExecutionFields } from './AutomationExecutionFields';

function editableDraft(row: ManagedAutomation): AutomationDraft {
  return { name: row.name, description: row.description, prompt: row.prompt, schedule: row.schedule,
    model: row.model, reasoningEffort: row.reasoningEffort, workingDirectory: row.workingDirectory, targetSessionId: row.targetSessionId };
}
export function AutomationEditor({ row, state, onClose, onSaved }: {
  row: ManagedAutomation | null; state: ManagementState; onClose(): void; onSaved(result: ManagementResult): void;
}) {
  const { t } = useI18n();
  const [baseline, setBaseline] = useState(row);
  const [latest, setLatest] = useState<ManagedAutomation | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(() => row ? editableDraft(row) : {
    name: '', description: '', prompt: '', schedule: '0 1 * * *', model: '', reasoningEffort: '',
    workingDirectory: state.settings?.cwd ?? '', targetSessionId: null,
  });
  const [bound, setBound] = useState(!!row?.targetSessionId);
  const [targetTitle, setTargetTitle] = useState('');
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = saving || state.busy;
  const set = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    setDraft(previous => ({ ...previous, [key]: value }));
  const valid = isAutomationDraft(draft) && (!bound || !!draft.targetSessionId);
  const save = async () => {
    if (disabled || pending.current || !valid) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      const result = await state.run(baseline
        ? { kind: 'automations.update', id: baseline.id, revision: baseline.revision, draft }
        : { kind: 'automations.create', draft });
      if (result.ok || !baseline && result.automationId) onSaved(result);
      else setError(result.message ?? 'Automation could not be saved.');
    } finally { pending.current = false; setSaving(false); }
  };
  const nextAllowed = step === 0 ? !!draft.name.trim() && isAutomationSchedule(draft.schedule) : !bound || !!draft.targetSessionId;
  return <Dialog open onOpenChange={open => { if (!open && !disabled) onClose(); }}>
    <DialogContent className="management-dialog max-w-2xl" closeDisabled={disabled}>
      <DialogTitle data-ui-notice="">{t(row ? 'Edit automation' : 'New automation')}</DialogTitle>
      <DialogDescription data-ui-notice="" className="management-caption">
        {t(row ? 'Changes apply to future runs.' : 'New automations are private and paused. Enable the schedule separately.')}
      </DialogDescription>
      {!row && <ol aria-label={t('Creation steps')} data-ui-notice="" className="flex flex-wrap gap-3 management-caption">
        {['Name and schedule', 'Execution and session', 'Instructions and confirmation'].map((label, i) =>
          <li key={label} aria-current={step === i ? 'step' : undefined} className={step === i ? 'text-foreground' : undefined}>{i + 1}. {t(label)}</li>)}
      </ol>}
      <form className="flex flex-col gap-4" onSubmit={event => {
        event.preventDefault();
        if (!row && step < 2) { if (nextAllowed && !disabled) setStep(step + 1); } else void save();
      }}>
        {(row || step === 0) && <>
          <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Name')}</span>
            <Input value={draft.name} maxLength={200} disabled={disabled} onChange={e => set('name', e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Description')}</span>
            <Input value={draft.description} maxLength={1024} disabled={disabled} onChange={e => set('description', e.target.value)} />
          </label>
          <AutomationScheduleFields value={draft.schedule} disabled={disabled} onChange={value => set('schedule', value)} />
        </>}
        {(row || step === 1) && <AutomationExecutionFields draft={draft} setDraft={setDraft} state={state}
          editing={!!row} bound={bound} disabled={disabled} onBound={value => {
            setBound(value); set('targetSessionId', null); setTargetTitle('');
          }} onSession={session => { set('targetSessionId', session.id); setTargetTitle(session.title); }} />}
        {(row || step === 2) && <>
          <label className="flex flex-col gap-1"><span data-ui-notice="">{t('Instructions')}</span>
            <Textarea value={draft.prompt} rows={7} maxLength={AUTOMATION_PROMPT_LIMIT} disabled={disabled}
              onChange={e => set('prompt', e.target.value)} required />
          </label>
          {!row && <div className="flex flex-col gap-1">
            <p data-ui-notice="">{draft.name} · <code>{draft.schedule}</code> UTC</p>
            <p data-ui-notice="">{t(bound ? 'Deliver to a fixed session' : 'New session for each run')}</p>
            {bound ? <p className="break-all">{targetTitle} · {draft.targetSessionId}</p>
              : <p className="break-words">{draft.workingDirectory || t('Blank uses the automation folder')} · {draft.model || t('Droid default')}</p>}
            <p data-ui-notice="" className="management-caption">{t('Creation does not run the task. Enable its schedule or run it from the detail page.')}</p>
          </div>}
        </>}
        {error && <div className="flex flex-col gap-2">
          <p role="alert" data-ui-notice="" className="management-caption text-destructive">{t(error)}</p>
          {baseline && <Button type="button" variant="plain" size="sm" disabled={disabled} onClick={() => void state.run({ kind: 'automations.list' }).then(result => {
            const saved = result.automations?.find(item => item.id === baseline.id);
            if (result.ok && saved) setLatest(saved);
          })}>{t('Compare saved configuration')}</Button>}
        </div>}
        {latest && <div className="flex flex-col gap-2">
          <p data-ui-notice="" className="management-caption">{t('Saved configuration. Your draft above is unchanged.')}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(editableDraft(latest), null, 2)}</pre>
          <Button type="button" variant="outline" size="sm" disabled={disabled || latest.targetSessionId !== draft.targetSessionId}
            onClick={() => { setBaseline(latest); setLatest(null); setError(null); }}>{t('Keep draft against this revision')}</Button>
        </div>}
        <div className="management-actions justify-end">
          <Button variant="plain" type="button" disabled={disabled} onClick={onClose}>{t('Cancel')}</Button>
          {!row && step > 0 && <Button variant="plain" type="button" disabled={disabled} onClick={() => setStep(step - 1)}>{t('Previous')}</Button>}
          {!row && step < 2
            ? <Button variant="outline" type="submit" disabled={disabled || !nextAllowed}>{t('Next')}</Button>
            : <Button variant="outline" type="submit" disabled={disabled || !valid}>{t(saving ? 'Saving…' : row ? 'Save' : 'Create paused')}</Button>}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
