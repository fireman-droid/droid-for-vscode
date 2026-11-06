import type * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import { parseConversationRecoveryState } from './conversationRecoveryParser';
import { withoutCachedHistory } from './conversationMetadata';

const FILE_MARKER = { storage: 'workspace-file', version: 1 } as const;
const isFileMarker = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && 'storage' in value && value.storage === FILE_MARKER.storage &&
  'version' in value && value.version === FILE_MARKER.version;

export function createPersistentSessionRecoveryStore(
  persistence: SessionRecoveryPersistence,
  storageUri: Pick<vscode.Uri, 'fsPath'> | undefined,
): SessionRecoveryStore {
  // Empty windows have no workspace storage directory. Never share their
  // recovery payload through the global extension directory.
  if (!storageUri) return new SessionRecoveryStore(persistence);
  const file = path.join(storageUri.fsPath, 'session-recovery.json');
  let loaded = false;
  return new SessionRecoveryStore({
    async get<T>(key: string): Promise<T | undefined> {
      loaded = false;
      let saved: unknown;
      try {
        saved = JSON.parse(await readFile(file, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('Workspace session recovery file is invalid');
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        saved = persistence.get<unknown>(key);
        if (isFileMarker(saved)) throw new Error('Workspace session recovery file is missing');
        loaded = true;
        return saved as T | undefined;
      }
      if (parseConversationRecoveryState(withoutCachedHistory(saved)) === undefined) {
        throw new Error('Workspace session recovery file is invalid');
      }
      loaded = true;
      return saved as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (!loaded) throw new Error('Workspace session recovery must be loaded before writing');
      await mkdir(storageUri.fsPath, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify(value), 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
      } catch (error) {
        // Only this attempt's temporary file is disposable; keep the last
        // committed file and legacy Memento payload on every failed write.
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      // A crash or Memento failure after rename still leaves the newer file
      // authoritative on restart. Replace the old payload only after commit.
      if (!isFileMarker(persistence.get(key))) await persistence.update(key, FILE_MARKER);
    },
  });
}
