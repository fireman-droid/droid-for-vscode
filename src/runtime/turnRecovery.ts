import type { RuntimeEvent } from './runtimeEvents';
import { DaemonStreamRecoveryError } from './daemon/sessionStream';
import { normalizeSdkEvent } from './events/normalizeSdkEvent';

/** The worker is still owned; reconcile its snapshot without resending or interrupting it. */
export class RuntimeTurnRecoveryError extends Error {
  constructor(readonly messageId: string,
    private readonly readCompletion: () => Extract<RuntimeEvent, { type: 'turn-complete' }> | undefined,
    readonly dispose: () => void) {
    super('Droid transport restored; reconcile the existing turn from its session snapshot.');
    this.name = 'RuntimeTurnRecoveryError';
  }
  get completion(): Extract<RuntimeEvent, { type: 'turn-complete' }> | undefined { return this.readCompletion(); }
}

export function recoveredTurnError(error: unknown, cwd?: string): RuntimeTurnRecoveryError | undefined {
  if (!(error instanceof DaemonStreamRecoveryError)) return undefined;
  return new RuntimeTurnRecoveryError(error.messageId, () => {
    const result = error.recovery.completion;
    const completion = result === undefined ? undefined : normalizeSdkEvent(result, cwd);
    return completion?.type === 'turn-complete' ? completion : undefined;
  }, () => error.recovery.dispose());
}
