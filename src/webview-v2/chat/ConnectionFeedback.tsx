import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Clock3, RefreshCw, Unplug } from 'lucide-react';
import type { AssistantWebviewState } from '../state/types';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { announceReady } from '../bridge/vscode';
import type { ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

function RecoveryHelp() {
  return <Collapsible className="border-t border-[var(--panel-edge)] pt-2">
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="group -ml-1.5 h-auto whitespace-normal px-1.5 py-1 text-left">
        <ChevronRight aria-hidden="true" className="transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
        Still unresponsive?
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-2 pt-2 text-xs leading-relaxed text-muted-foreground">
      <p>Fetches the latest state without restarting your session or resending a message.</p>
      <p>Use the editor’s Reload Window command. Copy any unsent edits and reattach files after reloading.</p>
    </CollapsibleContent>
  </Collapsible>;
}

function useLongWait(waiting: boolean, delay = 5_000) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (!waiting) return;
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [waiting, delay]);
  return waiting && elapsed;
}

function RefreshSessionState({ port, sequence, conversationId, sessionId, primary = false }: {
  readonly port: ChatPort;
  readonly sequence: number;
  readonly conversationId?: string | null;
  readonly sessionId?: string | null;
  readonly primary?: boolean;
}) {
  const request = useRef<{ readonly sequence: number; readonly timer: ReturnType<typeof setTimeout> } | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<'received' | 'timeout' | null>(null);
  useEffect(() => {
    setPending(false);
    setOutcome(null);
    const unsubscribe = subscribeHostMessages((message) => {
      if (request.current === null || message.type !== 'host.snapshot' || message.sequence <= request.current.sequence) return;
      if (conversationId != null && message.conversationId !== conversationId) return;
      if (sessionId != null && message.sessionId !== sessionId) return;
      clearTimeout(request.current.timer);
      request.current = null;
      setPending(false);
      setOutcome('received');
    });
    return () => {
      unsubscribe();
      if (request.current !== null) clearTimeout(request.current.timer);
      request.current = null;
    };
  }, [port, conversationId, sessionId]);
  return <div className="space-y-3 text-xs text-muted-foreground">
    <Button variant={primary ? 'default' : 'outline'} size="sm" className="h-auto min-h-8 max-w-full whitespace-normal px-3 py-1.5 text-left" disabled={pending} onClick={() => {
      if (request.current !== null) return;
      setPending(true);
      setOutcome(null);
      request.current = { sequence, timer: setTimeout(() => {
        request.current = null;
        setPending(false);
        setOutcome('timeout');
      }, 10_000) };
      announceReady(port);
    }}><RefreshCw aria-hidden="true" className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} />{pending ? 'Waiting for session state…' : 'Refresh session state'}</Button>
    {outcome === 'received' ? <p role="status" className="flex items-start gap-2"><Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>Latest host state received.</span></p> : null}
    {outcome === 'timeout' ? <p role="status" className="flex items-start gap-2"><Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>No session state received after 10 seconds. You can refresh again.</span></p> : null}
    <RecoveryHelp />
  </div>;
}

