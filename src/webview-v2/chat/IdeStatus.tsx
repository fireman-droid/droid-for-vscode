import { Monitor, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';

const labels: Record<IdeState['status'], string> = {
  preparing: 'Preparing',
  'prepared-unconfirmed': 'Prepared · unconfirmed',
  unavailable: 'Unavailable',
  'reconnect-required': 'Reconnect required',
  reconnecting: 'Reconnecting',
  error: 'Reconnect failed',
};

export function IdeStatus({ ide, sessionId, blocked, port }: {
  readonly ide: IdeState;
  readonly sessionId: string | null;
  readonly blocked: boolean;
  readonly port: ChatPort;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    port.postMessage({ type: 'ide.refresh', sessionId });
  }, [port, sessionId, blocked]);
  return <Popover open={open} onOpenChange={(next) => {
    setOpen(next);
    if (next) port.postMessage({ type: 'ide.refresh', sessionId });
  }}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"
        aria-label={`IDE: ${labels[ide.status]}`} title={`IDE: ${labels[ide.status]}`}>
        <Monitor className="size-3.5" /><span>IDE</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 space-y-3 p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium">Native IDE · {labels[ide.status]}</p>
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">{ide.message}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Reconnect closes the idle session process and restores the same conversation.
        Running tasks are kept on their original daemon.
      </p>
      <Button variant="outline" size="sm" className="w-full"
        disabled={blocked || !ide.canReconnect || sessionId === null}
        onClick={() => { if (sessionId) port.postMessage({ type: 'ide.reconnect', sessionId }); }}>
        <RefreshCw className="size-3.5" />Reconnect IDE
      </Button>
    </PopoverContent>
  </Popover>;
}
