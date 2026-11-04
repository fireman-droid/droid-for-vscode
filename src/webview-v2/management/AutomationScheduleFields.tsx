import { useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Input } from '@droidvisx/chat-ui/ui/input';
import { isAutomationSchedule } from '../../shared/protocol/automationProtocol';
import { ManagementChoice } from './ManagementFields';
import { AUTOMATION_WEEKDAYS, readSimpleSchedule, writeSimpleSchedule } from './automationSchedule';

const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, index) => {
  const slot = `${Math.floor(index / 2).toString().padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`;
  return [slot, slot] as const;
});

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
  const timeOptions = HALF_HOUR_SLOTS.some(([slot]) => slot === simple.time)
    ? HALF_HOUR_SLOTS
    : [...HALF_HOUR_SLOTS, [simple.time, simple.time] as const].sort(([a], [b]) => a.localeCompare(b));
  const setSimple = (time: string, day: number | null) => {
    const cron = writeSimpleSchedule(time, day, offset);
    if (cron) onChange(cron);
  };
  return <fieldset className="flex flex-col gap-2" disabled={disabled}>
    <legend data-ui-notice="" className="mb-2">{t('Schedule')}</legend>
    <div className="flex flex-wrap items-center gap-2">
      <ManagementChoice label="Frequency" align="start" value={mode} disabled={disabled}
        options={[['daily', t('Daily')], ['weekly', t('Weekly')], ['cron', t('Advanced UTC cron')]]}
        onChange={next => { setMode(next); if (next !== 'cron') setSimple(simple.time, next === 'daily' ? null : simple.day ?? 1); }} />
      {mode !== 'cron' && <>
        {mode === 'weekly' && <ManagementChoice label="Weekday" align="start" value={String(simple.day ?? 1)} disabled={disabled}
          options={AUTOMATION_WEEKDAYS.map((day, index) => [String(index), t(day)])}
          onChange={day => setSimple(simple.time, Number(day))} />}
        <ManagementChoice label="Run time" align="start" value={simple.time} disabled={disabled}
          options={timeOptions} onChange={time => setSimple(time, mode === 'daily' ? null : simple.day ?? 1)} />
        <ManagementChoice label="Display timezone" align="start" value={String(offset)} disabled={disabled}
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
