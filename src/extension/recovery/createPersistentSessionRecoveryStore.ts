import type * as vscode from 'vscode';

import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';

export function createPersistentSessionRecoveryStore(
  persistence: SessionRecoveryPersistence,
  _globalStorageUri: vscode.Uri,
): SessionRecoveryStore {
  return new SessionRecoveryStore(
    persistence,
  );
}
