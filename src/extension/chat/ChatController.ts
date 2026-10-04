import type { SessionCatalog } from '../../runtime/catalog/SessionCatalog';
import type { DisabledModelsStore } from '../models/DisabledModelsStore';
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
import type { BtwAskOptions } from '../../shared/protocol/btwProtocol';
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
import { bindChatSharedServices, type ChatSharedServices } from './chatSharedServices';
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
import { closeAllRuntimesForDispose } from './sessions/sessionCleanup';
import { ensureActiveRuntimeWorkspaceCurrent, handleWorkspaceContextChanged } from './sessions/workspaceLifecycle';
import { isCurrentRuntime, isTargetWorkspaceCurrent } from './sessions/sessionGuards';
import { SessionDirectoryState } from './sessions/SessionDirectoryState';
import { SessionLifecycleState } from './sessions/SessionLifecycleState';
import { clearZombieSubagentWatch } from './subagents/subagentWatch';
import { SubagentWatchState } from './subagents/SubagentWatchState';
import { projectTranscript } from './turns/turnRuntimeEvents';
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
export interface ChatControllerDependencies {
  readonly createRuntime: DroidRuntimeFactory;
  readonly getWorkspaceContext: WorkspaceContextProvider;
  readonly sessionCatalog?: SessionCatalog;
  readonly recoveryStore?: SessionRecoveryStore;
  readonly sessionHistory?: SessionHistoryLoader;
  readonly attachmentSources?: AttachmentSources;
  readonly fileDiff?: FileDiffOpener;
  readonly changeStats?: ChangeStatsReader;
  readonly externalUrl?: ExternalUrlOpener;
  readonly recentCommands?: RecentCommandsStore;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly daemonSessions?: () => Promise<DaemonSessionCatalog>;
  readonly pathOpener?: PathOpener;
  readonly prototypePreview?: PrototypePreviewOpener;
  readonly gitWorkflow?: GitWorkflow;
  readonly worktreeSessions?: WorktreeSessionsFeature;
  readonly terminalMirror?: TerminalMirror;
  readonly daemonPlugins?: () => Promise<DaemonPluginCatalog>;
  readonly btwSidecarFactory?: BtwSidecarFactory;
  readonly missionGateway?: MissionGateway;
  readonly turnSnapshots?: TurnSnapshotStore;
  readonly planDocuments?: PlanDocumentGateway;
  readonly reviewCoordinator?: ReviewCoordinator;
  readonly childSession?: { readonly sessionId: string; readonly cwd: string };
  readonly sharedServices?: ChatSharedServices;
}
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
  modelAvailability?: DisabledModelsStore;
  nativeIde?: Pick<NativeIdeBackend, 'read'> & Partial<Pick<NativeIdeBackend, 'reconnect'>>;
  ideReconnectInProgress = false;
  ideReconnectError: { sessionId: string; message: string } | null = null;
  readIdeState() { return readControllerIde(this); }
  daemonCustomModels?: () => Promise<CustomModelsGateway>;
  modelDiscovery?: CustomModelDiscoveryGateway;
  systemPromptStore?: import('./capabilities/systemPrompt').SystemPromptStore;
  providerRegistry?: ProviderRegistry;
  promptProviderApiKey?: () => Thenable<string | undefined>;
  /** Hidden-fork side chat; null when no sidecar factory is wired. */
  readonly btwSideChat: BtwSideChat | null;
  readonly createRuntime: DroidRuntimeFactory;
  readonly getWorkspaceContext: WorkspaceContextProvider;
  readonly sessionCatalog: SessionCatalog;
  readonly recoveryStore: SessionRecoveryStore;
  readonly sessionHistory: SessionHistoryLoader;
  readonly attachmentSources: AttachmentSources;
  readonly fileDiff: FileDiffOpener;
  readonly changeStats: ChangeStatsReader;
  readonly externalUrl: ExternalUrlOpener;
  readonly recentCommands: RecentCommandsStore;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly daemonSessions?: () => Promise<DaemonSessionCatalog>;
  readonly pathOpener: PathOpener;
  readonly prototypePreview: PrototypePreviewOpener;
  readonly gitWorkflow: GitWorkflow;
  readonly worktreeSessions?: WorktreeSessionsFeature;
  readonly terminalMirror?: TerminalMirror;
  readonly daemonPlugins?: () => Promise<DaemonPluginCatalog>;
  readonly missionGateway?: MissionGateway;
  readonly turnSnapshots?: TurnSnapshotStore;
  readonly planDocuments: PlanDocumentGateway;
  readonly reviewCoordinator?: ReviewCoordinator;
  readonly childSession?: { readonly sessionId: string; readonly cwd: string };
  readonly sharedServices: ChatSharedServices;
  private readonly sharedServicesSubscription?: DisposableSubscription;

  constructor(dependencies: ChatControllerDependencies) {
    this.createRuntime = dependencies.createRuntime;
    this.getWorkspaceContext = dependencies.getWorkspaceContext;
    this.sessionCatalog = dependencies.sessionCatalog ?? createEmptySessionCatalog();
    this.recoveryStore = dependencies.recoveryStore ?? createTransientRecoveryStore();
    this.sessionHistory = dependencies.sessionHistory ?? createUnavailableSessionHistoryLoader();
    this.attachmentSources = dependencies.attachmentSources ?? createUnavailableAttachmentSources();
    this.fileDiff = dependencies.fileDiff ?? createUnavailableFileDiffOpener();
    this.changeStats = dependencies.changeStats ?? createUnavailableChangeStatsReader();
    this.externalUrl = dependencies.externalUrl ?? createUnavailableExternalUrlOpener();
    this.recentCommands = dependencies.recentCommands ?? new RecentCommandsStore();
    this.diagnostics = dependencies.diagnostics;
    this.daemonSessions = dependencies.daemonSessions;
    this.pathOpener = dependencies.pathOpener ?? createUnavailablePathOpener();
    this.prototypePreview = dependencies.prototypePreview ?? createUnavailablePrototypePreviewOpener();
    this.gitWorkflow = dependencies.gitWorkflow ?? createUnavailableGitWorkflow();
    this.worktreeSessions = dependencies.worktreeSessions;
    this.terminalMirror = dependencies.terminalMirror;
    this.daemonPlugins = dependencies.daemonPlugins;
    this.missionGateway = dependencies.missionGateway;
    this.turnSnapshots = dependencies.turnSnapshots;
    this.planDocuments = dependencies.planDocuments ?? createUnavailablePlanDocumentGateway();
    this.reviewCoordinator = dependencies.reviewCoordinator;
    this.childSession = dependencies.childSession;
    this.sharedServices = dependencies.sharedServices ?? {};
    const { btwSidecarFactory } = dependencies;
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
          }, async (modelId) => {
            const selected = modelId ?? this.metadata.settings.value?.modelId;
            if (selected !== undefined) await this.modelAvailability?.assertEnabled(selected);
            return selected;
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
      (sessionId) => sessionId === this.sessionState.sessionId
        ? this.metadata.settings.value?.autonomyLevel : undefined,
    );
    this.sharedServicesSubscription = bindChatSharedServices(this, this.sharedServices);
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
        this.handleBtwAsk(message.sessionId, message.text, {
          images: message.images, modelId: message.modelId, reasoningEffort: message.reasoningEffort,
        });
        return;
      default:
        dispatchChatMessage(this, message);
    }
  }
  handleWorkspaceContextChanged(): void {
    handleWorkspaceContextChanged(this);
  }
  /** Stages an already captured selection when a connected chat can accept attachments. */
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
    this.sharedServicesSubscription?.dispose();
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
      throw new Error('Droid host message sequence was exhausted.');
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
  private handleBtwAsk(sessionId: string, text: string, options: BtwAskOptions): void {
    if (sessionId !== this.sessionState.sessionId) return;
    const modelId = options.modelId ?? this.metadata.settings.value?.modelId;
    const model = this.metadata.modelCatalog.items.find((item) => item.id === modelId);
    if (this.metadata.modelCatalog.status !== 'ready' || model === undefined || model.disabled ||
        (options.images?.length && !model.supportsImages)) {
      this.emitSessionDiagnostic('settings-update-unsupported', model?.disabled
        ? model.disabledReason! : model && options.images?.length && !model.supportsImages
          ? 'This model does not support images. Remove the images or choose another model.'
          : 'Load the model catalog and choose an available model before sending a side question.');
      return;
    }
    if (options.reasoningEffort !== undefined && !model.supportedReasoningEfforts.includes(options.reasoningEffort)) {
      this.emitSessionDiagnostic('settings-update-unsupported', 'Choose a reasoning effort supported by the side conversation model.');
      return;
    }
    this.withBtwSession(sessionId, (sideChat, cwd) => void sideChat.handleAsk(cwd, sessionId, text, {
      ...options, modelId: model.id, reasoningEffort: options.reasoningEffort ?? model.defaultReasoningEffort,
    }));
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
