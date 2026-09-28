import { LoaderCircle, Monitor, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/overlays';

const labels: Record<IdeState['status'], string> = {
  preparing: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  unavailable: 'Unavailable',
  'reconnect-required': 'Reconnect required',
  reconnecting: 'Reconnecting',
  error: 'Connection failed',
};

export function IdeStatus({ ide, sessionId, blocked, port, initializing = false }: {
  readonly ide: IdeState;
  readonly sessionId: string | null;
  readonly blocked: boolean;
  readonly port: ChatPort;
  readonly initializing?: boolean;
}) {
  const reconnect = useIdeReconnect(port, sessionId);
  const preparing = initializing && sessionId === null && ide.status === 'disconnected';
  const status = preparing ? 'preparing' : ide.status;
  const label = reconnect.error ? 'No response' : labels[status];
  const message = preparing ? 'Restoring the chat before connecting its native IDE channel.' : ide.message;
  const busy = status === 'preparing' || status === 'reconnecting';
  const connected = status === 'connected';
  const failed = status === 'error' || reconnect.error !== null;
  const tone = failed ? 'text-destructive'
    : connected ? 'text-[var(--vscode-testing-iconPassed,var(--syntax-number))]'
    : status === 'reconnect-required' ? 'text-[var(--vscode-editorWarning-foreground,var(--muted-ink))]'
    : 'text-muted-foreground';
  const disabled = busy || reconnect.pending || blocked || !ide.canReconnect || sessionId === null;
  const actionHint = reconnect.pending ? 'Waiting for the extension to start reconnecting…'
    : busy ? 'Waiting for the IDE connection. No need to reconnect again.'
    : sessionId === null ? 'Open a chat to connect its IDE channel.'
    : blocked || !ide.canReconnect ? 'Reconnect is available when the chat is idle and no session operation is in progress.'
    : 'Reconnect IDE. Restarts the idle chat process and keeps its history.';
  const statusHint = reconnect.error ?? (connected
    ? 'Shares your current file, selection and diagnostics with this chat.' : message);
  const refresh = () => port.postMessage({ type: 'ide.refresh', sessionId });
  useEffect(() => {
    port.postMessage({ type: 'ide.refresh', sessionId });
  }, [port, sessionId, blocked]);
  return <div className="flex shrink-0 items-center">
    <Tooltip content={statusHint}>
      <span tabIndex={0} role="status" aria-atomic="true" aria-label={`IDE: ${label}`}
        onPointerEnter={refresh} onFocus={refresh}
        className={`dvx-control inline-flex h-7 cursor-default items-center gap-1.5 rounded-[var(--control-radius)] px-1.5 text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        <Monitor aria-hidden="true" className="size-3.5" />
        <span className="max-w-28 truncate">IDE · {label}</span>
        {busy ? <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin" />
          : <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full bg-current ${tone}`} />}
      </span>
    </Tooltip>
    {!connected && sessionId !== null && (status !== 'unavailable' || ide.canReconnect) ? <Tooltip content={actionHint}>
      <Button variant="ghost" size="icon-sm" className={disabled ? 'opacity-45 hover:bg-transparent hover:text-muted-foreground' : undefined}
        aria-label={status === 'error' ? 'Retry IDE connection' : 'Reconnect IDE'}
        aria-disabled={disabled} aria-busy={reconnect.pending || busy}
        onClick={() => { if (!disabled) reconnect.request(); }}>
        <RefreshCw aria-hidden="true" className={reconnect.pending && !busy ? 'motion-safe:animate-spin' : ''} />
      </Button>
    </Tooltip> : null}
  </div>;
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
      setError('No response to the reconnect request. Hover or focus the IDE status to refresh it before retrying.');
    };
    waiting.current = { sessionId, timer: setTimeout(fail, 8000) };
    try { port.postMessage({ type: 'ide.reconnect', sessionId }); }
    catch { fail(); }
  };
  return { pending, error, request };
}
