import type { ChatController } from '../chat/ChatController';
import { isUsableWorkspace } from '../chat/internals';

/** Saved edits belong to the loaded history even when its runtime cannot connect. */
export function reviewWorkspaceRoot(controller: Pick<ChatController, 'sessionState' | 'getWorkspaceContext'>): string | undefined {
  const { sessionId, activeRuntimeCwd, historyWorkspace, disposed } = controller.sessionState;
  if (disposed || sessionId === null) return undefined;
  const root = activeRuntimeCwd ?? (historyWorkspace?.sessionId === sessionId ? historyWorkspace.cwd : undefined);
  const workspace = controller.getWorkspaceContext();
  return isUsableWorkspace(workspace) && workspace.cwd === root ? root : undefined;
}
