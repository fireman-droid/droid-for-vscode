import type { TurnSnapshotScope, TurnSnapshotStore } from '../../changes/turnSnapshots';
import type { DroidRuntime } from '../../../runtime/DroidRuntime';

const pendingCaptures = new WeakMap<TurnSnapshotStore, Map<string, Promise<string | undefined>>>();

/** Opening a session and retrying a send can recover the same durable owner. */
export function finishPendingSnapshot(
  store: TurnSnapshotStore,
  scope: TurnSnapshotScope,
  signal?: AbortSignal,
): Promise<string | undefined> {
  let captures = pendingCaptures.get(store);
  if (!captures) pendingCaptures.set(store, captures = new Map());
  const key = `${scope.sessionId}:${scope.turnId}`;
  const existing = captures.get(key);
  if (existing) return existing;
  const capture = store.capture(scope, 'after', signal).finally(() => captures.delete(key));
  captures.set(key, capture);
  return capture;
}

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
    const after = await finishPendingSnapshot(host.turnSnapshots, pending, signal);
    if (!after) throw new Error('The previous reply finished, but its changes could not be recorded. The new request was not sent. Retry to continue.');
  }
  const before = await host.turnSnapshots.capture({ sessionId, turnId }, 'before', signal);
  if (!before) throw new Error('Could not save the workspace baseline. The request was not sent. Check file access and retry.');
}
