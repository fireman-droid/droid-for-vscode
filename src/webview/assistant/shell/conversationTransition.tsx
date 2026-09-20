import { useCallback, useEffect, useRef, useState } from 'react';

import { type StoreHostMessage } from '../state/types';

const BOOT_DELAY_MS = 120;
const LEAVE_DELAY_MS = 150;

type TransitionPhase = 'boot-pending' | 'restoring' | 'switching' | 'leaving' | 'idle';

interface TransitionState {
  readonly sequence: number;
  readonly getSequence?: () => number;
  readonly sessionId: string | null;
  readonly connectionStatus: 'idle' | 'connecting' | 'connected' | 'unavailable';
}

interface PendingSwitch {
  readonly sequence: number;
  readonly targetSessionId: string;
  readonly snapshotSequence: number | null;
}

const SELECT_FAILURE_CODES = [
  'session-selection-invalid',
  'session-operation-blocked',
  'session-resume-failed',
  'session-close-failed',
] as const;

export function useConversationTransition({
  sequence,
  getSequence,
  sessionId,
  connectionStatus,
}: TransitionState): {
  readonly beginSwitch: (targetSessionId: string) => void;
  readonly observeHostMessage: (message: StoreHostMessage) => void;
  readonly phase: TransitionPhase;
  readonly hasSnapshot: boolean;
  readonly blocking: boolean;
  readonly overlay: React.JSX.Element | null;
} {
  const [phase, setPhase] = useState<TransitionPhase>('boot-pending');
  const [firstSnapshotSequence, setFirstSnapshotSequence] = useState<number | null>(null);
  const phaseRef = useRef(phase);
  const bootReadyRef = useRef(false);
  const pendingSwitchRef = useRef<PendingSwitch | null>(null);

  const transitionTo = useCallback((next: TransitionPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const finish = useCallback((): void => {
    pendingSwitchRef.current = null;
    transitionTo('leaving');
  }, [transitionTo]);

  useEffect(() => {
    bootReadyRef.current =
      firstSnapshotSequence !== null &&
      sequence >= firstSnapshotSequence &&
      connectionStatus === 'connected' &&
      sessionId !== null;
  }, [connectionStatus, firstSnapshotSequence, sequence, sessionId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!bootReadyRef.current && phaseRef.current === 'boot-pending') {
        transitionTo('restoring');
      }
    }, BOOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [transitionTo]);

  useEffect(() => {
    const firstSnapshotCommitted =
      firstSnapshotSequence !== null && sequence >= firstSnapshotSequence;
    if (!firstSnapshotCommitted) {
      return;
    }
    if (connectionStatus === 'unavailable') {
      if (phaseRef.current === 'boot-pending') {
        transitionTo('idle');
      } else if (phaseRef.current === 'restoring') {
        finish();
      }
      return;
    }
    if (connectionStatus === 'connected' && sessionId !== null) {
      if (phaseRef.current === 'boot-pending') {
        transitionTo('idle');
      } else if (phaseRef.current === 'restoring') {
        finish();
      }
    }
  }, [
    connectionStatus,
    finish,
    firstSnapshotSequence,
    sequence,
    sessionId,
    transitionTo,
  ]);

  useEffect(() => {
    const pending = pendingSwitchRef.current;
    if (pending === null || phase !== 'switching') {
      return;
    }
    if (connectionStatus === 'unavailable') {
      finish();
      return;
    }
    if (
      pending.snapshotSequence !== null &&
      sequence >= pending.snapshotSequence &&
      connectionStatus === 'connected' &&
      sessionId === pending.targetSessionId
    ) {
      finish();
    }
  }, [connectionStatus, finish, phase, sequence, sessionId]);

  useEffect(() => {
    if (phase !== 'leaving') {
      return undefined;
    }
    const timer = setTimeout(() => transitionTo('idle'), LEAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, transitionTo]);

  const beginSwitch = useCallback(
    (targetSessionId: string): void => {
      if (phaseRef.current !== 'idle') {
        return;
      }
      pendingSwitchRef.current = {
        sequence: getSequence?.() ?? sequence,
        targetSessionId,
        snapshotSequence: null,
      };
      transitionTo('switching');
    },
    [getSequence, sequence, transitionTo],
  );

  const observeHostMessage = useCallback(
    (message: StoreHostMessage): void => {
      if (message.type === 'host.snapshot') {
        setFirstSnapshotSequence((current) => current ?? message.sequence);
        const pending = pendingSwitchRef.current;
        if (
          pending !== null &&
          message.sequence > pending.sequence &&
          message.sessionId === pending.targetSessionId
        ) {
          pendingSwitchRef.current = {
            ...pending,
            snapshotSequence: message.sequence,
          };
        }
        return;
      }
      const pending = pendingSwitchRef.current;
      if (pending === null) {
        return;
      }
      if (
        message.type === 'runtime.diagnostic' &&
        SELECT_FAILURE_CODES.some((code) => code === message.code)
      ) {
        finish();
      }
    },
    [finish],
  );

  const fullOverlay =
    phase === 'restoring' || phase === 'switching' || phase === 'leaving';
  return {
    beginSwitch,
    observeHostMessage,
    phase,
    hasSnapshot: firstSnapshotSequence !== null && sequence >= firstSnapshotSequence,
    blocking: phase !== 'idle',
    overlay: fullOverlay ? <ConversationTransitionOverlay phase={phase} /> : null,
  };
}

export function DroidSignalGrid(): React.JSX.Element {
  return (
    <span className="dvx-droid-signal-grid" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function ConversationTransitionOverlay({
  phase,
}: {
  readonly phase: Exclude<TransitionPhase, 'boot-pending' | 'idle'>;
}): React.JSX.Element {
  const restoring = phase === 'restoring';
  return (
    <div
      className="dvx-conversation-transition-overlay"
      data-phase={phase}
      role="status"
      aria-live="polite"
    >
      <DroidSignalGrid />
      <span className="dvx-conversation-transition-label">
        {restoring ? 'Restoring conversation' : 'Switching conversation'}
      </span>
      <span className="dvx-conversation-transition-copy">
        {restoring ? 'Loading saved state' : 'Droid is reconnecting the thread'}
      </span>
    </div>
  );
}
