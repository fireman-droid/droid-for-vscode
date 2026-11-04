import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { StaticHtmlPreview } from '@droidvisx/chat-ui/ui/static-html-preview';
import type { AutomationVisual as Visual } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';

export function AutomationVisual({ id, state, active, onHistory }: {
  id: string; state: ManagementState; active: boolean; onHistory(): void;
}) {
  const { t } = useI18n();
  const [visual, setVisual] = useState<Visual | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const load = async () => {
    if (pending.current || state.busy) return;
    pending.current = true; setAttempted(true); setError(null);
    try {
      const result = await state.run({ kind: 'automations.visual', id });
      if (result.ok && result.automationVisual) setVisual(result.automationVisual);
      else setError(result.message ?? 'The result dashboard could not be loaded.');
    } finally { pending.current = false; }
  };
  useEffect(() => { if (active && !attempted && !state.busy) void load(); }, [active, attempted, state.busy]);
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
  return <section aria-label={t('Result dashboard')} className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-3">
      <p data-ui-notice="" className="management-caption">{t('Static preview only. Scripts, external resources and plugin access are disabled.')}</p>
      <Button variant="plain" size="sm" disabled={state.busy} onClick={() => void load()}>{t('Refresh dashboard')}</Button>
    </div>
    {error && <p data-ui-notice="" role="alert" className="text-destructive">{t(error)}</p>}
    {attempted && !visual && !error && <p data-ui-notice="" role="status">{t('Loading dashboard…')}</p>}
    {visual?.content ? <>
      <p data-ui-notice="" className="management-caption">{t(visual.stale ? 'This dashboard is outdated. Check run history for the actual result.'
        : 'Generated dashboard content is not proof that the latest run completed.')}</p>
      {nonce ? <StaticHtmlPreview html={visual.content} nonce={nonce} title={t('Result dashboard')} />
        : <p data-ui-notice="" role="alert">{t('Secure preview is unavailable in this surface.')}</p>}
    </> : visual && <div className="management-empty">
      <p data-ui-notice="">{t(visual.exists ? 'The dashboard is not available as local HTML.' : 'No result dashboard has been generated.')}</p>
      <Button variant="plain" size="sm" disabled={state.busy} onClick={onHistory}>{t('Run history')}</Button>
    </div>}
  </section>;
}
