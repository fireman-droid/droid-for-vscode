import type { TurnSnapshotStore } from '../../changes/turnSnapshots';
import type { DroidRuntime } from '../../../runtime/DroidRuntime';

/** Sending is gated by a durable baseline; capture failure must not start the agent. */
export async function captureSnapshotBeforeSend(
  host: { readonly turnSnapshots?: TurnSnapshotStore },
  sessionId: string,
  turnId: string,
  signal?: AbortSignal,
  runtime?: Pick<DroidRuntime, 'readSessionWorkingState'>,
): Promise<void> {
  if (!host.turnSnapshots) throw new Error('Change recording is unavailable. The request was not sent.');
  const pending = await host.turnSnapshots.readPendingCapture?.();
  if (pending?.sessionId === sessionId && pending.turnId !== turnId) {
    // A rejected retry may have replaced the display checkpoint. Recover the
    // durable capture owner, never infer it from the latest displayed turn.
    signal?.throwIfAborted();
    if (await runtime?.readSessionWorkingState?.() !== 'idle')
      throw new Error('The previous reply is still running or its state could not be confirmed. Wait for it to finish, then retry.');
    signal?.throwIfAborted();
    const after = await host.turnSnapshots.capture(pending, 'after', signal);
    if (!after) throw new Error('The previous reply finished, but its changes could not be recorded. The new request was not sent. Retry to continue.');
  }
  const before = await host.turnSnapshots.capture({ sessionId, turnId }, 'before', signal);
  if (!before) throw new Error('Could not save the workspace baseline. The request was not sent. Check file access and retry.');
}
