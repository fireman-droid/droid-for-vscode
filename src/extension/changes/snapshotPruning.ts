import { join } from 'node:path';
import type { TurnSnapshotDependencies } from './turnSnapshots';

/** Remove only unreferenced loose objects from this store, never repository alternates. */
export async function pruneSnapshotObjects(
  objectsDir: string,
  reachable: ReadonlySet<string>,
  dependencies: Pick<TurnSnapshotDependencies, 'readdir' | 'unlink'>,
): Promise<number> {
  let removed = 0;
  for (const prefix of await dependencies.readdir(objectsDir)) {
    if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
    for (const suffix of await dependencies.readdir(join(objectsDir, prefix))) {
      if (!/^[0-9a-f]{38}$/.test(suffix) || reachable.has(prefix + suffix)) continue;
      await dependencies.unlink(join(objectsDir, prefix, suffix));
      removed++;
    }
  }
  return removed;
}
