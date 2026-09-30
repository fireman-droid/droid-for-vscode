import { StreamStateTracker, type DaemonSessionController } from '@factory/droid-sdk';
import { ProtocolError } from '@factory/droid-sdk/node';
import type { RuntimeEvent } from './runtimeEvents';
import { normalizeSdkEvent } from './events/normalizeSdkEvent';

export type DaemonTurnOutcome = NonNullable<Awaited<ReturnType<DaemonSessionController['loadSession']>>['agentTurnOutcome']>;
export interface RuntimeTurnOutcome {
  readonly backendTurnId: string;
  readonly reason: DaemonTurnOutcome['reason'];
  readonly resultKind: DaemonTurnOutcome['resultKind'];
  readonly structuredResult?: Readonly<Record<string, unknown>>;
  readonly completion: Extract<RuntimeEvent, { type: 'turn-complete' }>;
}

/** The SDK validates the wire shape; the requested turn still needs exact attribution. */
export function projectDurableTurnOutcome(
  sessionId: string, backendTurnId: string, outcome: DaemonTurnOutcome | null | undefined,
): RuntimeTurnOutcome | null {
  if (outcome == null) return null;
  if (outcome.turnId !== backendTurnId) throw new ProtocolError('The recovered result belongs to a different turn.');
  // Use the SDK's reason mapping, without inventing missing usage or replaying text.
  const completion = normalizeSdkEvent(new StreamStateTracker({ sessionId }).completeTurn({ reason: outcome.reason }));
  if (completion?.type !== 'turn-complete') throw new ProtocolError('The recovered turn outcome could not be represented.');
  return { backendTurnId, reason: outcome.reason, resultKind: outcome.resultKind, completion,
    ...(outcome.resultKind === 'structured' ? { structuredResult: outcome.result } : {}) };
}
