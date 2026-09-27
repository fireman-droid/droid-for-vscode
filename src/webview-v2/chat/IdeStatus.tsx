import { Check, CircleAlert, LoaderCircle, Monitor, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ChatPort } from '../host/chatIntent';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';

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
  const titleId = useId();
  const messageId = useId();
  const actionHintId = useId();
  const [open, setOpen] = useState(false);
  const reconnect = useIdeReconnect(port, sessionId);
  const preparing = initializing && sessionId === null && ide.status === 'disconnected';
  const status = preparing ? 'preparing' : ide.status;
  const label = labels[status];
  const message = preparing ? 'Restoring the chat before connecting its native IDE channel.' : ide.message;
  const busy = status === 'preparing' || status === 'reconnecting';
  const connected = status === 'connected';
  const tone = connected ? 'text-[var(--vscode-testing-iconPassed,var(--syntax-number))]'
    : status === 'error' ? 'text-destructive'
    : status === 'reconnect-required' ? 'text-[var(--vscode-editorWarning-foreground,var(--muted-ink))]'
    : 'text-muted-foreground';
  const StatusIcon = busy ? LoaderCircle : connected ? Check
    : status === 'error' || status === 'reconnect-required' ? CircleAlert : Unplug;
  const disabled = busy || reconnect.pending || blocked || !ide.canReconnect || sessionId === null;
  const actionHint = reconnect.error ? reconnect.error
    : reconnect.pending ? 'Waiting for the extension to start reconnecting…'
    : busy ? 'Waiting for the IDE connection. No need to reconnect again.'
    : sessionId === null ? 'Open a chat to connect its IDE channel.'
    : blocked || !ide.canReconnect ? 'Reconnect is available when the chat is idle and no session operation is in progress.'
    : connected ? 'Context not updating? Reconnect this chat’s IDE channel.'
    : 'Reconnect to restore this chat’s IDE context.';
  useEffect(() => {
    port.postMessage({ type: 'ide.refresh', sessionId });
  }, [port, sessionId, blocked]);
  return <Popover open={open} onOpenChange={(next) => {
    setOpen(next);
    if (next) port.postMessage({ type: 'ide.refresh', sessionId });
  }}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-1.5 text-xs data-[state=open]:bg-accent data-[state=open]:text-foreground"
        aria-label={`IDE: ${label}`} title={`IDE: ${label}`}>
        <Monitor aria-hidden="true" className="size-3.5" />
        <span className="max-w-28 truncate">IDE · {label}</span>
        {busy ? <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin" />
          : <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full bg-current ${tone}`} />}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className="w-72 rounded-xl p-0"
      aria-labelledby={titleId} aria-describedby={messageId}>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-muted/50">
          <Monitor className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-[13px] font-semibold text-foreground">IDE connection</h2>
          <p role="status" className={`flex items-center gap-1.5 text-[11px] font-medium ${tone}`}>
            <StatusIcon aria-hidden="true" className={`size-3 ${busy ? 'motion-safe:animate-spin' : ''}`} />{label}
          </p>
        </div>
      </div>
      <div className="px-4 pb-3">
        <p id={messageId} className="select-text break-words text-xs leading-relaxed text-muted-foreground">
          {connected ? 'Shares your current file, selection and diagnostics with this chat.' : message}
        </p>
      </div>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <p id={actionHintId} role="status"
          className={`text-[11px] leading-relaxed ${reconnect.error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {actionHint}
        </p>
        <Button variant={connected ? 'outline' : 'secondary'} size="sm" className="h-8 w-full"
          disabled={disabled} aria-describedby={actionHintId} aria-busy={reconnect.pending || status === 'reconnecting'}
          onClick={() => { if (!disabled) reconnect.request(); }}>
          <RefreshCw aria-hidden="true" className={busy || reconnect.pending ? 'motion-safe:animate-spin' : ''} />
          {status === 'reconnecting' ? 'Reconnecting…' : reconnect.pending ? 'Requesting reconnect…'
            : busy ? 'Connecting…' : status === 'error' ? 'Retry connection' : 'Reconnect IDE'}
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Restarts the idle chat process, keeping its history. Running tasks stay on their existing backend.
        </p>
      </div>
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
      setError('No confirmation received. Close and reopen this panel to check the latest status before retrying.');
    };
    waiting.current = { sessionId, timer: setTimeout(fail, 8000) };
    try { port.postMessage({ type: 'ide.reconnect', sessionId }); }
    catch { fail(); }
  };
  return { pending, error, request };
}
