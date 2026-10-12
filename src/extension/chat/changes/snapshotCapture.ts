import type { TurnSnapshotStore } from '../../changes/turnSnapshots';

/** Sending is gated by a durable baseline; capture failure must not start the agent. */
export async function captureSnapshotBeforeSend(
  host: { readonly turnSnapshots?: TurnSnapshotStore },
  sessionId: string,
  turnId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!host.turnSnapshots) throw new Error('Change recording is unavailable. The request was not sent.');
  const before = await host.turnSnapshots.capture({ sessionId, turnId }, 'before', signal);
  if (!before) throw new Error('Could not save the workspace baseline. The request was not sent. Check file access and retry.');
}
