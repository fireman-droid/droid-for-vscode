import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ConnectionState } from '../../shared/protocol/shell';
import type { ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/overlays';
import { DroidConnectionDot } from '../ui/droid-motion';
import type { SessionRecoveryStatus } from './ConnectionFeedback';

export function ChatConnectionStatus({ connection, ide, sessionId, blocked, port, recovery, working }: {
  readonly connection: ConnectionState;
  readonly ide: IdeState;
  readonly sessionId: string | null;
  readonly blocked: boolean;
  readonly port: ChatPort;
  readonly recovery: SessionRecoveryStatus;
  readonly working: boolean;
}) {
  const { t } = useI18n();
  const reconnect = useIdeReconnect(port, sessionId);
  useEffect(() => {
    port.postMessage({ type: 'ide.refresh', sessionId });
  }, [port, sessionId, blocked]);
  const ideBusy = ide.status === 'reconnecting' || reconnect.pending;
  const ideFailed = ide.status === 'disconnected' || ide.status === 'reconnect-required' || ide.status === 'error' ||
    ide.status === 'unavailable' && ide.canReconnect || reconnect.error !== null;
  let retry: { run: () => void; disabled: boolean } | null = null;
  if (recovery.failed || recovery.pending) {
    retry = { run: recovery.reconnect, disabled: !recovery.canReconnect };
  } else if (recovery.active && (recovery.timedOut || recovery.refresh.pending)) {
    retry = { run: recovery.refresh.refresh, disabled: recovery.refresh.pending };
  } else if (ideBusy) {
    retry = { run: reconnect.request, disabled: true };
  } else if (!recovery.active && connection.status === 'connected' && sessionId !== null && ideFailed) {
    retry = { run: reconnect.request, disabled: blocked || !ide.canReconnect };
  }
  const pending = recovery.pending || recovery.refresh.pending || ideBusy;
  const failed = recovery.failed || recovery.active && recovery.timedOut || !recovery.active && ideFailed;
  const connecting = pending || recovery.waiting || ide.status === 'preparing';
  const status = pending ? 'connecting' : failed ? 'unavailable' : connecting ? 'connecting' : 'connected';
  const label = status === 'connected' ? 'Online' : status === 'connecting' ? 'Connecting'
    : connection.status === 'connected' && !recovery.active ? 'IDE offline' : 'Offline';
  const detail = reconnect.error ?? (recovery.active ? connection.message : ide.message) ?? label;
  const actionLabel = pending ? 'Reconnecting…' : 'Reconnect';
  return <>
    <Tooltip content={t(detail)}><span role="status" aria-atomic="true" tabIndex={0} aria-label={`${t(label)}. ${t(detail)}`}
      className="ml-1.5 mr-auto inline-flex h-6 items-center">
      <span className="grid size-3 shrink-0 place-items-center"><DroidConnectionDot state={status} working={working} /></span>
    </span></Tooltip>
    {retry ? <Button variant="plain" size="icon-sm" className="chat-header-control mr-1 text-muted-foreground"
      aria-label={t(actionLabel)} title={t(retry.disabled ? detail : actionLabel)} aria-busy={pending} disabled={retry.disabled} onClick={retry.run}>
      <RefreshCw aria-hidden="true" className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} />
    </Button> : null}
  </>;
}

function useIdeReconnect(port: ChatPort, sessionId: string | null) {
  const waiting = useRef<{ sessionId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPending(false);
    setError(null);
    const unsubscribe = subscribeHostMessages((message) => {
      if (message.type !== 'host.ide' || message.sessionId !== sessionId) return;
      setError(null);
      if (!waiting.current) return;
      clearTimeout(waiting.current.timer);
      waiting.current = null;
      setPending(false);
    });
    return () => {
      unsubscribe();
      if (waiting.current) clearTimeout(waiting.current.timer);
      waiting.current = null;
    };
  }, [port, sessionId]);
  const request = () => {
    if (!sessionId || waiting.current) return;
    setPending(true);
    setError(null);
    const fail = () => {
      if (waiting.current) clearTimeout(waiting.current.timer);
      waiting.current = null;
      setPending(false);
      setError('Reconnect timed out. Try again.');
    };
    waiting.current = { sessionId, timer: setTimeout(fail, 8000) };
    try { port.postMessage({ type: 'ide.reconnect', sessionId }); }
    catch { fail(); }
  };
  return { pending, error, request };
}
