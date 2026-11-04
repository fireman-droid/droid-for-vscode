import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Input } from '@droidvisx/chat-ui/ui/input';
import { RadioGroup, RadioGroupItem } from '@droidvisx/chat-ui/ui/controls';
import type { AutomationSessionChoice } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';

export function AutomationSessionPicker({ state, value, onChange }: {
  state: ManagementState; value: string | null; onChange(session: AutomationSessionChoice): void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<readonly AutomationSessionChoice[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const pending = useRef(false);
  const load = async (next: number | null) => {
    if (pending.current || state.busy) return;
    pending.current = true; setAttempted(true); setError(null);
    try {
      const result = await state.run({ kind: 'automations.sessions', cursor: next });
      if (result.ok && result.automationSessions) {
        const page = result.automationSessions;
        setRows(old => [...new Map([...(next === null ? [] : old), ...page.sessions].map(row => [row.id, row])).values()]);
        setCursor(page.nextCursor);
      } else setError(result.message ?? 'Sessions could not be loaded.');
    } finally { pending.current = false; }
  };
  useEffect(() => { if (!attempted && !state.busy) void load(null); }, [attempted, state.busy]);
  const visible = rows.filter(row => `${row.title} ${row.cwd} ${row.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = rows.find(row => row.id === value);
  return <div className="flex flex-col gap-2">
    <Input aria-label={t('Search loaded sessions')} placeholder={t('Search loaded sessions')} value={query}
      onChange={e => setQuery(e.target.value)} />
    {selected && <p data-ui-notice="" className="management-caption">{t('Target session')}: {selected.title} · {selected.id}</p>}
    <RadioGroup aria-label={t('Target session')} value={value ?? ''} disabled={state.busy}
      onValueChange={id => { const row = rows.find(item => item.id === id); if (row) onChange(row); }}>
      {visible.map(row => <label key={row.id} className="flex items-start gap-2 py-1">
        <RadioGroupItem value={row.id} aria-label={`${row.title} · ${row.id}`} className="mt-1" />
        <span data-ui-notice="" className="min-w-0 break-words">{row.title}{row.current && ` · ${t('Current chat')}`}
          <small className="block management-caption">{row.cwd} · {row.id.slice(0, 8)}</small></span>
      </label>)}
    </RadioGroup>
    {!visible.length && attempted && !state.busy && !error && <p data-ui-notice="" className="management-caption">{t('No matching sessions in the loaded pages.')}</p>}
    {error && <p data-ui-notice="" role="alert" className="text-destructive">{t(error)}</p>}
    <div className="management-actions">
      <Button type="button" variant="plain" size="sm" disabled={state.busy} onClick={() => void load(null)}>{t('Refresh')}</Button>
      {cursor !== null && <Button type="button" variant="plain" size="sm" disabled={state.busy} onClick={() => void load(cursor)}>{t('Load more sessions')}</Button>}
    </div>
  </div>;
}
