import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { MAX_SYSTEM_PROMPT_LENGTH, type SystemPromptPreference } from '../../shared/protocol/systemPromptProtocol';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { createTurnId, type ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { SettingChoice } from './SessionSettingsPanel';

export function SystemPromptDialog({ open, onOpenChange, port }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly port: ChatPort;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<SystemPromptPreference['mode']>('default');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<'read' | 'save' | null>('read');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const request = useRef<{ id: string; operation: 'read' | 'save' } | null>(null);
  const fieldId = useId();
  const send = (operation: 'read' | 'save') => {
    const requestId = createTurnId();
    request.current = { id: requestId, operation };
    setPending(operation); setError(null); setSaved(false);
    if (operation === 'read') port.postMessage({ type: 'systemPrompt.read', requestId });
    else port.postMessage({ type: 'systemPrompt.save', requestId, preference: mode === 'default' ? { mode } : { mode, text } });
  };
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    const unsubscribe = subscribeHostMessages((message) => {
      if (message.type !== 'systemPrompt.state' || message.requestId !== request.current?.id) return;
      const operation = request.current.operation;
      request.current = null; setPending(null); setError(message.error);
      if (message.error !== null) return;
      setMode(message.preference.mode);
      setText(message.preference.mode === 'default' ? '' : message.preference.text);
      setLoaded(true); setSaved(operation === 'save');
    });
    send('read');
    return () => { request.current = null; unsubscribe(); };
  }, [open, port]);
  useEffect(() => {
    if (!open || pending === null) return;
    const timer = setTimeout(() => {
      request.current = null; setPending(null);
      setError('No response received. Reopen the dialog to check the saved value.');
    }, 15_000);
    return () => clearTimeout(timer);
  }, [open, pending]);
  const invalid = mode !== 'default' && (text.trim().length === 0 || text.length > MAX_SYSTEM_PROMPT_LENGTH || text.includes('\0'));
  return <Dialog open={open} onOpenChange={(value) => { if (pending !== 'save') onOpenChange(value); }}>
    <DialogContent className="space-y-4" closeDisabled={pending === 'save'}>
      <DialogTitle className="pr-8 text-base font-semibold">{t("System prompt for new sessions")}</DialogTitle>
      <DialogDescription className="text-xs text-muted-foreground">{t("Saved for this VS Code profile. Applies to new chats, worktree sessions and Missions. Existing, resumed and forked sessions keep their original prompt.")}</DialogDescription>
      <SettingChoice label={t("Prompt mode")} value={mode} disabled={!loaded || pending !== null} options={[
        { label: t('Droid default'), value: 'default' },
        { label: t('Append to Droid default'), value: 'append' },
        { label: t('Replace Droid default'), value: 'replace' },
      ]} onChange={(value) => { setMode(value as SystemPromptPreference['mode']); setSaved(false); }} />
      {mode !== 'default' ? <div className="space-y-2">
        <label htmlFor={fieldId} className="text-xs font-medium">{mode === 'append' ? t("Additional instructions") : t("Replacement system prompt")}</label>
        <Textarea id={fieldId} rows={10} value={text} disabled={pending !== null} maxLength={MAX_SYSTEM_PROMPT_LENGTH}
          aria-invalid={invalid} aria-describedby={`${fieldId}-hint`}
          onChange={(event) => { setText(event.target.value); setSaved(false); }} />
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">{mode === 'replace' ? t("Replaces Droid’s built-in system instructions. Tools and permission settings remain configured separately.") : t("Keeps Droid’s built-in instructions and adds your text.")} {text.length.toLocaleString()} / {MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()} {t("characters.")}</p>
      </div> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{t(error)}</p> : null}
      {saved ? <p role="status" className="text-xs text-muted-foreground">{t("Saved. Start a new session to use this prompt.")}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={pending === 'save'} onClick={() => onOpenChange(false)}>{t("Close")}</Button>
        <Button disabled={!loaded || pending !== null || invalid} onClick={() => send('save')}>{pending === 'save' ? t("Saving…") : pending === 'read' ? t("Loading…") : t("Save for new sessions")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
