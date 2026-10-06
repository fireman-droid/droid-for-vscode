import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ConnectionState } from '../../shared/protocol/shell';
import type { ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { Button } from '../ui/button';
import { DroidConnectionDot } from '../ui/droid-motion';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/overlays';
import type { SessionRecoveryStatus } from './ConnectionFeedback';

const labels: Record<IdeState['status'], string> = {
  preparing: 'Connecting',
  connected: 'Connected',
  idle: 'Sleeping',
  disconnected: 'Disconnected',
  unavailable: 'Unavailable',
  'reconnect-required': 'Reconnect required',
  reconnecting: 'Reconnecting',
  error: 'Connection failed',
};

export function ChatConnectionStatus({ connection, ide, sessionId, blocked, port, working, missionLabel, recovery }: {
  readonly connection: ConnectionState;
  readonly ide: IdeState;
  readonly sessionId: string | null;
  readonly blocked: boolean;
  readonly port: ChatPort;
  readonly working: boolean;
  readonly missionLabel?: string;
  readonly recovery: SessionRecoveryStatus;
}) {
  const reconnect = useIdeReconnect(port, sessionId);
  const initializing = connection.status === 'idle' || connection.status === 'connecting';
  const preparing = initializing && sessionId === null && ide.status === 'disconnected';
  const status = preparing ? 'preparing' : ide.status;
  const ideLabel = reconnect.error ? 'No response' : reconnect.pending ? 'Reconnecting' : labels[status];
  const message = preparing ? 'Restoring the chat before connecting its native IDE channel.' : ide.message;
  const busy = status === 'preparing' || status === 'reconnecting' || reconnect.pending;
  const connected = status === 'connected';
  const idle = status === 'idle';
  const failed = status === 'error' || reconnect.error !== null;
  const offline = connection.status === 'unavailable';
  const showReconnect = connection.status === 'connected' && !connected && !idle && sessionId !== null &&
    (status !== 'unavailable' || ide.canReconnect);
  const disabled = busy || blocked || !ide.canReconnect || sessionId === null;
  const label = recovery.active ? recovery.label : offline ? 'Offline' : initializing ? 'Connecting'
    : busy ? 'IDE connecting' : failed ? 'IDE error' : connected || idle ? 'Online' : `IDE ${labels[status].toLowerCase()}`;
  const dotState = offline ? 'unavailable' : initializing ? 'connecting'
    : busy ? 'connecting' : failed ? 'unavailable' : connected || idle ? 'connected' : 'idle';
  const actionHint = reconnect.pending ? 'Waiting for the extension to start reconnecting…'
    : busy ? 'Waiting for the IDE connection. No need to reconnect again.'
    : sessionId === null ? 'Open a chat to connect its IDE channel.'
    : blocked || !ide.canReconnect ? 'IDE reconnection is not available from this chat right now.'
    : 'Restore the IDE connection without resending your message.';
  const statusHint = reconnect.error ?? message;
  const summary = `Chat: ${connection.status}. IDE: ${ideLabel}.`;
  const refresh = () => port.postMessage({ type: 'ide.refresh', sessionId });
  useEffect(() => {
    port.postMessage({ type: 'ide.refresh', sessionId });
  }, [port, sessionId, blocked]);
  const retry = recovery.failed
    ? { label: recovery.pending ? 'Reconnecting…' : 'Reconnect Droid session', run: recovery.reconnect, disabled: !recovery.canReconnect }
    : recovery.active && recovery.timedOut
      ? { label: recovery.refresh.pending ? 'Waiting for session state…' : 'Refresh session state', run: recovery.refresh.refresh, disabled: recovery.refresh.pending }
      : showReconnect ? { label: busy ? 'Reconnecting…' : 'Reconnect IDE', run: reconnect.request, disabled } : null;
  const loading = recovery.waiting || busy;
  const error = (recovery.active ? recovery.failed || recovery.timedOut : failed) && !recovery.pending && !recovery.refresh.pending;
  const showReloadHelp = recovery.active && (recovery.refresh.outcome === 'timeout' || recovery.refresh.outcome === 'received' && recovery.failed || recovery.retryFailed) || reconnect.error !== null;
  return <Popover onOpenChange={(open) => { if (open) refresh(); }}>
    <div className="flex min-w-0 items-center">
      <span className="sr-only" role={error ? 'alert' : 'status'} aria-atomic="true">{label}. {summary}</span>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${label}. Connection details`} aria-busy={loading}
          className={`h-7 min-w-0 shrink px-1.5 ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
          <span className="grid size-3 shrink-0 place-items-center">{loading && !error
            ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
            : <DroidConnectionDot state={error ? 'unavailable' : dotState} working={working} />}</span>
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
    </div>
    <PopoverContent aria-label="Connection details" className="w-80 space-y-3 p-3 text-xs leading-relaxed [overflow-wrap:anywhere]" align="start" sideOffset={6}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Connection</h2>
        <PopoverClose asChild><Button variant="ghost" size="icon-sm" className="size-6" aria-label="Close connection details"><X aria-hidden="true" className="size-3.5" /></Button></PopoverClose>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Droid session</dt><dd className="text-right text-popover-foreground">{recovery.active ? recovery.label : connection.status === 'connected' ? 'Connected' : connection.status}</dd>
        <dt>IDE</dt><dd className="text-right text-popover-foreground">{ideLabel}</dd>
      </dl>
      {connection.message ? <p className="text-muted-foreground">{connection.message}</p> : null}
      {statusHint ? <p className="text-muted-foreground">{statusHint}</p> : null}
      {missionLabel ? <p className="text-muted-foreground">{missionLabel}</p> : null}
      {retry ? <Button variant="outline" size="sm" title={showReconnect ? actionHint : undefined} disabled={retry.disabled} onClick={retry.run}>
        <RefreshCw aria-hidden="true" className={recovery.refresh.pending || recovery.pending || busy ? 'animate-spin motion-reduce:animate-none' : undefined} />
        {retry.label}
      </Button> : null}
      {recovery.active && recovery.refresh.outcome === 'timeout' ? <p role="status" className="text-muted-foreground">The extension has not returned session state after 10 seconds.</p> : null}
      {showReloadHelp ? <p className="border-t border-border pt-3 text-muted-foreground">Still unable to connect? Use the editor’s Reload Window command. Copy unsent edits and reattach files after reloading.</p> : null}
    </PopoverContent>
  </Popover>;
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
      setError('No response to the reconnect request. Open the connection details to refresh the IDE status before retrying.');
    };
    waiting.current = { sessionId, timer: setTimeout(fail, 8000) };
    try { port.postMessage({ type: 'ide.reconnect', sessionId }); }
    catch { fail(); }
  };
  return { pending, error, request };
}
