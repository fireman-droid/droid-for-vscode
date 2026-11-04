import { useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Input } from '@droidvisx/chat-ui/ui/input';
import { isAutomationSchedule } from '../../shared/protocol/automationProtocol';
import { ManagementChoice } from './ManagementFields';
import { AUTOMATION_WEEKDAYS, readSimpleSchedule, writeSimpleSchedule } from './automationSchedule';

export function AutomationScheduleFields({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange(value: string): void;
}) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(480);
  const [mode, setMode] = useState(() => {
    const parsed = readSimpleSchedule(value);
    return parsed ? parsed.day === null ? 'daily' : 'weekly' : 'cron';
  });
  const simple = readSimpleSchedule(value, offset) ?? { time: '09:00', day: 1 };
  const setSimple = (time: string, day: number | null) => {
    const cron = writeSimpleSchedule(time, day, offset);
    if (cron) onChange(cron);
  };
  return <fieldset className="flex flex-col gap-2" disabled={disabled}>
    <legend data-ui-notice="" className="mb-2">{t('Schedule')}</legend>
    <div className="flex flex-wrap items-center gap-2">
      <ManagementChoice label="Frequency" value={mode} disabled={disabled}
        options={[['daily', t('Daily')], ['weekly', t('Weekly')], ['cron', t('Advanced UTC cron')]]}
        onChange={next => { setMode(next); if (next !== 'cron') setSimple(simple.time, next === 'daily' ? null : simple.day ?? 1); }} />
      {mode !== 'cron' && <>
        {mode === 'weekly' && <ManagementChoice label="Weekday" value={String(simple.day ?? 1)} disabled={disabled}
          options={AUTOMATION_WEEKDAYS.map((day, index) => [String(index), t(day)])}
          onChange={day => setSimple(simple.time, Number(day))} />}
        <Input type="time" aria-label={t('Run time')} value={simple.time} disabled={disabled} className="w-28"
          onChange={e => setSimple(e.target.value, mode === 'daily' ? null : simple.day ?? 1)} />
        <ManagementChoice label="Display timezone" value={String(offset)} disabled={disabled}
          options={[['480', t('Beijing time (UTC+08:00)')], ['0', 'UTC']]} onChange={next => setOffset(Number(next))} />
      </>}
    </div>
    {mode === 'cron' && <Input aria-label={t('Schedule (UTC cron)')} value={value} maxLength={128} disabled={disabled}
      aria-invalid={!isAutomationSchedule(value)} onChange={e => onChange(e.target.value)} />}
    <p data-ui-notice="" className="management-caption">
      {t('Stored in UTC. Daylight-saving changes are not automatic.')} <code>{value}</code>
    </p>
  </fieldset>;
}
