import type { SessionCatalog } from '../../runtime/catalog/SessionCatalog';
import type { DaemonPluginCatalog } from '../../runtime/daemon/DaemonPluginCatalog';
import type { DaemonSessionCatalog } from '../../runtime/daemon/DaemonSessionCatalog';
import type { DroidRuntime } from '../../runtime/DroidRuntime';
import {
  createUnavailableSessionHistoryLoader,
  type SessionHistoryLoader,
} from '../../runtime/history/SessionHistory';
import type {
  RuntimeDiagnosticEvent,
  RuntimeDiagnosticSink,
} from '../../runtime/runtimeDiagnostics';
import { type WebviewToHostMessage } from '../../shared/bridgeMessages';
import {
  createUnavailableAttachmentSources,
  type AttachmentCaptureOutcome,
  type AttachmentSources,
} from '../attachments/attachmentSources';
import { BtwSideChat, type BtwSidecarFactory } from '../btw/btwSideChat';
import {
  createUnavailableChangeStatsReader,
  type ChangeStatsReader,
} from '../changes/changeStats';
import {
  createUnavailableFileDiffOpener,
  type FileDiffOpener,
} from '../changes/fileDiffOpener';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { PendingInteractionCoordinator } from '../interactions/pendingInteractionCoordinator';
import {
  createUnavailablePlanDocumentGateway,
  type PlanDocumentGateway,
} from '../interactions/planDocumentGateway';
import {
  createUnavailablePrototypePreviewOpener,
  type PrototypePreviewOpener,
} from '../panels/preview/prototypePreview';
import { SessionRecoveryStore } from '../recovery/SessionRecoveryStore';
import type { ReviewCoordinator } from '../review/reviewCoordinator';
import type { TerminalMirror } from '../terminal/terminalMirror';
import {
  createUnavailableExternalUrlOpener,
  type ExternalUrlOpener,
} from '../workspace/externalUrlOpener';
import { createUnavailableGitWorkflow, type GitWorkflow } from '../workspace/gitWorkflow';
import { createUnavailablePathOpener, type PathOpener } from '../workspace/pathOpener';
import { type WorktreeSessionsFeature } from '../workspace/worktreeSessions';
import { stageCapturedSelectionOutcome } from './attachments/attachments';
import { AttachmentStagingState } from './attachments/AttachmentStagingState';
import { replayControllerTo } from './browserReplay';
import { RecentCommandsStore } from './capabilities/RecentCommandsStore';
import { SessionMetadataState } from './capabilities/sessionMetadataState';
import { createChatEffects } from './chatEffects';
import { dispatchChatMessage } from './dispatchChatMessage';
import { buildHostSnapshot } from './hostSnapshot';
import { readControllerIde, type NativeIdeBackend } from './ideIntegration';
import type {
  ChatControllerListener,
  ControllerHostMessage,
  DroidRuntimeFactory,
  UnsequencedHostMessage,
  WorkspaceContextProvider,
} from './hostTypes';
import {
  createEmptySessionCatalog,
  createTransientRecoveryStore,
  isUsableWorkspace,
  type DisposableSubscription,
} from './internals';
import type { MissionGateway } from './mission/MissionGateway';
import { MissionSessionState } from './mission/MissionSessionState';
import { emitMissionSetupCapabilities } from './mission/setupProjection';
import { type CustomModelsGateway } from './models/customModels';
import { CustomModelState } from './models/CustomModelState';
import type { CustomModelDiscoveryGateway } from './models/modelDiscovery';
import type { ProviderRegistry } from './models/providerRegistry';
import {
  evaluateUserPanelRequest,
  type UserPanelRequestDropReason,
} from './operationEligibility';
import { QueueState } from './queue/QueueState';
import { ConversationRecoveryState } from './recovery/ConversationRecoveryState';
import { checkpointRecoveryTranscript } from './recovery/recovery';
import {
  closeAllRuntimesForDispose,
  emitWorkspaceUnavailable,
  ensureActiveRuntimeWorkspaceCurrent,
  isCurrentRuntime,
  isSameWorkspaceContext,
  isTargetWorkspaceCurrent,
  queueWorkspaceTransition,
  resetSessionMetadata,
  WORKSPACE_CHANGED_MESSAGE,
} from './sessions/runtimeLifecycle';
import { bindCatalogViewToWorkspace, clearCatalog } from './sessions/sessionCatalog';
import { SessionDirectoryState } from './sessions/SessionDirectoryState';
import { SessionLifecycleState } from './sessions/SessionLifecycleState';
import { clearZombieSubagentWatch } from './subagents/subagentWatch';
import { SubagentWatchState } from './subagents/SubagentWatchState';
import { projectTranscript } from './turns/turnFlow';
import { TurnState } from './turns/TurnState';
import { clearTurnWatchdog } from './turns/turnWatchdog';
export type {
  ChatControllerListener,
  ControllerHostMessage,
  DroidRuntimeFactory,
  UnsequencedHostMessage,
  WorkspaceContext,
  WorkspaceContextProvider,
} from './hostTypes';
export class ChatController {
  readonly sessionState: SessionLifecycleState;
  readonly catalogState = new SessionDirectoryState();
  readonly turnState = new TurnState();
  readonly attachmentState = new AttachmentStagingState();
  readonly queueState = new QueueState();
  readonly recoveryState = new ConversationRecoveryState();
  readonly missionState = new MissionSessionState();
  readonly subagentState = new SubagentWatchState();
  readonly customModelState = new CustomModelState();
  readonly effects = createChatEffects(this);