export function ConversationWait({ phase, hasSnapshot, handshakeTimedOut, connection, port, sequence, conversationId, sessionId }: {
  readonly phase: string;
  readonly hasSnapshot: boolean;
  readonly handshakeTimedOut: boolean;
  readonly connection: AssistantWebviewState['connection'];
  readonly port: ChatPort;
  readonly sequence: number;
  readonly conversationId?: string | null;
  readonly sessionId?: string | null;
}) {
  const waiting = phase !== 'leaving';
  const longWait = useLongWait(waiting);
  const recoveryNeeded = useLongWait(waiting, 60_000);
  const label = handshakeTimedOut ? 'Still waiting for the extension…'
    : phase === 'switching' ? 'Switching conversation…'
    : connection.status === 'unavailable' ? 'Droid is unavailable'
    : connection.status === 'connecting' ? 'Connecting to Droid…'
    : !hasSnapshot ? 'Waiting for the session state…' : 'Opening conversation…';
  const detail = connection.message ?? (handshakeTimedOut
    ? 'The extension has not sent this session’s state yet.'
    : longWait && phase === 'restoring' && connection.status !== 'unavailable'
      ? 'Restoring your session. State refreshes automatically.' : null);
  return <div className="absolute inset-x-0 bottom-0 top-10 z-20 grid place-content-center bg-background/95 p-4 text-center">
    <section aria-label="Session recovery" className="mx-auto w-full max-w-sm space-y-4 rounded-xl border border-[var(--panel-edge)] bg-background p-4 text-left text-xs leading-relaxed [overflow-wrap:anywhere]">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          {waiting && connection.status !== 'unavailable' ? <DroidActivity phase="loading" /> : <Unplug aria-hidden="true" className="size-4" />}
        </span>
        <div className="min-w-0 space-y-1">
          <h2 role={connection.status === 'unavailable' ? 'alert' : 'status'} className="text-sm font-semibold leading-snug text-foreground">{label}</h2>
          {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
      {recoveryNeeded || connection.status === 'unavailable' ? <RefreshSessionState primary port={port} sequence={sequence} conversationId={conversationId} sessionId={sessionId} /> : null}
    </section>
  </div>;
}

export function SessionRecovery({ state, blocked, onReconnect, port }: {
  readonly state: Pick<AssistantWebviewState, 'sequence' | 'connection' | 'conversationId' | 'sessionId' | 'turn' | 'sessions' | 'ide'>;
  readonly blocked: boolean;
  readonly onReconnect: () => void;
  readonly port: ChatPort;
}) {
  const pendingAfter = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => subscribeHostMessages((message) => {
    if (pendingAfter.current === null || (message.type !== 'host.snapshot' && message.type !== 'host.connection') || message.sequence <= pendingAfter.current) return;
    if (message.type === 'host.snapshot' && message.sessions.status === 'loading') return;
    if (message.connection.status === 'connected' || message.connection.status === 'unavailable') {
      pendingAfter.current = null;
      setPending(false);
    }
  }), []);
  const connecting = state.connection.status === 'connecting';
  const reconnectingIde = state.ide.status === 'reconnecting';
  const loadingCatalog = state.sessions.status === 'loading';
  const longWait = useLongWait(pending || connecting || reconnectingIde, reconnectingIde ? 60_000 : 5_000);
  const failed = state.connection.status === 'unavailable';
  const working = state.turn?.status === 'submitting' || state.turn?.status === 'streaming' || state.turn?.status === 'stopping';
  if (blocked || (!failed && !pending && !connecting && !reconnectingIde)) return null;
  return <section aria-label="Session recovery" className="mb-2 min-w-0 space-y-2 rounded-xl border border-[var(--panel-edge)] bg-background px-3 py-2.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
    {pending || connecting || reconnectingIde
      ? <p role="status" className="flex items-start gap-2 font-medium text-foreground"><span className="mt-0.5 shrink-0"><DroidActivity phase="loading" /></span><span>{reconnectingIde ? state.ide.message ?? 'Reconnecting to the IDE…' : 'Waiting for the Droid session…'}</span></p>
      : <p className="flex items-center gap-2 font-medium text-foreground"><Unplug aria-hidden="true" className="size-3.5 shrink-0" />Session disconnected</p>}
    {failed && !reconnectingIde ? <>
      <Button variant="outline" size="sm" className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left" disabled={pending || connecting || working || loadingCatalog} onClick={() => {
        if (pendingAfter.current !== null || connecting || working || loadingCatalog) return;
        pendingAfter.current = state.sequence;
        setPending(true);
        onReconnect();
      }}><RefreshCw aria-hidden="true" />Reconnect Droid session</Button>
      <p>Opens or resumes your Droid session. Your previous message is not resent.</p>
    </> : null}
    {longWait ? <RefreshSessionState port={port} sequence={state.sequence} conversationId={state.conversationId} sessionId={state.sessionId} /> : null}
  </section>;
}
