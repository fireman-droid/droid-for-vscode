import * as vscode from 'vscode';

import type { DroidRuntime } from '../../runtime/DroidRuntime';
import { FactoryDroidRuntime } from '../../runtime/FactoryDroidRuntime';
import { type FactoryDroidSessionFactory } from '../../runtime/session/sessionTypes';
import { cancellingRuntimeInteractionHandler } from '../../runtime/events/runtimeInteractions';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ReviewHostMessage } from '../../shared/protocol/reviewProtocol';
import type { ChangeStatsPersistence } from '../changes/changeStats';
import type { FileDiffOpener } from '../changes/fileDiffOpener';
import type { GitWorkflow } from '../workspace/gitWorkflow';
import { ReviewCoordinator } from './reviewCoordinator';
import { resolveReviewGitRef } from './reviewCoordinatorSupport';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ChatController } from '../chat/ChatController';
import type { SessionViewerPanelController } from '../panels/sessionViewer/SessionViewerPanelController';
import { DiffSelectionRegistry } from '../changes/diffSelectionRegistry';
import { createVscodeAttachmentSources } from '../attachments/vscodeAttachmentSources';
import { createVscodeFileDiffOpener } from '../changes/vscodeFileDiff';
import { createVscodeGitWorkflow } from '../workspace/vscodeGitWorkflow';
import type { ChangeStatsReader } from '../changes/changeStats';
import { loadReviewGitScope } from './reviewGitComparison';
import { loadReviewSdkScope } from './reviewSdkDiff';
import { isTurnActive } from '../chat/internals';
import { SubagentReviewEvidence } from '../chat/subagents/SubagentReviewEvidence';

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
}): { coordinator: ReviewCoordinator; start(): void } {
  const getRoot = (): string | undefined =>
    options.getController().sessionState.activeRuntimeCwd ?? undefined;
  let coordinator: ReviewCoordinator | null = null;
  const childEvidence = new SubagentReviewEvidence(
    options.getController,
    () => coordinator,
  );
  coordinator = new ReviewCoordinator({
    isSessionCurrent: (sessionId) => options.getController().sessionState.sessionId === sessionId,
    isTurnWriting(sessionId, turnId) {
      const controller = options.getController();
      const turn = controller.turnState.turn;
      return controller.sessionState.sessionId === sessionId && turn?.turnId === turnId && isTurnActive(turn);
    },
    isOperationWriting(sessionId, turnId) {
      const controller = options.getController();
      const turn = controller.turnState.turn;
      return controller.sessionState.sessionId === sessionId &&
        (turn?.turnId === turnId && isTurnActive(turn) || childEvidence.isRunning(sessionId, turnId));
    },
    readTurnOperationNotices: (sessionId, turnId) => childEvidence.notices(sessionId, turnId),
    readTurnOperations(sessionId, turnId) {
      const controller = options.getController();
      if (controller.sessionState.sessionId !== sessionId) return [];
      const live = controller.recoveryState.transcript.transcript.flatMap(
        (item, sequence) =>
          item.kind === 'tool' &&
          item.turnId === turnId &&
          item.operationDiff !== undefined
            ? [{
                sequence,
                sessionId:
                  item.operationDiff.status === 'ready'
                    ? item.operationDiff.sourceSessionId ?? sessionId
                    : sessionId,
                toolUseId: item.toolUseId,
                toolName: item.toolName,
                operationDiff: item.operationDiff,
                ...(item.executionPhase === undefined
                  ? {}
                  : { executionPhase: item.executionPhase }),
              }]
            : [],
      );
      const conversationId = controller.sessionState.conversationId;
      const turn =
        conversationId === null
          ? undefined
          : controller.recoveryStore.readTurn(conversationId, turnId);
      const persisted = turn?.toolOperations?.map((operation, sequence) => ({
        sequence,
        sessionId:
          operation.operationDiff.status === 'ready'
            ? operation.operationDiff.sourceSessionId ?? turn.sessionId
            : turn.sessionId,
        ...operation,
      })) ?? [];
      const parent = [...live, ...persisted];
      const child = childEvidence.read(sessionId, turnId);
      const dedupe = new Set<string>();
      return [...parent, ...child].filter((operation) => {
        const diff = operation.operationDiff;
        const sourceSessionId =
          diff.status === 'ready'
            ? diff.sourceSessionId ?? operation.sessionId
            : operation.sessionId;
        const identity =
          diff.status === 'ready' && diff.callId !== undefined
            ? `${sourceSessionId}\u0000${diff.callId}`
            : `${sourceSessionId}\u0000${operation.toolUseId}`;
        if (dedupe.has(identity)) return false;
        dedupe.add(identity);
        return true;
      }).map((operation, sequence) => ({ ...operation, sequence }));
    },
    openSelectionInEditor: false,
    async readGitScope(kind) {
      const root = getRoot();
      if (!root) throw new Error('No active workspace.');
      const runtime = options.getController().sessionState.runtime;
      if (kind === 'workspace' && runtime?.supportsGitDiff?.() === false)
        return loadReviewGitScope(root, kind);
      if (kind === 'branch' || kind === 'workspace')
        return loadReviewSdkScope(root, kind, runtime);
      return loadReviewGitScope(root, kind);
    },
    getWorkspaceRoot: getRoot,
    snapshots: options.snapshots,
    fileDiff: options.fileDiff,
    persistence: options.persistence,
    storageDir: vscode.Uri.joinPath(options.context.globalStorageUri, 'review-restore')
      .fsPath,
    publish: (message) => options.getController().emit(message),
    resolveCanonicalTurnSessionId(_sessionId, turnId) {
      const controller = options.getController();
      if (controller.sessionState.conversationId === null) {
        return undefined;
      }
      return controller.recoveryStore.readTurn(
        controller.sessionState.conversationId,
        turnId,
      )?.sessionId;
    },
    readCanonicalTurnFiles(sessionId, turnId) {
      const controller = options.getController();
      if (controller.sessionState.sessionId !== sessionId) {
        return undefined;
      }
      const live = controller.turnState.turn;
      if (live?.turnId === turnId && isTurnActive(live)) return live.changesLedger?.files() ?? [];
      if (controller.sessionState.conversationId === null) {
        return undefined;
      }
      const turn = controller.recoveryStore.readTurn(
        controller.sessionState.conversationId,
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
      const diff = await options.getController().sessionState.runtime?.readGitDiff?.();
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
  options.context.subscriptions.push(childEvidence);
  const readyCoordinator = coordinator;
  return {
    coordinator: readyCoordinator,
    start() {
      readyCoordinator.start();
      childEvidence.start();
    },
  };
}