  readonly listeners = new Set<ChatControllerListener>();
  readonly interactions: PendingInteractionCoordinator;
  /** Token-usage breakdown of the active session: cumulative totals
   * seeded from history and overwritten by live `token-usage`
   * events; `lastTurn` set by each completed turn in this window.
   */
  readonly metadata = new SessionMetadataState();
  sequence = -1;
  nativeIde?: NativeIdeBackend;
  ideReconnectInProgress = false;
  ideReconnectError: { sessionId: string; message: string } | null = null;
  readIdeState() { return readControllerIde(this); }
  daemonCustomModels?: () => Promise<CustomModelsGateway>;
  modelDiscovery?: CustomModelDiscoveryGateway;
  providerRegistry?: ProviderRegistry;
  promptProviderApiKey?: () => Thenable<string | undefined>;
  /** Hidden-fork side chat; null when no sidecar factory is wired. */
  readonly btwSideChat: BtwSideChat | null;
  constructor(
    readonly createRuntime: DroidRuntimeFactory,
    readonly getWorkspaceContext: WorkspaceContextProvider,
    readonly sessionCatalog: SessionCatalog = createEmptySessionCatalog(),
    readonly recoveryStore: SessionRecoveryStore = createTransientRecoveryStore(),
    readonly sessionHistory: SessionHistoryLoader = createUnavailableSessionHistoryLoader(),
    readonly attachmentSources: AttachmentSources = createUnavailableAttachmentSources(),
    readonly fileDiff: FileDiffOpener = createUnavailableFileDiffOpener(),
    readonly changeStats: ChangeStatsReader = createUnavailableChangeStatsReader(),
    readonly externalUrl: ExternalUrlOpener = createUnavailableExternalUrlOpener(),
    readonly recentCommands: RecentCommandsStore = new RecentCommandsStore(),
    readonly diagnostics?: RuntimeDiagnosticSink,
    readonly daemonSessions?: () => Promise<DaemonSessionCatalog>,
    readonly pathOpener: PathOpener = createUnavailablePathOpener(),
    readonly prototypePreview: PrototypePreviewOpener = createUnavailablePrototypePreviewOpener(),
    readonly gitWorkflow: GitWorkflow = createUnavailableGitWorkflow(),
    readonly worktreeSessions?: WorktreeSessionsFeature,
    readonly terminalMirror?: TerminalMirror,
    readonly daemonPlugins?: () => Promise<DaemonPluginCatalog>,
    btwSidecarFactory?: BtwSidecarFactory,
    readonly missionGateway?: MissionGateway,
    readonly turnSnapshots?: TurnSnapshotStore,
    readonly planDocuments: PlanDocumentGateway = createUnavailablePlanDocumentGateway(),
    readonly reviewCoordinator?: ReviewCoordinator,
  ) {
    this.sessionState = new SessionLifecycleState({ ...this.getWorkspaceContext() });
    this.recoveryStore.setBackgroundFlushFailureReporter(() => {
      this.recordHost({
        level: 'warn',
        name: 'host.recovery.checkpoint-failed',
        attributes: { outcome: 'failed' },
      });
    });
    // Mode-agnostic since the daemon port (side-question-design.md
    // §5.2, probe-btw-daemon.mjs): without a factory the snapshot
    // never advertises btwAvailable, so the webview entry stays
    // hidden (fail closed).
    this.btwSideChat =
      btwSidecarFactory === undefined
        ? null
        : new BtwSideChat(btwSidecarFactory, (sessionId, btw) => {
            this.emit({ type: 'session.btw', sessionId, btw });
          });
    this.interactions = new PendingInteractionCoordinator(
      ({ sessionId, turnId, request }) => {
        if (!ensureActiveRuntimeWorkspaceCurrent(this)) {
          return;
        }
        this.turnState.interactionOpenedAt.set(request.requestId, performance.now());
        this.recordHost({
          level: 'info',
          name: 'host.interaction.opened',
          attributes: {
            kind: request.kind,
            requestId: request.requestId,
          },
        });
        if (request.kind === 'permission') {
          this.planDocuments.track(sessionId, turnId, request);
        }
        this.emit({
          type: 'interaction.request',
          sessionId,
          turnId,
          request,
        });
      },
      ({ sessionId, turnId, requestId, result }) => {
        this.planDocuments.settle(requestId);
        const openedAt = this.turnState.interactionOpenedAt.get(requestId);
        this.turnState.interactionOpenedAt.delete(requestId);
        this.recordHost({
          level: 'info',
          name: 'host.interaction.closed',
          attributes: {
            requestId,
            ...(openedAt === undefined
              ? {}
              : {
                  pendingMs: Math.round(performance.now() - openedAt),
                }),
          },
        });
        this.emit({
          type: 'interaction.closed',
          sessionId,
          turnId,
          requestId,
          ...(result === undefined ? {} : { result }),
        });
      },
    );
  }
  subscribe(listener: ChatControllerListener): DisposableSubscription {
    if (this.sessionState.disposed) {
      return { dispose() {} };
    }
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }
  handleMessage(message: WebviewToHostMessage): void {
    if (this.sessionState.disposed) return;
    switch (message.type) {
      case 'btw.prepare':
        this.handleBtwPrepare(message.sessionId);
        return;
      case 'btw.ask':
        this.handleBtwAsk(message.sessionId, message.text);
        return;
      default:
        dispatchChatMessage(this, message);
    }
  }
  handleWorkspaceContextChanged(): void {
    if (this.sessionState.disposed) {
      return;
    }
    const workspace = this.getWorkspaceContext();
    if (isSameWorkspaceContext(this.sessionState.workspaceContext, workspace)) {
      return;
    }
    this.sessionState.workspaceContext = { ...workspace };
    if (this.sessionState.initialization === null) {
      return;
    }
    const generation = ++this.sessionState.workspaceContextGeneration;
    const staleRuntimes = [...this.sessionState.managedRuntimes];
    this.sessionState.runtimeGeneration += 1;
    this.turnState.turnGeneration += 1;
    resetSessionMetadata(this);
    if (
      this.recoveryState.recoveryCheckpointTimer !== null ||
      this.recoveryState.pendingRecoveryCheckpoint !== null
    ) {
      checkpointRecoveryTranscript(this);
    }
    this.sessionState.runtime = null;
    this.sessionState.activeRuntimeCwd = null;
    this.turnState.turn = null;
    this.interactions.cancelAll();
    if (isUsableWorkspace(workspace)) {
      bindCatalogViewToWorkspace(this, workspace.cwd);
      this.sessionState.connection = {
        status: 'unavailable',
        message: WORKSPACE_CHANGED_MESSAGE,
      };
      this.emitSnapshot();
    } else {
      clearCatalog(this);
      emitWorkspaceUnavailable(this, workspace);
    }
    queueWorkspaceTransition(this, generation, staleRuntimes);
  }
  /**
   * Editor-side entry for `droidvisx.addSelectionToChat`: stages a
   * selection the command captured at invoke time, through the same
   * pipeline as the webview `+` menu (mutual exclusion, staging
   * limit, dedupe, and diagnostic semantics included). Returns false
   * while no connected session can accept it yet, so the command
   * keeps the capture and retries until the cold-starting view
   * connects (QA v0.3 P1-1).
   */
  stageCapturedEditorSelection(outcome: AttachmentCaptureOutcome): boolean {
    if (this.sessionState.disposed || this.sessionState.sessionId === null) {
      return false;
    }
    return stageCapturedSelectionOutcome(this, this.sessionState.sessionId, outcome);
  }
  dispose(): Promise<void> {
    if (this.sessionState.disposal) {
      return this.sessionState.disposal;
    }
    checkpointRecoveryTranscript(this);
    this.interactions.cancelAll();
    this.btwSideChat?.reset();
    this.metadata.dispose();
    clearZombieSubagentWatch(this);
    clearTurnWatchdog(this);
    this.fileDiff.dispose?.();
    this.turnState.turn?.changesLedger?.cancel();
    this.changeStats.dispose?.();
    const snapshotDisposal = this.turnSnapshots?.dispose();
    this.reviewCoordinator?.dispose();
    this.planDocuments.dispose();
    this.sessionState.disposed = true;
    this.sessionState.runtimeGeneration += 1;
    this.turnState.turnGeneration += 1;
    this.customModelState.customModelsDiscoveryAbort?.abort();
    this.customModelState.customModelsDiscoveryAbort = null;
    this.listeners.clear();
    // Detaches a running daemon-side turn instead of interrupting it
    // (Reload survival); see closeAllRuntimesForDispose.
    this.sessionState.disposal = Promise.all([
      closeAllRuntimesForDispose(this),
      snapshotDisposal ?? Promise.resolve(),
    ]).then(() => undefined);
    return this.sessionState.disposal;
  }
  emitSnapshot(): void {
    this.emit(buildHostSnapshot(this));
  }
  async replayTo(listener: ChatControllerListener): Promise<void> {
    return replayControllerTo(this, listener);
  }
  recordHost(event: RuntimeDiagnosticEvent): void {
    try {
      this.diagnostics?.record(event);
    } catch {
      // Diagnostics must never alter controller behavior.
    }
  }
  emit(message: UnsequencedHostMessage): void {
    if (this.sessionState.disposed) {
      return;
    }
    const withSequence = this.stamp(message);
    if (this.turnState.turnIo !== null) {
      this.turnState.turnIo.counts.set(
        message.type,
        (this.turnState.turnIo.counts.get(message.type) ?? 0) + 1,
      );
      try {
        this.turnState.turnIo.bytes += JSON.stringify(withSequence).length;
      } catch {
        // Unserializable messages still count by type.
      }
    }
    projectTranscript(this, withSequence);
    for (const listener of this.listeners) {
      listener(withSequence);
    }
  }
  emitTo(listener: ChatControllerListener, message: UnsequencedHostMessage): void {
    if (!this.sessionState.disposed) {
      listener(this.stamp(message));
    }
  }
  private stamp(message: UnsequencedHostMessage): ControllerHostMessage {
    return {
      ...message,
      sequence: this.nextSequence(),
    } as ControllerHostMessage;
  }
  /**
   * Names the first guard that would drop a webview panel request for
   * the given session, or null when the request may proceed. Mirrors
   * the guard chain the MCP/Skills handlers share; the caller must
   * treat a non-null reason as a hard stop.
   */
  ensureWorkspaceCurrent(): boolean {
    return ensureActiveRuntimeWorkspaceCurrent(this);
  }
  hasPendingInteractions(): boolean {
    return this.interactions.hasPending();
  }
  metadataChanged(): void {
    emitMissionSetupCapabilities(this);
  }
  sessionRequestDropReason(sessionId: string): UserPanelRequestDropReason | null {
    const eligibility = evaluateUserPanelRequest({
      requestedSessionId: sessionId,
      activeSessionId: this.sessionState.sessionId,
      runtime: this.sessionState.runtime,
      connectionStatus: this.sessionState.connection.status,
      sessionOperationInProgress: this.sessionState.sessionOperationInProgress,
      runtimeGeneration: this.sessionState.runtimeGeneration,
      activeRuntimeCwd: this.sessionState.activeRuntimeCwd,
      isWorkspaceCurrent: () => ensureActiveRuntimeWorkspaceCurrent(this),
    });
    return eligibility.kind === 'blocked' ? eligibility.reason : null;
  }
  /**
   * Logs a panel request the guard chain dropped. These drops used to
   * be fully silent, which made a swallowed "Add MCP server" request
   * indistinguishable from a successful one.
   */
  recordDroppedPanelRequest(op: string, reason: string): void {
    this.recordHost({
      level: 'warn',
      name: 'host.ui.request-dropped',
      attributes: { op, reason },
    });
  }
  /**
   * Mirrors a panel-level business failure into the local log. Panel
   * failures render only inside the Skills/MCP popovers, so without
   * this they leave no trace once the popover closes.
   */
  recordPanelFailure(code: string, detail: string): void {
    this.recordHost({
      level: 'warn',
      name: 'host.ui.diagnostic',
      attributes: { code },
      detail,
    });
  }
  emitSessionDiagnostic(
    code: string,
    message: string,
    turnId: string | null = null,
  ): void {
    // Mirror UI-facing business failures into the local log; without
    // this they vanish whenever the webview is closed or broken.
    this.recordHost({
      level: 'warn',
      name: 'host.ui.diagnostic',
      attributes: { code },
      detail: message,
    });
    this.emit({
      type: 'runtime.diagnostic',
      sessionId: this.sessionState.sessionId,
      turnId,
      severity: 'warning',
      code,
      message,
    });
  }
  private nextSequence(): number {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('DroidVisX host message sequence was exhausted.');
    }
    this.sequence += 1;
    return this.sequence;
  }
  isCurrentSessionOperation(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): boolean {
    return (
      isCurrentRuntime(this, runtime, generation) &&
      this.sessionState.sessionId === sessionId &&
      this.sessionState.activeRuntimeCwd === cwd &&
      isTargetWorkspaceCurrent(this, cwd)
    );
  }
  private handleBtwAsk(sessionId: string, text: string): void {
    this.withBtwSession(
      sessionId,
      (sideChat, cwd) => void sideChat.handleAsk(cwd, sessionId, text),
    );
  }
  private handleBtwPrepare(sessionId: string): void {
    this.withBtwSession(
      sessionId,
      (sideChat, cwd) => void sideChat.handlePrepare(cwd, sessionId),
    );
  }
  private withBtwSession(
    sessionId: string,
    run: (sideChat: BtwSideChat, cwd: string) => void,
  ): void {
    const sideChat = this.btwSideChat;
    if (sideChat === null || sessionId !== this.sessionState.sessionId) {
      return;
    }
    const cwd = this.sessionState.activeRuntimeCwd;
    if (cwd === null || !isTargetWorkspaceCurrent(this, cwd)) {
      return;
    }
    run(sideChat, cwd);
  }
}
