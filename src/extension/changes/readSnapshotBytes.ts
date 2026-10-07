import type { TurnSnapshotScope, TurnSnapshotStore } from './turnSnapshots';
import { GitObjectTooLargeError } from '../workspace/gitTreeReader';

export async function readSnapshotBytes(store: TurnSnapshotStore, scope: TurnSnapshotScope,
  path: string, side: 'before' | 'after', maxBytes: number) {
  try {
    return await (store.readTreeBytesBatched
      ? store.readTreeBytesBatched(scope, path, side, maxBytes) : store.readTreeBytes(scope, path, side));
  } catch (error) {
    if (error instanceof GitObjectTooLargeError) return 'too-large' as const;
    throw error;
  }
}
