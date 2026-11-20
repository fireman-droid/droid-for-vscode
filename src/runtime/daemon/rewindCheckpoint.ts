import { createHash } from 'node:crypto';
import { isRewindFileResult, type RewindFileResult } from '../../shared/protocol/rewindResult';
import { isId } from '../../shared/validation/guards';

export interface RewindCheckpoint {
  readonly sourceSessionId: string;
  readonly messageId: string;
  /** Null means the native request started but its outcome was not durably recorded. */
  readonly newSessionId: string | null;
  readonly filesRequested: boolean;
  readonly files?: RewindFileResult;
}

export interface RewindCheckpointStore {
  read(cwd: string, sourceSessionId: string): RewindCheckpoint | undefined;
  write(cwd: string, checkpoint: RewindCheckpoint): Promise<void>;
  clear(cwd: string, checkpoint: RewindCheckpoint): Promise<void>;
}

/** Each source has its own workspace-scoped key so unrelated sessions never overwrite it. */
export function createRewindCheckpointStore(persistence: {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}): RewindCheckpointStore {
  const key = (cwd: string, id: string) => `droidvisx.rewind.${createHash('sha256')
    .update(JSON.stringify([cwd, id])).digest('hex')}`;
  const read = (cwd: string, sourceSessionId: string): RewindCheckpoint | undefined => {
    const value = persistence.get<RewindCheckpoint>(key(cwd, sourceSessionId));
    if (value === undefined) return;
    if (!value || value.sourceSessionId !== sourceSessionId || !isId(value.messageId) ||
      value.newSessionId !== null && !isId(value.newSessionId) || typeof value.filesRequested !== 'boolean' ||
      value.files !== undefined && !isRewindFileResult(value.files)) {
      throw new Error('The saved rewind checkpoint is invalid and requires manual recovery.');
    }
    return value;
  };
  return {
    read,
    async write(cwd, checkpoint) {
      await persistence.update(key(cwd, checkpoint.sourceSessionId), checkpoint);
    },
    async clear(cwd, checkpoint) {
      const current = read(cwd, checkpoint.sourceSessionId);
      if (current?.messageId === checkpoint.messageId && current.newSessionId === checkpoint.newSessionId) {
        await persistence.update(key(cwd, checkpoint.sourceSessionId), undefined);
      }
    },
  };
}
