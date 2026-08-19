import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArchivedSessionSummary,
  AttachmentKind,
  AttachmentStage,
  AttachmentSummary,
  CommandSummary,
  EditAttachmentSummary,
  EditResendRejectReason,
  SentAttachmentSummary,
  ConnectionState,
  ConfirmedSessionSettings,
  HostToWebviewMessage,
  ImageMediaType,
  ImageTranscriptItem,
  ModelCatalogState,
  SessionCatalogState,
  SessionCommandsState,
  SessionContextState,
  SessionContextStats,
  McpAuthPhase,
  McpServerAddMessage,
  McpServerSummary,
  SessionMcpState,
  SessionMissionSummary,
  PluginScope,
  PluginSummary,
  SessionPluginsState,
  SessionSettingUpdateMessage,
  SessionSettingsState,
  SessionSkillsState,
  SessionSummary,
  SkillSummary,
  TurnStatus,
  WebviewToHostMessage,
  WorkspaceFilesStatus,
  WorkspaceImageStatus,
} from '../shared/bridgeMessages';
import {
  MAX_ARCHIVED_SESSION_ITEMS,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_FILE_SEARCH_RESULTS,
  MAX_IMAGE_DATA_LENGTH,
  MAX_MODEL_CATALOG_ITEMS,
  MAX_PENDING_ATTACHMENTS,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_PLUGIN_ID_LENGTH,
  MAX_PLUGIN_ITEMS,
  MAX_PLUGIN_MARKETPLACE_COUNT,
  MAX_PLUGIN_VERSION_LENGTH,
  PLUGIN_SCOPES,
  MAX_SESSION_CATALOG_ITEMS as SESSION_CATALOG_LIMIT,
  MAX_SESSION_SEARCH_RESULTS,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
} from '../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeAttachment,
  RuntimeCommand,
  RuntimeModelCatalog,
  RuntimeModelCatalogItem,
  RuntimeSessionSettings,
  RuntimeMcpServer,
  RuntimeSessionSettingUpdate,
  RuntimeSessionTarget,
  RuntimeSessionWorkingState,
  RuntimeSkill,
} from '../runtime/DroidRuntime';
import type {
  RuntimeAvailability,
  RuntimeEvent,
} from '../runtime/runtimeEvents';
import type { RuntimeInteractionHandler } from '../runtime/runtimeInteractions';
import type {
  RuntimeDiagnosticEvent,
  RuntimeDiagnosticSink,
} from '../runtime/runtimeDiagnostics';
import type {
  SessionCatalog,
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../runtime/SessionCatalog';
import { DaemonAvailabilityError } from '../runtime/daemon/daemonConnection';
import type {
  DaemonPluginCatalog,
  InstalledPluginEntry,
} from '../runtime/daemon/DaemonPluginCatalog';
import type { DaemonSessionCatalog } from '../runtime/daemon/DaemonSessionCatalog';
import {
  createUnavailableSessionHistoryLoader,
  type SessionHistoryLoader,
} from '../runtime/history/SessionHistory';
import { applySubagentSettlement, collectRunningSubagentRows, collectToolFilePaths, collectTranscriptSubagentRows, createTurnActivityState, hasSubagentRows, projectAssistantDelta, projectSubagentStarted, projectThinkingComplete, projectThinkingDelta, projectToolEvent, reconcileSubagentSummaries, settleZombieSubagents, thinkingSegmentKey, type PendingSubagentRow, type TurnActivityState } from './turnActivityState';
import { handleQueueAdd, handleQueueUpdate, handleQueueRemove, handleQueueResume, handleQueuePromote, handleQueueClear, settleQueueAfterTurn, projectQueueState, discardQueuedPrompts } from './chat/queue';
import { handleMcpRefresh, pushMcp, handleMcpServerToggle, handleMcpServerAdd, handleMcpServerRemove, handleMcpServerAuthenticate } from './chat/mcp';
import { dispatchCustomModels, type CustomModelsGateway } from './chat/customModels'; import type { CustomModelDiscoveryGateway } from './chat/modelDiscovery'; import type { ProviderRegistry } from './chat/providerRegistry';
import { handleContextRefresh, refreshContext, updateTokenUsage, handleSkillsRefresh, pushSkills, handleSkillToggle, handlePluginsRefresh, handleCommandsRefresh, recordRecentCommand, emitModelCatalog, projectModelCatalog, MODEL_CATALOG_FAILED_MESSAGE } from './chat/capabilityPanels';
import { handleAttachmentPick, handleAttachmentCapture, handleAttachmentAddPath, handleAttachmentAddImage, handleAttachmentAddUris, handleAttachmentAddTextFile, handleAttachmentRemove, stageCapturedSelectionOutcome, takePendingAttachments, clearPendingAttachments, retainSentAttachments, emitEditAttachments, echoUserImageAttachments, sentAttachmentSummaries } from './chat/attachments';
import { handleSettingUpdate, emitSettings, refreshSettingsAfterRuntimeEvent, projectConfirmedSettings, SETTINGS_READ_FAILED_MESSAGE } from './chat/settings';
import { handleFileOpenDiff, handleFilePreview, handleInlineHtmlPreview, handleTerminalOpenMirror, handleGitRequestStatus, handleGitCommit, handleWorkspaceOpenPath, handleWorkspaceSearchFiles, handleWorkspaceReadImage } from './chat/workspaceActions';
import { handleRewindInfo, handleEditResend, handleEditStageBegin, handleEditStageCancel } from './chat/editResend';
import { stampRunningFlags, setSessionRunning, ensureBackgroundRunningPoll, seedBackgroundRunning } from './chat/sessionRunning';
import { settleTurnSubagents, clearZombieSubagentWatch, armReplayedSubagentWatch } from './chat/subagentWatch';
import { clearTurnWatchdog, type TurnWatchdogState } from './chat/turnWatchdog';
import { handleSubagentPanel } from './chat/subagentPanel';
import type { SubagentControlGateway } from '../runtime/subagentControl';
import { emitEarlyRecoverySnapshot, reconcileDaemonTurn, scheduleRecoveryCheckpoint, checkpointRecoveryTranscript, flushRecoveryCheckpoint, recoveryTurnId } from './chat/recovery';
import { handleSessionNew, handleWorktreeCreateSession, handleSessionRename, handleSessionFavorite, handleSessionArchive, handleSessionUnarchive, handleArchivedRefresh, handleSessionSearch, handleSessionSelect, handleRefresh, handleSessionFork, loadCatalog, hasCatalogSession, activeSessionSummary, withActiveSession, beginCatalogLoad, bindCatalogViewToWorkspace, clearCatalog, isCurrentCatalogRequest, discardCatalogRequest, touchActiveSession, SESSION_NEW_FAILED_MESSAGE } from './chat/sessionDirectory';
import { handleReady, startReplacement, replaceRuntime, loadHistoryTimed, resetSessionMetadata, closeAllRuntimesForDispose, queueWorkspaceTransition, isCurrentRuntime, ensureActiveRuntimeWorkspaceCurrent, isTargetWorkspaceCurrent, emitWorkspaceUnavailable, isSameWorkspaceContext, WORKSPACE_CHANGED_MESSAGE } from './chat/runtimeLifecycle';
import { handleSend, handleStop, handleRetry, handleSessionCompact, projectTranscript } from './chat/turnFlow';
import { handleMissionCommand, handleMissionStart } from './chat/mission/controller';
import type { MissionGateway } from './chat/mission/MissionGateway';
import type { MissionSnapshotReducer } from './chat/mission/MissionSnapshotReducer';
import { PendingInteractionCoordinator } from './pendingInteractionCoordinator';
import { clearPrompts, dropDispatchedPrompt, emptyQueuedPromptsState, enqueuePrompt, evaluateQueueDispatch, markDispatchBlocked, pauseAfterTerminal, promotePrompt, removePrompt, resumeQueue, updatePromptText, type QueuedPromptsState } from './queuedPromptsState';
import type { SessionQueueState } from '../shared/queueProtocol';
import {
  SESSION_RECOVERY_DEBOUNCE_MS,
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import {
  appendAcceptedUserPrompt,
  appendTurnChanges,
  attachUserMessageId,
  createHostTranscriptState,
  projectHostTranscriptMessage,
  stableTranscriptId,
  truncateFromUserMessage,
  type HostTranscriptProjectionMessage,
  type HostTranscriptState,
} from './hostTranscriptState';
import {
  createUnavailableChangeStatsReader,
  type ChangeStatsReader,
} from './changeStats';
import { base64ByteLength } from '../shared/transcriptLimits';
import {
  EMPTY_SESSION_TOKEN_USAGE,
  type SessionTokenUsageState,
  type TokenUsageBreakdown,
} from '../shared/tokenUsage';
import { reconcileSessionHistory } from './reconcileSessionHistory';
import { BtwSideChat, type BtwSidecarFactory } from './btwSideChat';
import { isSafeWorkspaceRelativePath } from '../shared/validateMessage';
import { isExecuteToolName } from '../shared/toolOutput';
import type { TerminalMirror } from './terminalMirror';
import {
  createUnavailableAttachmentSources,
  MAX_IMAGE_ATTACHMENT_BYTES,
  type AttachmentCaptureOutcome,
  type AttachmentPayload,
  type AttachmentPickOutcome,
  type AttachmentSources,
} from './attachmentSources';
import {
  createUnavailableFileDiffOpener,
  type FileDiffOpener,
} from './fileDiffOpener';
import {
  createUnavailablePathOpener,
  type PathOpener,
} from './pathOpener';
import {
  createUnavailablePrototypePreviewOpener,
  type PrototypePreviewOpener,
} from './prototypePreview';
import {
  createUnavailableGitWorkflow,
  type GitWorkflow,
} from './gitWorkflow';
import {
  appendWorktreeSessions,
  recordCreatedWorktreeSession,
  type WorktreeSessionsFeature,
} from './worktreeSessions';
import { MAX_GIT_COMMIT_SUBJECT_LENGTH } from '../shared/gitCommitFlow';
import {
  createUnavailableExternalUrlOpener,
  type ExternalUrlOpener,
} from './externalUrlOpener';
import { RecentCommandsStore } from './RecentCommandsStore';
import {
  createEmptySessionCatalog,
  DAEMON_NOT_LOGGED_IN_MESSAGE,
  DAEMON_UNAVAILABLE_MESSAGE,
  createTransientRecoveryStore,
  delay,
  forkTitleFromText,
  formatUnknownError,
  daemonFailureMessage,
  isEnumValue,
  isSafeBridgeId,
  SESSION_OPERATION_BLOCKED_MESSAGE,
  isTranscriptProjection,
  isUsableWorkspace,
  type CurrentTurn,
  type DisposableSubscription,
  type EditStage,
  type EditStagedAttachment,
  type PendingAttachment,
} from './chat/internals';
export type DroidRuntimeFactory = (
  interactionHandler: RuntimeInteractionHandler,
) => DroidRuntime;
export interface WorkspaceContext {
  readonly cwd: string | null;
  readonly trusted: boolean;
}
export type WorkspaceContextProvider = () => WorkspaceContext;
/** Everything the controller emits; the view provider's sequence-free
    `ui.theme` push never passes the sequence stamper below. */
export type ControllerHostMessage =
  Exclude<HostToWebviewMessage, { type: 'ui.theme' }>;
export type ChatControllerListener = (
  message: ControllerHostMessage,
) => void;
type UnsequencedHostMessage =
  ControllerHostMessage extends infer Message
    ? Message extends ControllerHostMessage
      ? Omit<Message, 'sequence'>
      : never
    : never;
export class ChatController {
  readonly listeners = new Set<ChatControllerListener>();
  readonly interactions: PendingInteractionCoordinator;
  runtime: DroidRuntime | null = null;
  connection: ConnectionState = { status: 'idle' };
  sessions: SessionCatalogState = {
    status: 'idle',
    items: [],
  };
  transcript: HostTranscriptState =
    createHostTranscriptState('unavailable');
  sessionId: string | null = null;
  /** Daemon subagent control provider; extension.ts injects it. */
  subagentControl: (() => SubagentControlGateway | null) | null = null;
  /** Read-only mission identity of the active session, from the last
   * successful history load; null for sessions outside a mission.
   */
  mission: SessionMissionSummary | null = null;
  missionRuntime: MissionSnapshotReducer | null = null;
  /** Token-usage breakdown of the active session: cumulative totals
   * seeded from history and overwritten by live `token-usage`
   * events; `lastTurn` set by each completed turn in this window.
   */
  tokenUsage: SessionTokenUsageState = EMPTY_SESSION_TOKEN_USAGE;
  turn: CurrentTurn | null = null;
  settings: SessionSettingsState = {
    status: 'loading',
    value: null,
  };
  context: SessionContextState = {
    status: 'loading',
    value: null,
  };
  modelCatalog: ModelCatalogState = {
    status: 'loading',
    items: [],
  };
  sequence = -1;
  runtimeGeneration = 0;
  turnGeneration = 0;
  contextGeneration = 0;
  settingsUpdate: symbol | null = null;
  /** Prevents duplicate Mission creation while the Host gateway settles. */
  missionStartInProgress = false;
  catalogGeneration = 0;
  catalogCwd: string | null = null;
  /**
   * True when the current workspace may create worktree sessions:
   * daemon runtime mode (worktreeSessions.enabled) and a git
   * workspace. Recomputed per catalog cwd binding; snapshots only
   * advertise it while true (fail closed).
   */
  worktreeCreateAvailable = false;
  /** Workspace cwd the availability check was computed for. */
  worktreeAvailabilityCwd: string | null = null;
  activeRuntimeCwd: string | null = null;
  initialization: Promise<void> | null = null;
  workspaceContext: WorkspaceContext;
  workspaceContextGeneration = 0;
  workspaceTransition: Promise<void> | null = null;
  sessionOperationInProgress = false;
  refreshInProgress = false;
  /**
   * Catalog sessions whose turn is running (`SessionSummary.running`).
   * The active session's entry follows local turn state; the rest are
   * daemon-side turns nobody here drives (detached on switch, another
   * window, or the CLI), watched through the opened-session registry
   * poll. Changes stream as incremental `session.running` messages.
   */
  readonly runningSessionIds = new Set<string>();
  /** Single watcher for detached running flags; null while idle. */
  backgroundRunningPoll: Promise<void> | null = null;
  /**
   * Spec-handoff state of the active turn: `expected` right after the
   * user approves an ExitSpecMode plan into a new session, `detected`
   * once the runtime reports the implementation session id. Adoption
   * happens when the turn completes.
   */
  specHandoff:
    | { readonly turnId: string; readonly status: 'expected' }
    | {
        readonly turnId: string;
        readonly status: 'detected';
        readonly implementationSessionId: string;
      }
    | null = null;
  pendingAttachments: PendingAttachment[] = [];
  /**
   * Prompts queued while a turn runs (queued-messages-design.md
   * §4.1). Payloads stay in Host memory; text is checkpointed for a
   * paused, text-only reload recovery. A session-line change (select,
   * fork, compact, workspace change) still discards the queue.
   */
  queuedPrompts: QueuedPromptsState<PendingAttachment> =
    emptyQueuedPromptsState();
  /**
   * A row-level "Send now" requested while this turn was active.
   * The selected prompt dispatches only after Stop reaches a terminal
   * turn state, never while the runtime still owns its active slot.
   */
  queueSendNowIntent: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly queueId: string;
  } | null = null;
  editStage: EditStage | null = null;
  /**
   * Payloads of already-sent attachments keyed by SDK message id, so
   * editing a recent message can resend its attachments without
   * re-reading them. Memory only; never persisted to checkpoints.
   */
  readonly sentAttachments = new Map<
    string,
    readonly PendingAttachment[]
  >();
  /** Attachments consumed by the turn still waiting for its message id. */
  pendingSentAttachments: {
    readonly turnId: string;
    readonly attachments: readonly PendingAttachment[];
  } | null = null;
  attachmentOperationInProgress = false;
  attachmentIdCounter = 0;
  readonly managedRuntimes = new Set<DroidRuntime>();
  readonly runtimeClosures = new Map<
    DroidRuntime,
    Promise<void>
  >();
  readonly closedRuntimes = new WeakSet<DroidRuntime>();
  disposed = false;
  disposal: Promise<void> | null = null;
  pendingRecoveryCheckpoint: {
    readonly sessionId: string;
    readonly cache: HostTranscriptState;
  } | null = null;
  recoveryCheckpointTimer: ReturnType<typeof setTimeout> | null = null;
  mcpAuthServerName: string | null = null;
  mcpAuthTimer: ReturnType<typeof setTimeout> | null = null;
  daemonCustomModels?: () => Promise<CustomModelsGateway>; modelDiscovery?: CustomModelDiscoveryGateway;
  providerRegistry?: ProviderRegistry;
  promptProviderApiKey?: () => Thenable<string | undefined>;
  readonly providerTests = new Map<string, { readonly status: 'passed' | 'failed'; readonly summary: string; readonly latencyMs: number }>();
  customModelsDiscoveryAbort: AbortController | null = null; customModelsOp = false;
  /**
   * Post-turn ledger reconcile for background delegations that
   * outlived their turn ("zombie" rows). Probed 2026-08-12: no
   * session notification announces the child's terminal state after
   * the parent turn ends, so the invocation ledger is polled until
   * every watched row settles, the session changes, or the bounded
   * window closes.
   */
  zombieSubagentWatch: {
    readonly sessionId: string;
    rows: readonly PendingSubagentRow[];
    readonly deadlineAt: number;
    readonly timer: ReturnType<typeof setInterval>;
    /** Serializes ticks so a slow ledger read never overlaps. */
    ticking: boolean;
  } | null = null;
  turnWatchdog: TurnWatchdogState | null = null; // main-turn watchdog (#32)
  commandsCache: {
    readonly sessionId: string;
    readonly items: readonly CommandSummary[];
  } | null = null;
  /**
   * Runtime generation of the in-flight command-catalog load, or null
   * when none. Tied to the generation instead of a boolean so a hung
   * short-lived catalog process stops blocking refreshes as soon as
   * the session or workspace binding changes.
   */
  commandsRefreshGeneration: number | null = null;
  readonly interactionOpenedAt = new Map<string, number>();
  /** Outbound Bridge message accounting for the active turn (P5). */
  turnIo: {
    counts: Map<string, number>;
    bytes: number;
  } | null = null;
  /** Hidden-fork side chat; null when no sidecar factory is wired. */
  readonly btwSideChat: BtwSideChat | null;
  constructor(
    readonly createRuntime: DroidRuntimeFactory,
    readonly getWorkspaceContext: WorkspaceContextProvider,
    readonly sessionCatalog: SessionCatalog =
      createEmptySessionCatalog(),
    readonly recoveryStore: SessionRecoveryStore =
      createTransientRecoveryStore(),
    readonly sessionHistory: SessionHistoryLoader =
      createUnavailableSessionHistoryLoader(),
    readonly attachmentSources: AttachmentSources =
      createUnavailableAttachmentSources(),
    readonly fileDiff: FileDiffOpener =
      createUnavailableFileDiffOpener(),
    readonly changeStats: ChangeStatsReader =
      createUnavailableChangeStatsReader(),
    readonly externalUrl: ExternalUrlOpener =
      createUnavailableExternalUrlOpener(),
    readonly recentCommands: RecentCommandsStore =
      new RecentCommandsStore(),
    readonly diagnostics?: RuntimeDiagnosticSink,
    readonly daemonSessions?: () => Promise<DaemonSessionCatalog>,
    readonly pathOpener: PathOpener =
      createUnavailablePathOpener(),
    readonly prototypePreview: PrototypePreviewOpener =
      createUnavailablePrototypePreviewOpener(),
    readonly gitWorkflow: GitWorkflow =
      createUnavailableGitWorkflow(),
    readonly worktreeSessions?: WorktreeSessionsFeature,
    readonly terminalMirror?: TerminalMirror,
    readonly daemonPlugins?: () => Promise<DaemonPluginCatalog>,
    btwSidecarFactory?: BtwSidecarFactory,
    readonly missionGateway?: MissionGateway,
  ) {
    this.workspaceContext = {
      ...this.getWorkspaceContext(),
    };
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
        this.interactionOpenedAt.set(
          request.requestId,
          performance.now(),
        );
        this.recordHost({
          level: 'info',
          name: 'host.interaction.opened',
          attributes: {
            kind: request.kind,
            requestId: request.requestId,
          },
        });
        this.emit({
          type: 'interaction.request',
          sessionId,
          turnId,
          request,
        });
      },
      ({ sessionId, turnId, requestId }) => {
        const openedAt = this.interactionOpenedAt.get(requestId);
        this.interactionOpenedAt.delete(requestId);
        this.recordHost({
          level: 'info',
          name: 'host.interaction.closed',
          attributes: {
            requestId,
            ...(openedAt === undefined
              ? {}
              : {
                  pendingMs: Math.round(
                    performance.now() - openedAt,
                  ),
                }),
          },
        });
        this.emit({
          type: 'interaction.closed',
          sessionId,
          turnId,
          requestId,
        });
      },
    );
  }
  subscribe(listener: ChatControllerListener): DisposableSubscription {
    if (this.disposed) {
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
    if (this.disposed) {
      return;
    }
    switch (message.type) {
      case 'webview.ready':
        void handleReady(this);
        return;
      case 'turn.send':
        handleSend(this, 
          message.sessionId,
          message.turnId,
          message.text,
        );
        return;
      case 'mission.start':
        handleMissionStart(this, message);
        return;
      case 'mission.dismissSetup': case 'mission.pause': case 'mission.resume': case 'mission.stopCurrentFeature':
      case 'mission.refresh': case 'mission.disclosure.set': case 'mission.viewer.open':
        handleMissionCommand(this, message);
        return;
      case 'turn.stop':
        handleStop(this, message.sessionId, message.turnId);
        return;
      case 'turn.editResend':
        handleEditResend(this, 
          message.sessionId,
          message.turnId,
          message.messageId,
          message.text,
          message.restoreFiles === true,
        );
        return;
      case 'queue.add':
        handleQueueAdd(this, 
          message.sessionId,
          message.queueId,
          message.text,
        );
        return;
      case 'queue.update':
        handleQueueUpdate(this, 
          message.sessionId,
          message.queueId,
          message.text,
        );
        return;
      case 'queue.remove':
        handleQueueRemove(this, message.sessionId, message.queueId);
        return;
      case 'queue.promote':
        handleQueuePromote(this, message.sessionId, message.queueId);
        return;
      case 'queue.resume':
        handleQueueResume(this, message.sessionId);
        return;
      case 'queue.clear':
        handleQueueClear(this, message.sessionId);
        return;
      case 'rewind.info':
        handleRewindInfo(this, message.sessionId, message.messageId);
        return;
      case 'runtime.retry':
        handleRetry(this, message.sessionId);
        return;
      case 'permission.respond':
        if (!ensureActiveRuntimeWorkspaceCurrent(this)) {
          return;
        }
        if (
          this.interactions.respondPermission(message) &&
          message.selectedOption.startsWith('proceed_new_session') &&
          message.sessionId === this.sessionId &&
          this.turn?.turnId === message.turnId
        ) {
          // A ProceedNewSession* approval only exists on ExitSpecMode
          // requests; remember it so a missing handoff signal degrades
          // to a visible warning instead of silence.
          this.specHandoff = {
            turnId: message.turnId,
            status: 'expected',
          };
        }
        return;
      case 'ask-user.respond':
        if (!ensureActiveRuntimeWorkspaceCurrent(this)) {
          return;
        }
        this.interactions.respondAskUser(message);
        return;
      case 'sessions.refresh':
        handleRefresh(this);
        return;
      case 'session.select':
        handleSessionSelect(this, message.sessionId);
        return;
      case 'session.new':
        handleSessionNew(this);
        return;
      case 'worktree.createSession':
        handleWorktreeCreateSession(this);
        return;
      case 'session.rename':
        handleSessionRename(this, message.sessionId, message.title);
        return;
      case 'session.favorite':
        handleSessionFavorite(this, 
          message.sessionId,
          message.favorite,
        );
        return;
      case 'session.archive':
        handleSessionArchive(this, message.sessionId);
        return;
      case 'session.unarchive':
        handleSessionUnarchive(this, message.sessionId);
        return;
      case 'sessions.archivedRefresh':
        handleArchivedRefresh(this);
        return;
      case 'session.search':
        handleSessionSearch(this, message.query);
        return;
      case 'session.context.refresh':
        handleContextRefresh(this, message.sessionId);
        return;
      case 'session.compact':
        handleSessionCompact(this, message.sessionId);
        return;
      case 'session.fork':
        handleSessionFork(this, message.sessionId);
        return;
      case 'btw.prepare': this.handleBtwPrepare(message.sessionId); return;
      case 'btw.ask':
        this.handleBtwAsk(message.sessionId, message.text);
        return;
      case 'btw.dismiss':
        this.btwSideChat?.handleDismiss(message.sessionId);
        return;
      case 'btw.stop':
        this.btwSideChat?.handleStop(message.sessionId);
        return;
      case 'subagent.panel': handleSubagentPanel(this, message.sessionId, message.open); return;
      case 'file.openDiff':
        handleFileOpenDiff(this, message.sessionId, message.turnId, message.path);
        return;
      case 'file.preview':
        handleFilePreview(this, message.sessionId, message.path);
        return;
      case 'preview.inlineHtml':
        handleInlineHtmlPreview(this, message);
        return;
      case 'workspace.openPath':
        handleWorkspaceOpenPath(this, 
          message.sessionId,
          message.path,
          message.line,
          message.column,
        );
        return;
      case 'skills.refresh':
        handleSkillsRefresh(this, message.sessionId);
        return;
      case 'plugins.refresh':
        handlePluginsRefresh(this, message.sessionId);
        return;
      case 'commands.refresh':
        handleCommandsRefresh(this, message.sessionId);
        return;
      case 'skill.toggle':
        handleSkillToggle(this, message.sessionId, message.name, message.disabled);
        return;
      case 'mcp.refresh':
        handleMcpRefresh(this, message.sessionId);
        return;
      case 'mcp.server.toggle':
        handleMcpServerToggle(this, message.sessionId, message.name, message.enabled);
        return;
      case 'mcp.server.add': {
        const { type: _type, sessionId, ...params } = message;
        handleMcpServerAdd(this, sessionId, params);
        return;
      }
      case 'mcp.server.remove':
        handleMcpServerRemove(this, message.sessionId, message.name);
        return;
      case 'mcp.server.authenticate':
        handleMcpServerAuthenticate(this, message.sessionId, message.name);
        return;
      case 'customModels.refresh': case 'customModels.save': case 'customModels.delete':
      case 'customModels.discover':
      case 'customModels.import':
      case 'providerModels.refresh':
      case 'providerModels.saveProvider':
      case 'providerModels.fetch':
      case 'providerModels.saveModel':
      case 'providerModels.import':
      case 'providerModels.test':
      case 'providerModels.testAll':
        dispatchCustomModels(this, message);
        return;
      case 'attachment.pick':
        handleAttachmentPick(this, message.sessionId, message.stage);
        return;
      case 'attachment.addEditor':
        handleAttachmentCapture(this, 
          message.sessionId,
          'editor',
          message.stage,
        );
        return;
      case 'attachment.addSelection':
        handleAttachmentCapture(this, 
          message.sessionId,
          'selection',
          message.stage,
        );
        return;
      case 'attachment.addProblems':
        handleAttachmentCapture(this, 
          message.sessionId,
          'problems',
          message.stage,
        );
        return;
      case 'attachment.addGitChanges':
        handleAttachmentCapture(this, 
          message.sessionId,
          'git-changes',
          message.stage,
        );
        return;
      case 'attachment.addPath':
        handleAttachmentAddPath(this, 
          message.sessionId,
          message.path,
          message.stage,
        );
        return;
      case 'attachment.addImage':
        handleAttachmentAddImage(this, 
          message.sessionId,
          message.name,
          message.mediaType,
          message.dataBase64,
          message.stage,
        );
        return;
      case 'attachment.addUris':
        handleAttachmentAddUris(this, 
          message.sessionId,
          message.uris,
          message.stage,
        );
        return;
      case 'attachment.addTextFile':
        handleAttachmentAddTextFile(this, 
          message.sessionId,
          message.name,
          message.text,
          message.truncated,
          message.stage,
        );
        return;
      case 'editStage.begin':
        handleEditStageBegin(this, 
          message.sessionId,
          message.messageId,
        );
        return;
      case 'editStage.cancel':
        handleEditStageCancel(this, message.sessionId);
        return;
      case 'workspace.searchFiles':
        handleWorkspaceSearchFiles(this, 
          message.sessionId,
          message.requestId,
          message.query,
        );
        return;
      case 'workspace.readImage':
        handleWorkspaceReadImage(this, message.sessionId, message.path);
        return;
      case 'attachment.remove':
        handleAttachmentRemove(this, 
          message.sessionId,
          message.attachmentId,
          message.stage,
        );
        return;
      case 'session.setting.update':
        handleSettingUpdate(this, message);
        return;
      case 'git.requestStatus':
        handleGitRequestStatus(this, message.sessionId, message.turnId);
        return;
      case 'git.commit':
        handleGitCommit(this, message.sessionId, message.turnId, message.paths, message.message);
        return;
      case 'terminal.openMirror':
        handleTerminalOpenMirror(this, message.sessionId);
        return;
    }
  }
  handleWorkspaceContextChanged(): void {
    if (this.disposed) {
      return;
    }
    const workspace = this.getWorkspaceContext();
    if (isSameWorkspaceContext(this.workspaceContext, workspace)) {
      return;
    }
    this.workspaceContext = { ...workspace };
    if (this.initialization === null) {
      return;
    }
    const generation = ++this.workspaceContextGeneration;
    const staleRuntimes = [...this.managedRuntimes];
    this.runtimeGeneration += 1;
    this.turnGeneration += 1;
    resetSessionMetadata(this);
    if (
      this.recoveryCheckpointTimer !== null ||
      this.pendingRecoveryCheckpoint !== null
    ) {
      checkpointRecoveryTranscript(this);
    }
    this.runtime = null;
    this.activeRuntimeCwd = null;
    this.turn = null;
    this.interactions.cancelAll();
    if (isUsableWorkspace(workspace)) {
      bindCatalogViewToWorkspace(this, workspace.cwd);
      this.connection = {
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
  stageCapturedEditorSelection(
    outcome: AttachmentCaptureOutcome,
  ): boolean {
    if (this.disposed || this.sessionId === null) {
      return false;
    }
    return stageCapturedSelectionOutcome(this, this.sessionId, outcome);
  }
  dispose(): Promise<void> {
    if (this.disposal) {
      return this.disposal;
    }
    checkpointRecoveryTranscript(this);
    this.interactions.cancelAll();
    this.btwSideChat?.reset();
    if (this.mcpAuthTimer !== null) {
      clearTimeout(this.mcpAuthTimer);
      this.mcpAuthTimer = null;
    }
    this.mcpAuthServerName = null;
    clearZombieSubagentWatch(this); clearTurnWatchdog(this);
    this.fileDiff.dispose?.(); this.changeStats.dispose?.();
    this.disposed = true;
    this.runtimeGeneration += 1;
    this.turnGeneration += 1;
    this.contextGeneration += 1;
    this.customModelsDiscoveryAbort?.abort(); this.customModelsDiscoveryAbort = null;
    this.settingsUpdate = null; this.listeners.clear();
    // Detaches a running daemon-side turn instead of interrupting it
    // (Reload survival); see closeAllRuntimesForDispose.
    this.disposal = closeAllRuntimesForDispose(this);
    return this.disposal;
  }
  emitSnapshot(): void {
    if (this.turn === null) {
      // Invariant: an open turn scope always corresponds to the live
      // turn. Session adoption paths clear the turn without a terminal
      // turn.state, so close the scope here.
      this.diagnostics?.endTurnScope?.();
    }
    const sessions = stampRunningFlags(this, 
      withActiveSession(this, this.sessions),
    );
    const workspaceRoot = this.getWorkspaceContext().cwd;
    const snapshot = {
      type: 'host.snapshot',
      sessionId: this.sessionId,
      connection: this.connection,
      turn:
        this.turn === null
          ? null
          : {
              turnId: this.turn.turnId,
              status: this.turn.status,
              ...(this.turn.error === undefined
                ? {}
                : { error: this.turn.error }),
            },
      sessions,
      settings: this.settings,
      context: this.context,
      modelCatalog: this.modelCatalog,
      transcript: this.transcript.transcript,
      historyStatus: this.transcript.historyStatus,
      truncated: this.transcript.truncated,
      ...(this.mission === null || this.sessionId === null
        ? {}
        : { mission: this.mission }),
      ...(this.worktreeCreateAvailable
        ? { worktreeCreateAvailable: true }
        : {}),
      ...(this.btwSideChat === null ? {} : { btwAvailable: true }),
      // Daemon-backed sessions keep detached turns running, so the
      // webview may allow switching away mid-turn; omitted in process
      // mode (fail closed: switching stays blocked there).
      ...(this.runtime?.supportsBackgroundTurns?.() === true
        ? { backgroundTurnsAvailable: true }
        : {}),
      // Omitted when the session has no usage data yet (fail quiet).
      ...(this.sessionId === null ||
      (this.tokenUsage.cumulative === null &&
        this.tokenUsage.lastTurn === null)
        ? {}
        : { tokenUsage: this.tokenUsage }),
      // Omitted while empty: an absent field and an empty queue are
      // the same state on the webview side.
      ...(this.sessionId === null ||
      this.queuedPrompts.items.length === 0
        ? {}
        : { queue: projectQueueState(this) }),
      // Lets the webview rebase absolute transcript paths (the
      // path-link Preview entry); omitted without a usable workspace
      // so rebase-dependent affordances fail closed.
      ...(workspaceRoot === null ? {} : { workspaceRoot }),
    } satisfies UnsequencedHostMessage;
    try {
      this.recordHost({
        level: 'debug',
        name: 'host.perf.snapshot',
        attributes: {
          bytes: JSON.stringify(snapshot).length,
          items: this.transcript.transcript.length,
        },
      });
    } catch {
      // Measurement failures never block the snapshot.
    }
    this.emit(snapshot);
  }
  recordHost(event: RuntimeDiagnosticEvent): void {
    try {
      this.diagnostics?.record(event);
    } catch {
      // Diagnostics must never alter controller behavior.
    }
  }
  emit(
    message: UnsequencedHostMessage,
  ): void {
    if (this.disposed) {
      return;
    }
    const withSequence = {
      ...message,
      sequence: this.nextSequence(),
    } as ControllerHostMessage;
    if (this.turnIo !== null) {
      this.turnIo.counts.set(
        message.type,
        (this.turnIo.counts.get(message.type) ?? 0) + 1,
      );
      try {
        this.turnIo.bytes += JSON.stringify(withSequence).length;
      } catch {
        // Unserializable messages still count by type.
      }
    }
    projectTranscript(this, withSequence);
    for (const listener of this.listeners) {
      listener(withSequence);
    }
  }
  /**
   * Names the first guard that would drop a webview panel request for
   * the given session, or null when the request may proceed. Mirrors
   * the guard chain the MCP/Skills handlers share; the caller must
   * treat a non-null reason as a hard stop.
   */
  sessionRequestDropReason(sessionId: string): string | null {
    if (sessionId !== this.sessionId) {
      return 'session-mismatch';
    }
    if (this.runtime === null) {
      return 'no-runtime';
    }
    if (this.connection.status !== 'connected') {
      return 'not-connected';
    }
    if (this.sessionOperationInProgress) {
      return 'operation-in-progress';
    }
    if (!ensureActiveRuntimeWorkspaceCurrent(this)) {
      return 'workspace-changed';
    }
    return null;
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
    code: string, message: string, turnId: string | null = null,
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
      sessionId: this.sessionId,
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
      this.sessionId === sessionId &&
      this.activeRuntimeCwd === cwd &&
      isTargetWorkspaceCurrent(this, cwd)
    );
  }
  private handleBtwAsk(sessionId: string, text: string): void {
    this.withBtwSession(sessionId, (sideChat, cwd) =>
      void sideChat.handleAsk(cwd, sessionId, text));
  }
  private handleBtwPrepare(sessionId: string): void {
    this.withBtwSession(sessionId, (sideChat, cwd) =>
      void sideChat.handlePrepare(cwd, sessionId));
  }
  private withBtwSession(sessionId: string,
    run: (sideChat: BtwSideChat, cwd: string) => void): void {
    const sideChat = this.btwSideChat;
    if (sideChat === null || sessionId !== this.sessionId) {
      return;
    }
    const cwd = this.activeRuntimeCwd;
    if (cwd === null || !isTargetWorkspaceCurrent(this, cwd)) {
      return;
    }
    run(sideChat, cwd);
  }
}
