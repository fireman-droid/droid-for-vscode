import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { RuntimeDiagnosticSink } from '../../../runtime/runtimeDiagnostics';
import type { FactoryDroidSessionFactory } from '../../../runtime/session/sessionTypes';
import type { ReviewPanelOpen } from '../../../shared/protocol/reviewPanelProtocol';
import { createGitChangeStatsReader } from '../../changes/changeStats';
import { createTurnSnapshotStore } from '../../changes/turnSnapshots';
import { watchWorkspaceChanges } from '../../changes/watchWorkspaceChanges';
import { ChatController } from '../../chat/ChatController';
import { emitIdeState, type NativeIdeBackend } from '../../chat/ideIntegration';
import { RecentCommandsStore } from '../../chat/capabilities/RecentCommandsStore';
import { PlanDocumentController } from '../../interactions/planDocumentController';
import { SessionRecoveryStore, type SessionRecoveryPersistence } from '../../recovery/SessionRecoveryStore';
import { createReviewFeature, createReviewFoundation } from '../../review/createReviewFeature';
import { ReviewPanelController } from '../review/ReviewPanelController';
import type { SessionViewerPanelController } from '../sessionViewer/SessionViewerPanelController';

export function createAgentChatController(options: {
  readonly context: vscode.ExtensionContext;
  readonly persistence: SessionRecoveryPersistence;
  readonly diagnostics: RuntimeDiagnosticSink;
  readonly parent: ChatController;
  readonly sessionViewer: SessionViewerPanelController;
  readonly createSdkSession: FactoryDroidSessionFactory;
  readonly target: { readonly sessionId: string; readonly cwd: string };
  readonly nativeIde?: Pick<NativeIdeBackend, 'read'> & { subscribe(listener: () => void): () => void };
}): {
  readonly controller: ChatController;
  openReview(message?: ReviewPanelOpen): void;
  dispose(): Promise<void>;
} {
  const { context, parent, target, diagnostics, persistence } = options;
  const scope = createHash('sha256').update(target.sessionId).digest('hex');
  const prefix = `droidvisx.child.${target.sessionId}.`;
  const childPersistence: SessionRecoveryPersistence = {
    get: <T>(key: string) => persistence.get<T>(`${prefix}${key}`),
    update: (key, value) => persistence.update(`${prefix}${key}`, value),
  };
  const recovery = new SessionRecoveryStore(persistence, `droidvisx.childRecovery.${target.sessionId}`);
  const subscriptions: vscode.Disposable[] = [];
  const storageUri = vscode.Uri.joinPath(context.globalStorageUri, 'child-sessions', scope);
  const root = () => target.cwd;
  const snapshots = createTurnSnapshotStore(root,
    vscode.Uri.joinPath(storageUri, 'turn-objects').fsPath, childPersistence,
    { recordDiagnostic: (event) => diagnostics.record(event) });
  const changeStats = createGitChangeStatsReader(root, {}, childPersistence, snapshots, watchWorkspaceChanges);
  const { attachmentSources, fileDiff, gitWorkflow } = createReviewFoundation(
    changeStats, diagnostics, `droidvisx-child-baseline-${scope}`);
  let controller: ChatController;
  const planDocuments = new PlanDocumentController((state) => controller.emit(state));
  const review = createReviewFeature({
    context: { subscriptions, globalStorageUri: storageUri },
    snapshots, fileDiff, persistence: childPersistence, gitWorkflow, diagnostics,
    getController: () => controller,
    createSdkSession: options.createSdkSession,
    sessionViewer: options.sessionViewer,
  });
  controller = new ChatController({
    createRuntime: parent.createRuntime,
    getWorkspaceContext: () => ({ cwd: target.cwd, trusted: vscode.workspace.isTrusted }),
    sessionCatalog: parent.sessionCatalog,
    recoveryStore: recovery,
    sessionHistory: parent.sessionHistory,
    attachmentSources,
    fileDiff,
    changeStats,
    externalUrl: parent.externalUrl,
    recentCommands: new RecentCommandsStore(childPersistence),
    diagnostics,
    daemonSessions: parent.daemonSessions,
    pathOpener: parent.pathOpener,
    gitWorkflow,
    daemonPlugins: parent.daemonPlugins,
    turnSnapshots: snapshots,
    planDocuments,
    reviewCoordinator: review.coordinator,
    childSession: target,
    sharedServices: parent.sharedServices,
  });
  if (options.nativeIde) {
    controller.nativeIde = { read: options.nativeIde.read };
    subscriptions.push({ dispose: options.nativeIde.subscribe(() => emitIdeState(controller)) });
  }
  const reviewPanel = new ReviewPanelController(
    context.extensionUri, controller, review.coordinator, gitWorkflow, options.sessionViewer);
  review.start();
  let disposal: Promise<void> | undefined;
  return {
    controller,
    openReview: (message) => reviewPanel.open(message),
    dispose() {
      if (disposal) return disposal;
      reviewPanel.dispose();
      attachmentSources.dispose();
      for (const subscription of subscriptions) subscription.dispose();
      subscriptions.length = 0;
      // ChatController releases its own review, plan, diffs, snapshots, recovery
      // and daemon attachment; parent resources and daemon execution stay alive.
      disposal = controller.dispose();
      return disposal;
    },
  };
}
