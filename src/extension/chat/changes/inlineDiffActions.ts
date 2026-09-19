import type { FileOpenTurnDiffMessage, FileReadDiffMessage, InlineDiffResult } from '../../../shared/protocol/inlineDiffProtocol';
import { readInlineDiff, readTurnDiffContents } from '../../changes/inlineDiff';
import type { HostOperations } from '../hostOperations';
import type { WorkspaceActionsPort } from '../workspace/workspaceActionsPort';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import { isTurnActive } from '../internals';

type InlineDiffPort = Pick<WorkspaceActionsPort, 'effects' | 'turnState' | 'emit' | 'recordHost'> &
  Pick<HostOperations, 'turnSnapshots'> & {
    ensureWorkspaceCurrent(): boolean;
    readonly sessionState: Readonly<Pick<SessionLifecycleState,
      'sessionId' | 'runtimeGeneration' | 'activeRuntimeCwd' | 'connection' | 'disposed'>>;
  };

function currentRequest(ctl: InlineDiffPort, sessionId: string): () => boolean {
  const generation = ctl.sessionState.runtimeGeneration;
  const root = ctl.sessionState.activeRuntimeCwd;
  return () => !ctl.sessionState.disposed && ctl.sessionState.sessionId === sessionId &&
    ctl.sessionState.runtimeGeneration === generation && ctl.sessionState.activeRuntimeCwd === root;
}

function resolveTurnFile(ctl: InlineDiffPort, message: FileReadDiffMessage | FileOpenTurnDiffMessage) {
  const { sessionId, turnId, path } = message;
  if (ctl.sessionState.connection.status !== 'connected' ||
    ctl.sessionState.sessionId !== sessionId || !ctl.ensureWorkspaceCurrent()) return undefined;
  const turn = ctl.turnState.turn;
  const live = turn?.turnId === turnId && isTurnActive(turn);
  const settled = ctl.effects.readConversationTurnChanges(turnId);
  const files = live ? turn.changesLedger?.files() : settled?.files;
  const root = ctl.sessionState.activeRuntimeCwd;
  // Only files attributed to this conversation turn may be requested by the webview.
  if (!files?.some((file) => file.path === path) || !ctl.turnSnapshots || root === null) return undefined;
  return {
    snapshots: ctl.turnSnapshots, root,
    scope: { sessionId: live ? sessionId : settled!.sessionId, turnId },
    phase: live ? 'live' as const : 'settled' as const,
  };
}

export function handleFileReadDiff(ctl: InlineDiffPort, message: FileReadDiffMessage): void {
  const { sessionId, turnId, path, requestId } = message;
  const isCurrent = currentRequest(ctl, sessionId);
  const reply = (result: InlineDiffResult): void => {
    if (isCurrent()) ctl.emit({ type: 'file.diff', sessionId, turnId, path, requestId, result });
  };
  const target = resolveTurnFile(ctl, message);
  if (!target) {
    reply({ status: 'unavailable' });
    return;
  }
  void readInlineDiff(target.snapshots, target.scope, target.root, path, target.phase,
    { record: (event) => ctl.recordHost(event) }).then(reply, (error: unknown) => {
    recordReadFailure(ctl, message, error);
    reply({ status: 'read-failed' });
  });
}

export function handleFileOpenTurnDiff(
  ctl: InlineDiffPort & Pick<HostOperations, 'fileDiff' | 'emitSessionDiagnostic'>,
  message: FileOpenTurnDiffMessage,
): void {
  const isCurrent = currentRequest(ctl, message.sessionId);
  const fail = (): void => {
    if (isCurrent()) ctl.emitSessionDiagnostic('file-diff-failed', `Could not open the turn snapshots for ${message.path}.`);
  };
  const target = resolveTurnFile(ctl, message);
  if (!target) { fail(); return; }
  void (async () => {
    const contents = await readTurnDiffContents(target.snapshots, target.scope, target.root, message.path, target.phase);
    if (!isCurrent()) return;
    if (contents.status !== 'ready') { fail(); return; }
    const outcome = await ctl.fileDiff.openDiff(message.path, {
      sessionId: message.sessionId, turnId: message.turnId,
    }, { turnSnapshot: {
      before: contents.before.toString('utf8'), after: contents.after.toString('utf8'), phase: target.phase,
    } });
    if (outcome !== 'opened-diff') fail();
  })().catch((error: unknown) => { recordReadFailure(ctl, message, error); fail(); });
}

function recordReadFailure(ctl: InlineDiffPort, message: FileReadDiffMessage | FileOpenTurnDiffMessage, error: unknown): void {
  ctl.recordHost({
    level: 'warn', name: 'host.inline-diff.read-failed',
    attributes: { sessionId: message.sessionId, turnId: message.turnId, path: message.path },
    detail: error instanceof Error ? error.message : String(error),
  });
}
