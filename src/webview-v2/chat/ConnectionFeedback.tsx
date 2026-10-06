import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Unplug } from 'lucide-react';
import type { AssistantWebviewState } from '../state/types';
import { subscribeHostMessages } from '../host/hostMessageSource';
import { announceReady } from '../bridge/vscode';
import type { ChatPort } from '../host/chatIntent';
import { ChatConnectionStatus } from './ChatConnectionStatus';

function useLongWait(waiting: boolean, delay: number) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    setElapsed(false);
    if (!waiting) return;
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [waiting, delay]);
  return waiting && elapsed;
}

function useRefreshSessionState(port: ChatPort, sequence: number, conversationId: string | null, sessionId: string | null) {
  const request = useRef<{ readonly sequence: number; readonly timer: ReturnType<typeof setTimeout> } | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<'received' | 'timeout' | null>(null);
  useEffect(() => {
    setPending(false);
    setOutcome(null);
    const unsubscribe = subscribeHostMessages((message) => {
      if (request.current === null || message.type !== 'host.snapshot' || message.sequence <= request.current.sequence) return;
      if (conversationId !== null && message.conversationId !== conversationId) return;
      if (sessionId !== null && message.sessionId !== sessionId) return;
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
  const refresh = () => {
    if (request.current !== null) return;
    setPending(true);
    setOutcome(null);
    request.current = { sequence, timer: setTimeout(() => {
      request.current = null;
      setPending(false);
      setOutcome('timeout');
    }, 10_000) };
    announceReady(port);
  };
  return { pending, outcome, refresh };
}

export interface SessionRecoveryStatus {
  readonly active: boolean;
  readonly failed: boolean;
  readonly timedOut: boolean;
  readonly waiting: boolean;
  readonly label: string;
  readonly canReconnect: boolean;
  readonly reconnect: () => void;
  readonly pending: boolean;
  readonly retryFailed: boolean;
  readonly refresh: ReturnType<typeof useRefreshSessionState>;
}

/** Recovery requests live with the header, so closing its popover cannot reset a pending request. */
export function SessionRecovery({ state, blocked, ideBlocked = blocked, onReconnect, port, phase = 'idle', handshakeTimedOut = false, working = false, missionLabel }: {
  readonly state: Pick<AssistantWebviewState, 'sequence' | 'connection' | 'conversationId' | 'sessionId' | 'turn' | 'sessions' | 'ide'>;
  readonly blocked: boolean;
  readonly ideBlocked?: boolean;
  readonly onReconnect: () => void;
  readonly port: ChatPort;
  readonly phase?: string;
  readonly handshakeTimedOut?: boolean;
  readonly working?: boolean;
  readonly missionLabel?: string;
}) {
  const pendingAfter = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const refresh = useRefreshSessionState(port, state.sequence, state.conversationId, state.sessionId);
  useEffect(() => {
    pendingAfter.current = null;
    setPending(false);
    setAttempted(false);
    return subscribeHostMessages((message) => {
      if (pendingAfter.current === null || (message.type !== 'host.snapshot' && message.type !== 'host.connection') || message.sequence <= pendingAfter.current) return;
      if (message.type === 'host.snapshot' && (message.sessions.status === 'loading' ||
        state.sessionId !== null && message.sessionId !== state.sessionId)) return;
      if (message.connection.status === 'connected' || message.connection.status === 'unavailable') {
        pendingAfter.current = null;
        setPending(false);
      }
    });
  }, [state.conversationId, state.sessionId]);
  const failed = state.connection.status === 'unavailable';
  const transitioning = phase !== 'idle' && phase !== 'leaving';
  const waiting = pending || refresh.pending || state.connection.status === 'idle' || state.connection.status === 'connecting' || transitioning;
  const longWait = useLongWait(waiting, 60_000);
  const timedOut = handshakeTimedOut || longWait || refresh.outcome === 'timeout';
  const running = working || state.turn?.status === 'submitting' || state.turn?.status === 'streaming' || state.turn?.status === 'stopping';
  const canReconnect = failed && !blocked && !pending && !refresh.pending && !running && state.sessions.status !== 'loading';
  const recovery: SessionRecoveryStatus = {
    active: failed || waiting || handshakeTimedOut,
    failed, timedOut, waiting, pending, refresh, canReconnect,
    retryFailed: attempted && failed && !pending,
    label: refresh.pending ? 'Refreshing status…' : pending ? 'Reconnecting…'
      : failed ? 'Connection failed' : timedOut ? 'Connection timed out'
      : phase === 'switching' ? 'Switching conversation…' : phase === 'restoring' ? 'Restoring session…' : 'Connecting…',
    reconnect: () => {
      if (!canReconnect || pendingAfter.current !== null) return;
      pendingAfter.current = state.sequence;
      setPending(true);
      setAttempted(true);
      onReconnect();
    },
  };
  return <ChatConnectionStatus connection={state.connection} ide={state.ide} sessionId={state.sessionId}
    blocked={ideBlocked} port={port} working={working} missionLabel={missionLabel} recovery={recovery} />;
}

export function ConversationWait({ phase, hasSnapshot, handshakeTimedOut, connection }: {
  readonly phase: string;
  readonly hasSnapshot: boolean;
  readonly handshakeTimedOut: boolean;
  readonly connection: AssistantWebviewState['connection'];
}) {
  const failed = connection.status === 'unavailable';
  const label = failed ? 'Unable to connect. Open the connection status above.'
    : handshakeTimedOut ? 'Still waiting. Open the connection status above to retry.'
    : phase === 'switching' ? 'Switching conversation…'
    : !hasSnapshot ? 'Restoring session…' : 'Connecting to Droid…';
  return <div className="pointer-events-none absolute inset-0 z-20 grid place-content-center bg-background p-6">
    <p role={failed ? 'alert' : 'status'} className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
      {failed ? <Unplug aria-hidden="true" className="size-3.5 shrink-0" />
        : <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
      <span>{label}</span>
    </p>
  </div>;
}
