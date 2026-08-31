import type { TurnSnapshotStore } from '../turnSnapshots';

interface SnapshotCaptureHost {
  readonly turnSnapshots?: TurnSnapshotStore;
  recordHost(event: {
    readonly level: 'warn';
    readonly name: 'host.changes.snapshot-failed';
    readonly attributes: {
      readonly sessionId: string;
      readonly turnId: string;
      readonly phase: 'before';
      readonly reason: 'persistence-failed';
    };
  }): void;
}

export function captureSnapshotBeforeInBackground(
  host: SnapshotCaptureHost,
  sessionId: string,
  turnId: string,
): void {
  const snapshots = host.turnSnapshots;
  if (snapshots !== undefined) {
    void snapshots.capture({ sessionId, turnId }, 'before').catch(() => {
      host.recordHost({
        level: 'warn',
        name: 'host.changes.snapshot-failed',
        attributes: { sessionId, turnId, phase: 'before', reason: 'persistence-failed' },
      });
    });
  }
}
