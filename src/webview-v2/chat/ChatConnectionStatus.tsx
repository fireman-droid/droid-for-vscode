import { useEffect, useRef, useState } from 'react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ConnectionState } from '../../shared/protocol/shell';
import type { ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { Button } from '../ui/button';
import { DroidConnectionDot } from '../ui/droid-motion';
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

export function ChatConnectionStatus({ connection, ide, sessionId, blocked, port, working, missionLabel }: {
  readonly connection: ConnectionState;
  readonly ide: IdeState;
  readonly sessionId: string | null;
  readonly blocked: boolean;
  readonly port: ChatPort;
  readonly working: boolean;
  readonly missionLabel?: string;
}) {
  const reconnect = useIdeReconnect(port, sessionId);
  const initializing = connection.status === 'idle' || connection.status === 'connecting';
  const preparing = initializing && sessionId === null && ide.status === 'disconnected';
  const status = preparing ? 'preparing' : ide.status;
  const ideLabel = reconnect.error ? 'No response' : reconnect.pending ? 'Reconnecting' : labels[status];
  const message = preparing ? 'Restoring the chat before connecting its native IDE channel.' : ide.message;
  const busy = status === 'preparing' || status === 'reconnecting' || reconnect.pending;
  const connected = status === 'connected';
  const failed = status === 'error' || reconnect.error !== null;
  const offline = connection.status === 'unavailable';
  const showReconnect = connection.status === 'connected' && !connected && sessionId !== null &&
    (status !== 'unavailable' || ide.canReconnect);
  const disabled = busy || blocked || !ide.canReconnect || sessionId === null;
  const label = offline ? 'Offline' : initializing ? 'Connecting'
    : busy ? 'IDE connecting' : failed ? 'IDE error' : connected ? 'Online'
    : showReconnect && !disabled ? 'Reconnect IDE' : `IDE ${labels[status].toLowerCase()}`;
  const dotState = offline ? 'unavailable' : initializing ? 'connecting'
    : busy ? 'connecting' : failed ? 'unavailable' : connected ? 'connected' : 'idle';
  const actionHint = reconnect.pending ? 'Waiting for the extension to start reconnecting…'
    : busy ? 'Waiting for the IDE connection. No need to reconnect again.'
    : sessionId === null ? 'Open a chat to connect its IDE channel.'
    : blocked || !ide.canReconnect ? 'IDE reconnection is not available from this chat right now.'
    : 'Reconnect IDE. Restarts the idle chat process and keeps its history.';
  const statusHint = reconnect.error ?? message;
  const summary = `Chat: ${connection.status}. IDE: ${ideLabel}.`;
  const hint = [summary, connection.message, statusHint, missionLabel,
    offline ? 'Use Reconnect Droid session below to restore the chat.'
      : showReconnect ? actionHint : 'Select to refresh the IDE status.'].filter(Boolean).join(' ');
  const refresh = () => port.postMessage({ type: 'ide.refresh', sessionId });
  useEffect(() => {
    port.postMessage({ type: 'ide.refresh', sessionId });
  }, [port, sessionId, blocked]);
  return <div className="flex min-w-0 items-center">
    <span className="sr-only" role={offline ? 'alert' : 'status'} aria-atomic="true">{summary}</span>
    <Tooltip content={hint}>
      <Button variant="ghost" size="sm"
        aria-label={`${label}. ${summary}${showReconnect ? ` ${actionHint}` : ''}`}
        aria-disabled={showReconnect && disabled} aria-busy={initializing || busy}
        onPointerEnter={refresh} onFocus={refresh}
        className={`h-7 min-w-0 shrink px-1.5 ${offline || (!initializing && !busy && failed) ? 'text-destructive' : ''} ${showReconnect && disabled ? 'cursor-default hover:bg-transparent' : ''}`}
        onClick={() => { if (showReconnect) { if (!disabled) reconnect.request(); } else refresh(); }}>
        <span className="grid size-3 shrink-0 place-items-center"><DroidConnectionDot state={dotState} working={working} /></span>
        <span className="truncate">{label}</span>
      </Button>
    </Tooltip>
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
      setError('No response to the reconnect request. Hover or focus the connection status to refresh it before retrying.');
    };
    waiting.current = { sessionId, timer: setTimeout(fail, 8000) };
    try { port.postMessage({ type: 'ide.reconnect', sessionId }); }
    catch { fail(); }
  };
  return { pending, error, request };
}
