import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import type { AutomationTarget as Target } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';

export function AutomationTarget({ id, sessionId, state, active }: {
  id: string; sessionId: string; state: ManagementState; active: boolean;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const load = async () => {
    if (pending.current || state.busy) return;
    pending.current = true; setAttempted(true); setError(null);
    try {
      const result = await state.run({ kind: 'automations.target', id });
      if (result.ok && result.automationTarget) setTarget(result.automationTarget);
      else setError(result.message ?? 'The linked session is unavailable on this machine.');
    } finally { pending.current = false; }
  };
  useEffect(() => { if (active && !attempted && !state.busy) void load(); }, [active, attempted, state.busy]);
  const open = (resume: boolean) => void state.run({ kind: 'automations.session', id, runId: null, offset: 0, resume });
  return <div className="flex flex-col gap-2">
    {target && <p>{target.title}{target.current && <span data-ui-notice=""> · {t('Current chat')}</span>}</p>}
    <code className="break-all">{sessionId}</code>
    {target && <p className="management-caption break-words">{target.cwd}</p>}
    {!!target?.pendingPermissions && <p data-ui-notice="" role="status">{t('The target session is waiting for permission. Continue in chat to review it.')}</p>}
    {!!target?.pendingQuestions && <p data-ui-notice="" role="status">{t('The target session is waiting for an answer. Continue in chat to respond.')}</p>}
    {target?.archived && <p data-ui-notice="" className="management-caption">{t('This target session is archived. Restore it in session management before continuing.')}</p>}
    {error && <p data-ui-notice="" role="alert" className="text-destructive">{t(error)}</p>}
    <div className="management-actions">
      <Button variant="plain" size="sm" disabled={state.busy} onClick={() => open(false)}>{t('View target session')}</Button>
      <Button variant="plain" size="sm" disabled={state.busy || !target?.canResume || !!error} onClick={() => open(true)}>{t('Continue in chat')}</Button>
      <Button variant="plain" size="sm" disabled={state.busy} onClick={() => void load()}>{t('Refresh')}</Button>
    </div>
  </div>;
}
