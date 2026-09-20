import { useEffect, useRef, useState } from 'react';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import { subscribeHostMessages } from '../../webview/assistant/shell/hostMessageSource';
import { announceReady } from '../../webview/bridge/vscode';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';

function useLongWait(waiting: boolean) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (!waiting) return;
    const timer = setTimeout(() => setElapsed(true), 5_000);
    return () => clearTimeout(timer);
  }, [waiting]);
  return waiting && elapsed;
}

function RefreshSessionState({ port, sequence }: { readonly port: ChatPort; readonly sequence: number }) {
  const requestedAfter = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [received, setReceived] = useState(false);
  useEffect(() => subscribeHostMessages((message) => {
    if (requestedAfter.current === null || message.type !== 'host.snapshot' || message.sequence <= requestedAfter.current) return;
    requestedAfter.current = null;
    setPending(false);
    setReceived(true);
  }), []);
  return <div className="space-y-1 text-xs text-muted-foreground">
    <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" disabled={pending} onClick={() => {
      if (requestedAfter.current !== null) return;
      requestedAfter.current = sequence;
      setPending(true);
      setReceived(false);
      announceReady(port);
    }}>{pending ? 'Waiting for session state…' : 'Refresh session state'}</Button>
    {received ? <p role="status">Latest host state received.</p> : null}
    <p>Requests the current state without reloading this view, restarting a session, or resending a message.</p>
    <p>If it remains unresponsive, use the editor’s Reload Window command. Copy any unsent edits and reattach files after reloading.</p>
  </div>;
}

export function ConversationWait({ phase, hasSnapshot, handshakeTimedOut, connection, port, sequence }: {
  readonly phase: string;
  readonly hasSnapshot: boolean;
  readonly handshakeTimedOut: boolean;
  readonly connection: AssistantWebviewState['connection'];
  readonly port: ChatPort;
  readonly sequence: number;
}) {
  const waiting = phase !== 'leaving';
  const longWait = useLongWait(waiting);
  const label = handshakeTimedOut ? 'Still waiting for the extension…'
    : phase === 'switching' ? 'Switching conversation…'
    : connection.status === 'unavailable' ? 'Droid is unavailable'
    : connection.status === 'connecting' ? 'Connecting to the local runtime…'
    : !hasSnapshot ? 'Waiting for the session state…' : 'Opening conversation…';
  return <div className="absolute inset-x-0 bottom-0 top-10 z-20 grid place-content-center bg-background/95 p-4 text-center">
    <div className="mx-auto max-w-sm space-y-3 text-xs">
      <div role={connection.status === 'unavailable' ? 'alert' : 'status'} className="flex items-center justify-center gap-2">
        {waiting && !handshakeTimedOut && connection.status !== 'unavailable' ? <DroidActivity phase="loading" /> : null}<span>{label}</span>
      </div>
      {connection.message ? <p className="text-muted-foreground">{connection.message}</p> : null}
      {longWait || handshakeTimedOut ? <RefreshSessionState port={port} sequence={sequence} /> : null}
    </div>
  </div>;
}

export function SessionRecovery({ state, blocked, onReconnect, port }: {
  readonly state: Pick<AssistantWebviewState, 'sequence' | 'connection' | 'sessionId' | 'turn' | 'sessions' | 'ide'>;
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
  const failed = state.connection.status === 'unavailable' || state.turn?.status === 'failed';
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
      <p>Opens or resumes a local session. Your previous message is not resent.</p>
    </> : null}
    {longWait ? <RefreshSessionState port={port} sequence={state.sequence} /> : null}
  </div>;
}
