import * as vscode from 'vscode';

import type { DroidRuntime } from '../runtime/DroidRuntime';
import {
  FactoryDroidRuntime,
  type FactoryDroidSessionFactory,
} from '../runtime/FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from '../runtime/runtimeInteractions';
import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import type { ReviewHostMessage } from '../shared/reviewProtocol';
import type { ChangeStatsPersistence } from './changeStats';
import type { FileDiffOpener } from './fileDiffOpener';
import type { GitWorkflow } from './gitWorkflow';
import {
  ReviewCoordinator,
} from './reviewCoordinator';
import { resolveReviewGitRef } from './reviewCoordinatorSupport';
import type { TurnSnapshotStore } from './turnSnapshots';
import type { ChatController } from './ChatController';
import type { SessionViewerPanelController } from './SessionViewerPanelController';
import { DiffSelectionRegistry } from './diffSelectionRegistry';
import { createVscodeAttachmentSources } from './vscodeAttachmentSources';
import { createVscodeFileDiffOpener } from './vscodeFileDiff';
import { createVscodeGitWorkflow } from './vscodeGitWorkflow';
import type { ChangeStatsReader } from './changeStats';

type UnsequencedReviewMessage = ReviewHostMessage extends infer Message
  ? Message extends { readonly sequence: number }
    ? Omit<Message, 'sequence'>
    : never
  : never;

export function createReviewFoundation(
  changeStats: ChangeStatsReader,
  diagnostics: RuntimeDiagnosticSink,
) {
  const selections = new DiffSelectionRegistry();
  return {
    attachmentSources: createVscodeAttachmentSources(selections),
    fileDiff: createVscodeFileDiffOpener(changeStats, diagnostics, selections),
    gitWorkflow: createVscodeGitWorkflow(),
  };
}

export function createReviewFeature(options: {
  readonly context: vscode.ExtensionContext;
  readonly snapshots: TurnSnapshotStore;
  readonly fileDiff: FileDiffOpener;
  readonly persistence: ChangeStatsPersistence;
  readonly gitWorkflow: GitWorkflow;
  readonly diagnostics: RuntimeDiagnosticSink;
  readonly getController: () => ChatController;
  readonly createSdkSession: FactoryDroidSessionFactory;
  readonly sessionViewer: SessionViewerPanelController;
}): ReviewCoordinator {
  const getRoot = (): string | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return new ReviewCoordinator({
    getWorkspaceRoot: getRoot,
    snapshots: options.snapshots,
    fileDiff: options.fileDiff,
    persistence: options.persistence,
    storageDir: vscode.Uri.joinPath(
      options.context.globalStorageUri,
      'review-restore',
    ).fsPath,
    publish: (message) => options.getController().emit(message),
    resolveCanonicalTurnSessionId(_sessionId, turnId) {
      const controller = options.getController();
      if (controller.conversationId === null) {
        return undefined;
      }
      return controller.recoveryStore.readTurn(
        controller.conversationId,
        turnId,
      )?.sessionId;
    },
    readCanonicalTurnFiles(sessionId, turnId) {
      const controller = options.getController();
      if (controller.sessionId !== sessionId) {
        return undefined;
      }
      if (controller.conversationId === null) {
        return undefined;
      }
      const turn = controller.recoveryStore.readTurn(
        controller.conversationId,
        turnId,
      );
      return turn?.changesSettled === true ? turn.files : undefined;
    },
    async readWorkspaceFiles() {
      const root = getRoot();
      if (root === undefined) return undefined;
      const [status, baseline] = await Promise.all([
        options.gitWorkflow.status(root, new Set()),
        resolveReviewGitRef(root, 'HEAD'),
      ]);
      if (!status.available || baseline === undefined) return undefined;
      return {
        baseline,
        files: status.files.map(({ path }) => ({
          path,
          additions: null,
          deletions: null,
        })),
      };
    },
    async readBranchDiff() {
      const root = getRoot();
      const diff = await options.getController().runtime?.readGitDiff?.();
      if (root === undefined || diff === undefined) return undefined;
      const baseline = await resolveReviewGitRef(root, diff.baseBranch);
      return baseline === undefined ? undefined : { baseline, diff };
    },
    diagnostics: options.diagnostics,
    runAgentReview: {
      async run(scope) {
        const cwd = getRoot();
        if (cwd === undefined) throw new Error('No workspace');
        const runtime: DroidRuntime = new FactoryDroidRuntime({
          interactionHandler: cancellingRuntimeInteractionHandler,
          diagnostics: options.diagnostics,
          createSdkSession: options.createSdkSession,
        });
        const availability = await runtime.initialize(cwd);
        if (availability.status !== 'available') {
          await runtime.dispose().catch(() => undefined);
          throw new Error('Review session unavailable');
        }
        options.sessionViewer.open({
          kind: 'daemon-session',
          mode: 'standard',
          sessionId: availability.sessionId,
          title: `Agent Review · ${scope.baselineLabel}`,
          cwd,
        });
        const completion = (async () => {
          try {
            for await (const _event of runtime.sendTurn('/review')) {
              // The Session Viewer reads the independent public Session.
            }
          } finally {
            await runtime.dispose().catch(() => undefined);
          }
        })();
        return { sessionId: availability.sessionId, completion };
      },
    },
  });
}
