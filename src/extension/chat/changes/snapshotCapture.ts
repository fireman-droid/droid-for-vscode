import type { TurnSnapshotScope, TurnSnapshotStore } from '../../changes/turnSnapshots';
import type { DroidRuntime } from '../../../runtime/DroidRuntime';

const pendingCaptures = new WeakMap<TurnSnapshotStore, Map<string, Promise<string | undefined>>>();

/** Completion, recovery and the next send share the same final capture. */
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
  runtime?: Pick<DroidRuntime, 'readSessionWorkingState' | 'readOtherSessionWorkingState'>,
): Promise<void> {
  if (!host.turnSnapshots) throw new Error('Change recording is unavailable. The request was not sent.');
  const pending = await host.turnSnapshots.readPendingCapture?.();
  if (pending && pending.turnId !== turnId && (pending.sessionId === sessionId || runtime?.readOtherSessionWorkingState !== undefined)) {
    // A rejected retry or an earlier session in this workspace may still hold
    // the durable capture lease after its daemon turn finished.
    signal?.throwIfAborted();
    const settling = pendingCaptures.get(host.turnSnapshots)?.get(`${pending.sessionId}:${pending.turnId}`);
    const recorded = host.turnSnapshots.read(pending.sessionId, pending.turnId)?.after;
    const state = !settling && !recorded
      ? await (pending.sessionId === sessionId
          ? runtime?.readSessionWorkingState?.()
          : runtime?.readOtherSessionWorkingState?.(pending.sessionId))
      : 'idle';
    if (!settling && !recorded && state !== 'idle') {
      throw new Error(pending.sessionId === sessionId
        ? 'The previous reply is still running or its state could not be confirmed. Wait for it to finish, then retry.'
        : `This workspace has an unfinished captured turn. Reopen session ${pending.sessionId} to finish recording it before sending another turn.`);
    }
    signal?.throwIfAborted();
    const after = await (settling ?? finishPendingSnapshot(host.turnSnapshots, pending, signal));
    signal?.throwIfAborted();
    if (!after) throw new Error('The previous reply finished, but its changes could not be recorded. The new request was not sent. Retry to continue.');
  }
  const before = await host.turnSnapshots.capture({ sessionId, turnId }, 'before', signal);
  if (!before) throw new Error('Could not save the workspace baseline. The request was not sent. Check file access and retry.');
}
