import { useCallback, useEffect, useRef, useState } from 'react';

import type { StoreHostMessage } from './store';

const BOOT_DELAY_MS = 120;
const LEAVE_DELAY_MS = 150;

type TransitionPhase =
  | 'boot-pending'
  | 'restoring'
  | 'switching'
  | 'leaving'
  | 'idle';

export type ConversationSwitchKind =
  | 'new'
  | 'resume'
  | 'worktree'
  | 'fork'
  | 'rewind';

interface TransitionState {
  readonly sequence: number;
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly connectionStatus: 'idle' | 'connecting' | 'connected' | 'unavailable';
}

interface PendingSwitch {
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly sequence: number;
  readonly kind: ConversationSwitchKind;
}

const FAILURE_CODES: Readonly<Record<ConversationSwitchKind, readonly string[]>> = {
  new: ['session-operation-blocked', 'session-new-failed'],
  resume: [
    'session-selection-invalid',
    'session-operation-blocked',
    'session-resume-failed',
    'session-close-failed',
  ],
  worktree: ['worktree-create-unavailable', 'session-new-failed'],
  fork: [
    'session-fork-blocked',
    'session-fork-unsupported',
    'session-fork-failed',
  ],
  rewind: ['edit-resend-blocked', 'edit-resend-unsupported', 'edit-resend-failed'],
};

export function useConversationTransition({
  sequence,
  conversationId,
  sessionId,
  connectionStatus,
}: TransitionState): {
  readonly beginSwitch: (kind: ConversationSwitchKind) => void;
  readonly observeHostMessage: (message: StoreHostMessage) => void;
  readonly phase: TransitionPhase;
  readonly blocking: boolean;
  readonly contentEntering: boolean;
  readonly overlay: React.JSX.Element | null;
} {
  const [phase, setPhase] = useState<TransitionPhase>('boot-pending');
  const [contentEntering, setContentEntering] = useState(false);
  const [firstSnapshotSequence, setFirstSnapshotSequence] = useState<
    number | null
  >(null);
  const phaseRef = useRef(phase);
  const initialSnapshotSeenRef = useRef(false);
  const observedConversationRef = useRef<string | null | undefined>(undefined);
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
    if (
      initialSnapshotSeenRef.current ||
      (firstSnapshotSequence !== null && sequence >= firstSnapshotSequence)
    ) {
      initialSnapshotSeenRef.current = true;
      if (phaseRef.current === 'boot-pending') {
        transitionTo('idle');
      } else if (phaseRef.current === 'restoring') {
        finish();
      }
      return undefined;
    }
    const timer = setTimeout(() => {
      if (!initialSnapshotSeenRef.current) {
        transitionTo('restoring');
      }
    }, BOOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [finish, firstSnapshotSequence, sequence, transitionTo]);

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
      sequence > pending.sequence &&
      (
        (conversationId !== null &&
          conversationId !== pending.conversationId) ||
        (conversationId === pending.conversationId &&
          sessionId !== null &&
          sessionId !== pending.sessionId)
      )
    ) {
      finish();
    }
  }, [
    connectionStatus,
    conversationId,
    finish,
    phase,
    sequence,
    sessionId,
  ]);

  useEffect(() => {
    if (phase !== 'leaving') {
      return undefined;
    }
    const timer = setTimeout(() => transitionTo('idle'), LEAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, transitionTo]);

  useEffect(() => {
    if (!initialSnapshotSeenRef.current || conversationId === null) {
      return undefined;
    }
    if (observedConversationRef.current === undefined) {
      observedConversationRef.current = conversationId;
      return undefined;
    }
    if (observedConversationRef.current === conversationId) {
      return undefined;
    }
    observedConversationRef.current = conversationId;
    if (pendingSwitchRef.current !== null || phaseRef.current !== 'idle') {
      return undefined;
    }
    setContentEntering(true);
    const timer = setTimeout(() => setContentEntering(false), LEAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [conversationId]);

  const beginSwitch = useCallback(
    (kind: ConversationSwitchKind): void => {
      if (!initialSnapshotSeenRef.current || phaseRef.current === 'switching') {
        return;
      }
      pendingSwitchRef.current = { conversationId, sessionId, sequence, kind };
      transitionTo('switching');
    },
    [conversationId, sequence, sessionId, transitionTo],
  );

  const observeHostMessage = useCallback(
    (message: StoreHostMessage): void => {
      if (message.type === 'host.snapshot') {
        setFirstSnapshotSequence((current) => current ?? message.sequence);
        return;
      }
      const pending = pendingSwitchRef.current;
      if (pending === null) {
        return;
      }
      if (message.type === 'turn.editResendRejected') {
        if (pending.kind === 'rewind') {
          finish();
        }
        return;
      }
      if (
        message.type === 'runtime.diagnostic' &&
        FAILURE_CODES[pending.kind].includes(message.code)
      ) {
        finish();
      }
    },
    [finish],
  );

  const fullOverlay = phase === 'restoring' || phase === 'switching' || phase === 'leaving';
  return {
    beginSwitch,
    observeHostMessage,
    phase,
    blocking: phase === 'switching' || phase === 'leaving',
    contentEntering,
    overlay: fullOverlay ? <ConversationTransitionOverlay phase={phase} /> : null,
  };
}

export function DroidSignalGrid({
  size = 'full',
  className,
}: {
  readonly size?: 'full' | 'inline' | 'compact';
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span
      className={[
        'dvx-droid-signal-grid',
        `dvx-droid-signal-grid-${size}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <i
          className={size === 'inline' ? 'dvx-runtime-grid-dot' : undefined}
          key={index}
        />
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
