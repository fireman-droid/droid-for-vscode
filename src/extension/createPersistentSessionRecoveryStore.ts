import * as vscode from 'vscode';

import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import { createConversationImageArtifactStore } from './conversationImageArtifacts';

export function createPersistentSessionRecoveryStore(
  persistence: SessionRecoveryPersistence,
  globalStorageUri: vscode.Uri,
): SessionRecoveryStore {
  return new SessionRecoveryStore(
    persistence,
    undefined,
    undefined,
    createConversationImageArtifactStore(
      vscode.Uri.joinPath(
        globalStorageUri,
        'conversation-images',
      ).fsPath,
    ),
  );
}
