import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ConnectionState } from '../../shared/protocol/shell';
import type { ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { Button } from '../ui/button';
import type { SessionRecoveryStatus } from './ConnectionFeedback';

export function ChatConnectionStatus({ connection, ide, sessionId, blocked, port, recovery }: {
  readonly connection: ConnectionState;
  readonly ide: IdeState;
  readonly sessionId: string | null;
  readonly blocked: boolean;
  readonly port: ChatPort;
  readonly recovery: SessionRecoveryStatus;
}) {
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
  if (retry === null) return null;
  const pending = recovery.pending || recovery.refresh.pending || ideBusy;
  const label = pending ? 'Reconnecting…' : 'Reconnect';
  return <Button variant="plain" size="icon-sm" className="chat-header-control text-muted-foreground"
    aria-label={label} title={label} aria-busy={pending} disabled={retry.disabled} onClick={retry.run}>
    <RefreshCw aria-hidden="true" className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} />
  </Button>;
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
