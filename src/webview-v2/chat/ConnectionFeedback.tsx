import { useEffect, useRef, useState } from 'react';
import type { AssistantWebviewState } from '../state/types';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { announceReady } from '../bridge/vscode';
import type { ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';

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

function RefreshSessionState({ port, sequence, conversationId, sessionId }: {
  readonly port: ChatPort;
  readonly sequence: number;
  readonly conversationId?: string | null;
  readonly sessionId?: string | null;
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
  return <div className="space-y-1 text-xs text-muted-foreground">
    <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" disabled={pending} onClick={() => {
      if (request.current !== null) return;
      setPending(true);
      setOutcome(null);
      request.current = { sequence, timer: setTimeout(() => {
        request.current = null;
        setPending(false);
        setOutcome('timeout');
      }, 10_000) };
      announceReady(port);
    }}>{pending ? 'Waiting for session state…' : 'Refresh session state'}</Button>
    {outcome === 'received' ? <p role="status">Latest host state received.</p> : null}
    {outcome === 'timeout' ? <p role="status">No session state received after 10 seconds. You can refresh again.</p> : null}
    <p>Requests the current state without reloading this view, restarting a session, or resending a message.</p>
    <p>If it remains unresponsive, use the editor’s Reload Window command. Copy any unsent edits and reattach files after reloading.</p>
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
  return <div className="absolute inset-x-0 bottom-0 top-10 z-20 grid place-content-center bg-background/95 p-4 text-center">
    <div className="mx-auto max-w-sm space-y-3 text-xs">
      <div role={connection.status === 'unavailable' ? 'alert' : 'status'} className="flex items-center justify-center gap-2">
        {waiting && connection.status !== 'unavailable' ? <DroidActivity phase="loading" /> : null}<span>{label}</span>
      </div>
      {connection.message ? <p className="text-muted-foreground">{connection.message}</p> : null}
      {longWait && phase === 'restoring' && connection.status !== 'unavailable'
        ? <p className="text-muted-foreground">Restoring your session. State refreshes automatically.</p> : null}
      {recoveryNeeded || connection.status === 'unavailable' ? <RefreshSessionState port={port} sequence={sequence} conversationId={conversationId} sessionId={sessionId} /> : null}
    </div>
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
  return <div className="space-y-1 text-xs text-muted-foreground">
    {pending || connecting || reconnectingIde ? <p role="status" className="flex items-center gap-2"><DroidActivity phase="loading" />{reconnectingIde ? state.ide.message : 'Waiting for the Droid session…'}</p> : null}
    {failed && !reconnectingIde ? <>
      <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" disabled={pending || connecting || working || loadingCatalog} onClick={() => {
        if (pendingAfter.current !== null || connecting || working || loadingCatalog) return;
        pendingAfter.current = state.sequence;
        setPending(true);
        onReconnect();
      }}>Reconnect Droid session</Button>
      <p>Opens or resumes your Droid session. Your previous message is not resent.</p>
    </> : null}
    {longWait ? <RefreshSessionState port={port} sequence={state.sequence} conversationId={state.conversationId} sessionId={state.sessionId} /> : null}
  </div>;
}
