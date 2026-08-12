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
  MAX_SESSION_TITLE_LENGTH as SESSION_TITLE_LIMIT,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
} from '../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeAttachment,
  RuntimeCommand,
  RuntimeContextStats,
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
import {
  applySubagentSettlement,
  collectRunningSubagentRows,
  collectToolFilePaths,
  collectTranscriptSubagentRows,
  createTurnActivityState,
  hasSubagentRows,
  projectAssistantDelta,
  projectSubagentStarted,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  reconcileSubagentSummaries,
  settleZombieSubagents,
  thinkingSegmentKey,
  type PendingSubagentRow,
  type TurnActivityState,
} from './turnActivityState';
import { handleQueueAdd, handleQueueUpdate, handleQueueRemove, handleQueueResume, handleQueuePromote, handleQueueClear, settleQueueAfterTurn, projectQueueState, discardQueuedPrompts } from './chat/queue';
import { handleMcpRefresh, pushMcp, handleMcpServerToggle, handleMcpServerAdd, handleMcpServerRemove, handleMcpServerAuthenticate } from './chat/mcp';
import { handleContextRefresh, refreshContext, updateTokenUsage, handleSkillsRefresh, pushSkills, handleSkillToggle, handlePluginsRefresh, handleCommandsRefresh, recordRecentCommand, emitModelCatalog, projectModelCatalog, isSafeModelId, MODEL_CATALOG_FAILED_MESSAGE } from './chat/capabilityPanels';
import { handleAttachmentPick, handleAttachmentCapture, handleAttachmentAddPath, handleAttachmentAddImage, handleAttachmentAddUris, handleAttachmentAddTextFile, handleAttachmentRemove, takePendingAttachments, clearPendingAttachments, retainSentAttachments, emitEditAttachments, echoUserImageAttachments, sentAttachmentSummaries } from './chat/attachments';
import { handleSettingUpdate, emitSettings, refreshSettingsAfterRuntimeEvent, projectConfirmedSettings, SETTINGS_READ_FAILED_MESSAGE } from './chat/settings';
import { handleFileOpenDiff, handleFilePreview, handleInlineHtmlPreview, handleTerminalOpenMirror, handleGitRequestStatus, handleGitCommit, handleWorkspaceOpenPath, handleWorkspaceSearchFiles, handleWorkspaceReadImage } from './chat/workspaceActions';
import { handleRewindInfo, handleEditResend, handleEditStageBegin, handleEditStageCancel } from './chat/editResend';
import { stampRunningFlags, setSessionRunning, ensureBackgroundRunningPoll, seedBackgroundRunning } from './chat/sessionRunning';
import { settleTurnSubagents, clearZombieSubagentWatch, armReplayedSubagentWatch } from './chat/subagentWatch';
import { emitEarlyRecoverySnapshot, reconcileDaemonTurn, scheduleRecoveryCheckpoint, checkpointRecoveryTranscript, flushRecoveryCheckpoint, recoveryTurnId } from './chat/recovery';
import { handleSessionNew, handleWorktreeCreateSession, handleSessionRename, handleSessionFavorite, handleSessionArchive, handleSessionUnarchive, handleArchivedRefresh, handleSessionSearch, handleSessionSelect, handleRefresh, handleSessionFork, loadCatalog, hasCatalogSession, activeSessionSummary, withActiveSession, beginCatalogLoad, bindCatalogViewToWorkspace, clearCatalog, isCurrentCatalogRequest, discardCatalogRequest, touchActiveSession, SESSION_NEW_FAILED_MESSAGE } from './chat/sessionDirectory';
import { handleReady, startReplacement, replaceRuntime, loadHistoryTimed, resetSessionMetadata, closeRuntime, queueWorkspaceTransition, isCurrentRuntime, ensureActiveRuntimeWorkspaceCurrent, isTargetWorkspaceCurrent, emitWorkspaceUnavailable, isSameWorkspaceContext, WORKSPACE_CHANGED_MESSAGE } from './chat/runtimeLifecycle';
import { PendingInteractionCoordinator } from './pendingInteractionCoordinator';
import {
  clearPrompts,
  dropDispatchedPrompt,
  emptyQueuedPromptsState,
  enqueuePrompt,
  evaluateQueueDispatch,
  markDispatchBlocked,
  pauseAfterTerminal,
  promotePrompt,
  removePrompt,
  resumeQueue,
  updatePromptText,
  type QueuedPromptsState,
} from './queuedPromptsState';
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
  isTurnActive,
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
export type ChatControllerListener = (
  message: HostToWebviewMessage,
) => void;
type UnsequencedHostMessage =
  HostToWebviewMessage extends infer Message
    ? Message extends HostToWebviewMessage
      ? Omit<Message, 'sequence'>
      : never
    : never;

const TURN_FAILURE_MESSAGE =
  'Droid could not complete this turn. Retry to start a fresh session.';
const RUNTIME_EVENT_ERROR_MESSAGE =
  'Droid reported a runtime error while processing this turn.';
const ASSISTANT_OUTPUT_TRUNCATED_MESSAGE =
  'Assistant output exceeded the display limit and was truncated.';
const COMPACT_BLOCKED_MESSAGE =
  'Droid cannot compact right now. Wait for the current activity to finish.';
const COMPACT_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support context compaction.';
const COMPACT_FAILED_MESSAGE =
  'Droid could not compact the conversation.';
const SPEC_HANDOFF_DETECTED_MESSAGE =
  'Plan approved. Droid is implementing in a new session; the chat switches there when this turn finishes.';
const SPEC_HANDOFF_NOT_DETECTED_MESSAGE =
  'Droid moved implementation to a new session, but it could not be identified automatically. Refresh History to open it.';
const SPEC_HANDOFF_BLOCKED_MESSAGE =
  'The implementation session could not be opened automatically. Select it from History.';

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
  /**
   * Read-only mission identity of the active session, from the last
   * successful history load; null for sessions outside a mission.
   */
  mission: SessionMissionSummary | null = null;
  /**
   * Token-usage breakdown of the active session: cumulative totals
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
   * §4.1). Host memory only — the queue dies with the session line
   * (reload, session switch, fork, compact, workspace change).
   */
  queuedPrompts: QueuedPromptsState<PendingAttachment> =
    emptyQueuedPromptsState();
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
  recoveryCheckpointTimer: ReturnType<typeof setTimeout> | null =
    null;
  mcpAuthServerName: string | null = null;
  mcpAuthTimer: ReturnType<typeof setTimeout> | null = null;
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
        this.handleSend(
          message.sessionId,
          message.turnId,
          message.text,
        );
        return;
      case 'turn.stop':
        this.handleStop(message.sessionId, message.turnId);
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
        this.handleRetry(message.sessionId);
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
        this.handleSessionCompact(message.sessionId);
        return;
      case 'session.fork':
        handleSessionFork(this, message.sessionId);
        return;
      case 'btw.ask':
        this.handleBtwAsk(message.sessionId, message.text);
        return;
      case 'btw.dismiss':
        this.btwSideChat?.handleDismiss(message.sessionId);
        return;
      case 'file.openDiff':
        handleFileOpenDiff(this, message.sessionId, message.path);
        return;
      case 'file.preview':
        handleFilePreview(this, message.sessionId, message.path);
        return;
      case 'preview.inlineHtml':
        handleInlineHtmlPreview(this, message.sessionId, message.html);
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
        handleSkillToggle(this, 
          message.sessionId,
          message.name,
          message.disabled,
        );
        return;
      case 'mcp.refresh':
        handleMcpRefresh(this, message.sessionId);
        return;
      case 'mcp.server.toggle':
        handleMcpServerToggle(this, 
          message.sessionId,
          message.name,
          message.enabled,
        );
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
        handleGitRequestStatus(this, message.sessionId);
        return;
      case 'git.commit':
        handleGitCommit(this, 
          message.sessionId,
          message.paths,
          message.message,
        );
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
    clearZombieSubagentWatch(this);
    this.disposed = true;
    this.runtimeGeneration += 1;
    this.turnGeneration += 1;
    this.contextGeneration += 1;
    this.settingsUpdate = null;
    this.listeners.clear();
    const runtimes = [...this.managedRuntimes];
    this.runtime = null;
    this.disposal = (async () => {
      await Promise.allSettled([
        ...runtimes.map((runtime) => closeRuntime(this, runtime)),
        this.recoveryStore.flush(),
      ]);
      await this.recoveryStore.dispose();
    })();
    return this.disposal;
  }

  handleSend(
    sessionId: string,
    turnId: string,
    text: string,
    kind: 'send' | 'edit-resend' | 'queued' = 'send',
    attachmentsOverride?: readonly PendingAttachment[],
  ): void {
    const runtime = this.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(this)
    ) {
      return;
    }
    if (
      runtime === null ||
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId ||
      text.trim().length === 0 ||
      this.turn?.turnId === turnId ||
      isTurnActive(this.turn) ||
      this.sessionOperationInProgress ||
      this.settingsUpdate !== null
    ) {
      return;
    }

    const runtimeGeneration = this.runtimeGeneration;
    const turnGeneration = ++this.turnGeneration;
    this.diagnostics?.beginTurnScope?.(turnId);
    this.turnIo = { counts: new Map(), bytes: 0 };
    this.recordHost({
      level: 'info',
      name: 'host.turn.accepted',
      attributes: {
        kind,
        textLength: text.length,
        sessionId,
      },
      detail: text,
    });
    this.turn = {
      turnId,
      status: 'submitting',
      activity: createTurnActivityState(),
    };
    this.interactions.beginTurn(sessionId, turnId);
    // Edit-resend consumes the edit staging area passed in by the
    // caller; a plain send consumes the composer staging area.
    const consumed =
      attachmentsOverride ?? takePendingAttachments(this);
    this.transcript = appendAcceptedUserPrompt(
      this.transcript,
      turnId,
      text,
      consumed === undefined
        ? undefined
        : sentAttachmentSummaries(consumed),
    );
    scheduleRecoveryCheckpoint(this);
    touchActiveSession(this);
    recordRecentCommand(this, sessionId, text);
    this.emitTurnState(sessionId, turnId, 'submitting');
    const attachments =
      consumed === undefined || consumed.length === 0
        ? undefined
        : consumed.map(({ runtime: attachment }) => attachment);
    echoUserImageAttachments(this, sessionId, turnId, attachments);
    this.pendingSentAttachments =
      consumed === undefined || consumed.length === 0
        ? null
        : { turnId, attachments: consumed };
    void this.consumeTurn(
      runtime,
      runtimeGeneration,
      turnGeneration,
      sessionId,
      turnId,
      text,
      attachments,
    );
  }

  private async consumeTurn(
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    turnId: string,
    text: string,
    attachments?: readonly RuntimeAttachment[],
  ): Promise<void> {
    let terminalEventSeen = false;
    let completeEvent: Extract<
      RuntimeEvent,
      { type: 'turn-complete' }
    > | null = null;

    try {
      for await (const event of runtime.sendTurn(text, attachments)) {
        if (
          !this.isCurrentTurn(
            runtime,
            runtimeGeneration,
            turnGeneration,
            sessionId,
            turnId,
          )
        ) {
          return;
        }

        if (event.type === 'turn-complete') {
          terminalEventSeen = true;
          // Settle only after leaving the loop: breaking closes the
          // runtime generator (releasing its active-turn slot), so a
          // queued prompt dispatched by the completion can start the
          // next turn instead of hitting "already has an active turn".
          completeEvent = event;
          break;
        }

        if (this.turn?.status === 'stopping') {
          continue;
        }

        this.handleRuntimeEvent(sessionId, turnId, event);
      }
    } catch {
      if (
        this.isCurrentTurn(
          runtime,
          runtimeGeneration,
          turnGeneration,
          sessionId,
          turnId,
        )
      ) {
        completeEvent = null;
        terminalEventSeen = true;
        this.failTurn(sessionId, turnId, 'runtime-stream-failed');
      }
    }

    if (
      completeEvent !== null &&
      this.isCurrentTurn(
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        turnId,
      )
    ) {
      this.handleTurnComplete(sessionId, turnId, completeEvent);
      return;
    }

    if (
      !terminalEventSeen &&
      this.isCurrentTurn(
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        turnId,
      )
    ) {
      this.failTurn(sessionId, turnId, 'runtime-stream-ended');
    }
  }

  private handleRuntimeEvent(
    sessionId: string,
    turnId: string,
    event: Exclude<RuntimeEvent, { type: 'turn-complete' }>,
  ): void {
    switch (event.type) {
      case 'text-delta': {
        const turn = this.turn;
        if (turn === null) {
          return;
        }
        const result = projectAssistantDelta(
          turn.activity,
          event.text,
        );
        turn.activity = result.state;
        if (result.projection === null) {
          return;
        }
        if (result.projection.delta.length > 0) {
          this.startStreaming(sessionId, turnId);
          this.emit({
            type: 'assistant.delta',
            sessionId,
            turnId,
            delta: result.projection.delta,
          });
        }
        if (result.projection.truncated) {
          this.emit({
            type: 'runtime.diagnostic',
            sessionId,
            turnId,
            severity: 'warning',
            code: 'assistant-output-truncated',
            message: ASSISTANT_OUTPUT_TRUNCATED_MESSAGE,
          });
        }
        return;
      }
      case 'thinking-delta': {
        this.startStreaming(sessionId, turnId);
        const turn = this.turn;
        if (turn === null) {
          return;
        }
        const result = projectThinkingDelta(
          turn.activity,
          event.text,
          thinkingSegmentKey(event),
        );
        turn.activity = result.state;
        if (result.projection !== null) {
          this.emit({
            type: 'thinking.delta',
            sessionId,
            turnId,
            ...result.projection,
          });
        }
        return;
      }
      case 'thinking-complete': {
        const turn = this.turn;
        if (turn === null) {
          return;
        }
        const projection = projectThinkingComplete(
          turn.activity,
          thinkingSegmentKey(event),
        );
        if (projection !== null) {
          this.emit({
            type: 'thinking.complete',
            sessionId,
            turnId,
            durationMs: event.durationMs,
            segmentIndex: projection.segmentIndex,
          });
        }
        return;
      }
      case 'tool-start':
      case 'tool-progress':
      case 'tool-result': {
        this.startStreaming(sessionId, turnId);
        const turn = this.turn;
        if (turn === null) {
          return;
        }
        this.mirrorExecuteEvent(sessionId, event);
        const result = projectToolEvent(turn.activity, event);
        turn.activity = result.state;
        if (result.projection !== null) {
          this.emit({
            type: 'tool.activity',
            sessionId,
            turnId,
            ...result.projection,
          });
        }
        return;
      }
      case 'image-block': {
        this.startStreaming(sessionId, turnId);
        this.emit({
          type: 'transcript.image',
          sessionId,
          turnId,
          item: {
            id: stableTranscriptId(
              'image',
              turnId,
              event.sourceId,
              String(event.blockIndex),
            ),
            kind: 'image',
            turnId,
            origin: event.origin,
            mediaType: event.mediaType,
            data: event.data,
            generated: event.generated,
            byteLength: event.byteLength,
          },
        });
        return;
      }
      case 'user-message':
        this.transcript = attachUserMessageId(
          this.transcript,
          turnId,
          event.messageId,
        );
        retainSentAttachments(this, turnId, event.messageId);
        scheduleRecoveryCheckpoint(this);
        this.emit({
          type: 'user.message-meta',
          sessionId,
          turnId,
          messageId: event.messageId,
        });
        return;
      case 'subagent-started': {
        this.startStreaming(sessionId, turnId);
        const turn = this.turn;
        if (turn === null) {
          return;
        }
        const result = projectSubagentStarted(turn.activity, event);
        turn.activity = result.state;
        if (result.projection !== null) {
          this.emit({
            type: 'tool.activity',
            sessionId,
            turnId,
            ...result.projection,
          });
        }
        return;
      }
      case 'working-state':
        if (event.isWorking) {
          this.startStreaming(sessionId, turnId);
        }
        return;
      case 'token-usage':
        // Live cumulative totals are authoritative over any history
        // seed; the CLI pushes a few per turn.
        updateTokenUsage(this, sessionId, {
          cumulative: event.cumulative,
        });
        return;
      case 'settings-updated':
        refreshSettingsAfterRuntimeEvent(this, sessionId);
        return;
      case 'spec-handoff':
        if (
          isSafeBridgeId(event.implementationSessionId) &&
          event.implementationSessionId !== sessionId &&
          this.sessionId === sessionId
        ) {
          this.specHandoff = {
            turnId,
            status: 'detected',
            implementationSessionId: event.implementationSessionId,
          };
          this.emit({
            type: 'runtime.diagnostic',
            sessionId,
            turnId,
            severity: 'info',
            code: 'spec-handoff-detected',
            message: SPEC_HANDOFF_DETECTED_MESSAGE,
          });
        }
        return;
      case 'error':
        this.emit({
          type: 'runtime.diagnostic',
          sessionId,
          turnId,
          severity: 'error',
          code: 'runtime-event-error',
          message: RUNTIME_EVENT_ERROR_MESSAGE,
        });
        return;
    }
  }

  /**
   * Feeds execute-tool lifecycle and output into the read-only
   * terminal mirror (native-terminal design slice A). Runs inside the
   * current-turn gate of the event loop, so only the active session's
   * live commands are mirrored — history replays never pass here.
   * Mirrored text goes straight to the terminal and must never enter
   * diagnostics logs (same red line as the transcript preview).
   */
  private mirrorExecuteEvent(
    sessionId: string,
    event: Extract<
      RuntimeEvent,
      { type: 'tool-start' | 'tool-progress' | 'tool-result' }
    >,
  ): void {
    const mirror = this.terminalMirror;
    if (mirror === undefined || !isExecuteToolName(event.toolName)) {
      return;
    }
    switch (event.type) {
      case 'tool-start':
        mirror.commandStarted({
          toolUseId: event.toolUseId,
          ...(event.detailKind === 'command' &&
          event.detail !== undefined
            ? { command: event.detail }
            : {}),
          sessionTag: sessionId.slice(0, 8),
        });
        return;
      case 'tool-progress':
        if (event.outputTail !== undefined) {
          mirror.commandOutput(event.toolUseId, event.outputTail);
        }
        return;
      case 'tool-result':
        mirror.commandSettled(event.toolUseId);
        return;
    }
  }

  private handleTurnComplete(
    sessionId: string,
    turnId: string,
    event: Extract<RuntimeEvent, { type: 'turn-complete' }>,
  ): void {
    this.interactions.endTurn(sessionId, turnId);
    this.terminalMirror?.settleAll();
    if (event.turnUsage !== undefined) {
      // Per-turn consumption regardless of outcome; interrupted and
      // failed turns still burned tokens.
      updateTokenUsage(this, sessionId, { lastTurn: event.turnUsage });
    }
    switch (event.outcome) {
      case 'success':
        this.publishTurnChanges(sessionId, turnId);
        this.setTurnStatus(sessionId, turnId, 'completed');
        void flushRecoveryCheckpoint(this);
        settleTurnSubagents(this, sessionId, turnId);
        this.refreshContextAfterTurn(sessionId);
        this.finishSpecHandoff(sessionId, turnId);
        return;
      case 'interrupted':
        this.publishTurnChanges(sessionId, turnId);
        this.setTurnStatus(sessionId, turnId, 'interrupted');
        void flushRecoveryCheckpoint(this);
        settleTurnSubagents(this, sessionId, turnId);
        this.refreshContextAfterTurn(sessionId);
        this.finishSpecHandoff(sessionId, turnId);
        return;
      case 'error_during_execution':
        this.specHandoff = null;
        this.failTurn(sessionId, turnId, 'runtime-execution-failed');
        return;
      case 'error_structured_output':
        this.specHandoff = null;
        this.failTurn(sessionId, turnId, 'runtime-structured-output-failed');
        return;
    }
  }

  /**
   * Ends the spec-handoff arc of a finished turn: adopts the detected
   * implementation session (same replacement path as selecting it from
   * History), or degrades to a visible warning when the handoff signal
   * never arrived or adoption is currently blocked.
   */
  private finishSpecHandoff(sessionId: string, turnId: string): void {
    const handoff = this.specHandoff;
    if (handoff === null || handoff.turnId !== turnId) {
      return;
    }
    this.specHandoff = null;
    const cwd = this.activeRuntimeCwd;
    if (this.sessionId !== sessionId || cwd === null) {
      return;
    }
    if (handoff.status !== 'detected') {
      this.emitSessionDiagnostic(
        'spec-handoff-not-detected',
        SPEC_HANDOFF_NOT_DETECTED_MESSAGE,
      );
      return;
    }
    if (
      isTurnActive(this.turn) ||
      this.interactions.hasPending() ||
      this.connection.status === 'connecting' ||
      this.sessionOperationInProgress ||
      this.refreshInProgress ||
      this.settingsUpdate !== null
    ) {
      this.emitSessionDiagnostic(
        'spec-handoff-blocked',
        SPEC_HANDOFF_BLOCKED_MESSAGE,
      );
      return;
    }
    this.recordHost({
      level: 'info',
      name: 'host.spec.handoff-adopted',
      attributes: {
        planningSessionId: sessionId,
        implementationSessionId: handoff.implementationSessionId,
      },
    });
    startReplacement(this, {
      kind: 'resume',
      cwd,
      sessionId: handoff.implementationSessionId,
    });
  }

  /**
   * Publishes the changed-files summary for a finished turn. Line
   * counts come from git HEAD asynchronously; the summary is dropped
   * when the session changes before the stats arrive.
   */
  private publishTurnChanges(sessionId: string, turnId: string): void {
    if (
      this.sessionId !== sessionId ||
      this.turn?.turnId !== turnId
    ) {
      return;
    }
    const paths = collectToolFilePaths(this.turn.activity);
    if (paths.length === 0) {
      return;
    }
    const runtimeGeneration = this.runtimeGeneration;
    void this.changeStats.read(paths).then((stats) => {
      if (
        this.disposed ||
        this.sessionId !== sessionId ||
        this.runtimeGeneration !== runtimeGeneration
      ) {
        return;
      }
      const files = paths.map((path) => {
        const stat = stats.get(path);
        return {
          path,
          additions: stat?.additions ?? null,
          deletions: stat?.deletions ?? null,
        };
      });
      const next = appendTurnChanges(this.transcript, turnId, files);
      if (next === this.transcript) {
        return;
      }
      this.transcript = next;
      scheduleRecoveryCheckpoint(this);
      this.emit({
        type: 'turn.changes',
        sessionId,
        turnId,
        files,
      });
    });
  }

  private handleStop(sessionId: string, turnId: string): void {
    const runtime = this.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(this)
    ) {
      return;
    }
    if (
      runtime === null ||
      sessionId !== this.sessionId ||
      this.turn?.turnId !== turnId ||
      (this.turn.status !== 'submitting' &&
        this.turn.status !== 'streaming')
    ) {
      return;
    }

    // A recovery turn runs daemon-side with no locally streaming turn;
    // interrupt() would no-op there, interruptSession() reaches the
    // daemon. The poll loop then observes idle and settles the turn.
    const interruptTurn =
      this.turn.recovery === true &&
      typeof runtime.interruptSession === 'function'
        ? () => runtime.interruptSession!()
        : () => runtime.interrupt();
    this.interactions.endTurn(sessionId, turnId);
    this.setTurnStatus(sessionId, turnId, 'stopping');
    const runtimeGeneration = this.runtimeGeneration;
    const turnGeneration = this.turnGeneration;
    void interruptTurn().catch(() => {
      if (
        this.isCurrentTurn(
          runtime,
          runtimeGeneration,
          turnGeneration,
          sessionId,
          turnId,
        )
      ) {
        this.failTurn(sessionId, turnId, 'runtime-interrupt-failed');
      }
    });
  }

  private handleSessionCompact(sessionId: string): void {
    const runtime = this.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(this)
    ) {
      return;
    }
    if (
      runtime === null ||
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    if (
      isTurnActive(this.turn) ||
      this.interactions.hasPending() ||
      this.sessionOperationInProgress ||
      this.refreshInProgress ||
      this.settingsUpdate !== null
    ) {
      this.emitSessionDiagnostic(
        'session-compact-blocked',
        COMPACT_BLOCKED_MESSAGE,
      );
      return;
    }
    if (typeof runtime.compact !== 'function') {
      this.emitSessionDiagnostic(
        'session-compact-unsupported',
        COMPACT_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    this.sessionOperationInProgress = true;
    void this.performCompact(runtime, sessionId).finally(() => {
      this.sessionOperationInProgress = false;
    });
  }

  /**
   * Compacts the active session and adopts the continuation session
   * that Droid returns, reloading its summarized transcript.
   */
  private async performCompact(
    runtime: DroidRuntime,
    sessionId: string,
  ): Promise<void> {
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }

    let compactedSessionId: string;
    let removedCount: number;
    try {
      const result = await runtime.compact!();
      compactedSessionId = result.sessionId;
      removedCount = result.removedCount;
    } catch {
      if (
        this.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        )
      ) {
        this.emitSessionDiagnostic(
          'session-compact-failed',
          COMPACT_FAILED_MESSAGE,
        );
      }
      return;
    }
    if (
      !this.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    ) {
      return;
    }
    if (!isSafeBridgeId(compactedSessionId)) {
      this.emitSessionDiagnostic(
        'session-compact-failed',
        COMPACT_FAILED_MESSAGE,
      );
      return;
    }

    const previousTitle =
      activeSessionSummary(this)?.title ?? 'Current session';
    // The compacted session stays in the catalog: its file remains on
    // disk with the full pre-compaction history, and the compaction
    // divider's "View full history" jump needs it selectable.
    this.sessionId = compactedSessionId;
    this.turn = null;
    clearPendingAttachments(this);
    this.sessions = withActiveSession(this, this.sessions, {
      id: compactedSessionId,
      title: previousTitle,
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    });

    let transcript: HostTranscriptState | null = null;
    let mission: SessionMissionSummary | null = null;
    let tokenUsage: TokenUsageBreakdown | null = null;
    {
      const loaded = await loadHistoryTimed(this, 
        cwd,
        compactedSessionId,
      );
      if (loaded?.status === 'available') {
        transcript = loaded.state;
        mission = loaded.mission ?? null;
        tokenUsage = loaded.tokenUsage ?? null;
      }
    }
    if (
      !this.isCurrentSessionOperation(
        runtime,
        generation,
        compactedSessionId,
        cwd,
      )
    ) {
      return;
    }
    this.mission = mission;
    // The compacted successor is a new session; its counters restart.
    this.tokenUsage = { cumulative: tokenUsage, lastTurn: null };
    // If the summarized history cannot be read, keep the previous
    // transcript visible; the runtime context is compacted either way.
    this.transcript =
      transcript ?? { ...this.transcript, historyStatus: 'partial' };
    this.recoveryStore.writeSession(compactedSessionId, this.transcript);
    this.recoveryStore.selectSession(compactedSessionId);
    void this.recoveryStore.flush();
    this.emitSnapshot();
    this.emit({
      type: 'runtime.diagnostic',
      sessionId: compactedSessionId,
      turnId: null,
      severity: 'info',
      code: 'session-compacted',
      message:
        removedCount > 0
          ? `Conversation compacted: ${removedCount} earlier messages summarized.`
          : 'Conversation compacted.',
      // The pre-compaction session backs the divider's
      // "View full history" jump.
      relatedSessionId: sessionId,
    });
    this.refreshContextAfterTurn(compactedSessionId);
  }

  private handleRetry(sessionId: string | null): void {
    if (
      this.sessionOperationInProgress ||
      this.refreshInProgress ||
      sessionId !== this.sessionId ||
      (this.connection.status !== 'unavailable' &&
        this.turn?.status !== 'failed')
    ) {
      return;
    }

    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      emitWorkspaceUnavailable(this, workspace);
      return;
    }
    if (
      this.sessions.status === 'idle' ||
      this.catalogCwd !== workspace.cwd
    ) {
      this.sessionOperationInProgress = true;
      void this.retryAfterWorkspaceBecomesAvailable(
        workspace.cwd,
      ).finally(() => {
        this.sessionOperationInProgress = false;
      });
      return;
    }
    const resumableId =
      this.sessionId !== null &&
      hasCatalogSession(this, this.sessionId, workspace.cwd)
        ? this.sessionId
        : null;
    startReplacement(this, 
      resumableId === null
        ? { kind: 'new', cwd: workspace.cwd }
        : {
            kind: 'resume',
            cwd: workspace.cwd,
            sessionId: resumableId,
          },
    );
  }

  private async retryAfterWorkspaceBecomesAvailable(
    cwd: string,
  ): Promise<void> {
    const catalogRequest = beginCatalogLoad(this, cwd);
    this.emitSnapshot();
    const [, catalog] = await Promise.all([
      this.recoveryStore.load(),
      loadCatalog(this, cwd),
    ]);
    if (this.disposed) {
      return;
    }
    if (!isCurrentCatalogRequest(this, catalogRequest, cwd)) {
      discardCatalogRequest(this, catalogRequest);
      return;
    }
    this.sessions = catalog;
    seedBackgroundRunning(this, cwd);
    const selectedSessionId =
      this.recoveryStore.getSelectedSessionId();
    await replaceRuntime(this, 
      selectedSessionId !== null &&
        hasCatalogSession(this, selectedSessionId, cwd)
        ? {
            kind: 'resume',
            cwd,
            sessionId: selectedSessionId,
          }
        : { kind: 'new', cwd },
    );
  }

  failTurn(
    sessionId: string,
    turnId: string,
    code: string,
  ): void {
    if (this.turn?.turnId !== turnId) {
      return;
    }

    if (this.specHandoff?.turnId === turnId) {
      this.specHandoff = null;
    }
    this.interactions.endTurn(sessionId, turnId);
    this.terminalMirror?.settleAll();
    this.turn.status = 'failed';
    this.turn.error = TURN_FAILURE_MESSAGE;
    this.emit({
      type: 'turn.error',
      sessionId,
      turnId,
      code,
      message: TURN_FAILURE_MESSAGE,
      retryable: true,
    });
    this.emitTurnState(sessionId, turnId, 'failed');
    void flushRecoveryCheckpoint(this);
    this.refreshContextAfterTurn(sessionId);
  }

  setTurnStatus(
    sessionId: string,
    turnId: string,
    status: TurnStatus,
  ): void {
    if (this.turn?.turnId !== turnId) {
      return;
    }

    this.turn.status = status;
    this.emitTurnState(sessionId, turnId, status);
  }

  private startStreaming(sessionId: string, turnId: string): void {
    if (this.turn?.status === 'submitting') {
      this.setTurnStatus(sessionId, turnId, 'streaming');
    }
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

  private emitTurnState(
    sessionId: string,
    turnId: string,
    status: TurnStatus,
  ): void {
    this.emit({
      type: 'turn.state',
      sessionId,
      turnId,
      status,
    });
    this.recordHost({
      level: 'debug',
      name: 'host.turn.state',
      attributes: { status },
    });
    if (
      status === 'completed' ||
      status === 'interrupted' ||
      status === 'failed'
    ) {
      this.flushTurnIo();
      this.diagnostics?.endTurnScope?.();
      settleQueueAfterTurn(this, sessionId, status);
      // Every terminal outcome clears the running indicator at once.
      setSessionRunning(this, sessionId, false);
    } else {
      setSessionRunning(this, sessionId, true);
    }
  }

  /** Emits the per-turn outbound Bridge message accounting (P5). */
  private flushTurnIo(): void {
    const io = this.turnIo;
    this.turnIo = null;
    if (io === null) {
      return;
    }
    const attributes: Record<string, number> = {
      bytesOut: io.bytes,
      messagesOut: [...io.counts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
    for (const [type, count] of io.counts) {
      attributes[`n_${type.replaceAll('.', '_')}`] = count;
    }
    this.recordHost({
      level: 'debug',
      name: 'host.perf.turn-io',
      attributes,
    });
  }

  recordHost(event: RuntimeDiagnosticEvent): void {
    try {
      this.diagnostics?.record(event);
    } catch {
      // Diagnostics must never alter controller behavior.
    }
  }

  refreshContextAfterTurn(sessionId: string): void {
    if (
      this.runtime !== null &&
      this.activeRuntimeCwd !== null &&
      this.sessionId === sessionId &&
      this.connection.status === 'connected'
    ) {
      refreshContext(this, 
        this.runtime,
        this.runtimeGeneration,
        sessionId,
        this.activeRuntimeCwd,
      );
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
    } as HostToWebviewMessage;
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
    this.projectTranscript(withSequence);
    for (const listener of this.listeners) {
      listener(withSequence);
    }
  }

  private projectTranscript(message: HostToWebviewMessage): void {
    if (
      this.sessionId === null ||
      !isTranscriptProjection(message) ||
      message.sessionId !== this.sessionId
    ) {
      return;
    }
    this.transcript = projectHostTranscriptMessage(
      this.transcript,
      message,
    );
    scheduleRecoveryCheckpoint(this);
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
    code: string,
    message: string,
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
      turnId: null,
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

  /**
   * Routes one side question into the hidden-fork side chat
   * (side-question-design.md §5.3). The ask must target the bound
   * session in the current workspace; the fork itself never surfaces
   * in catalogs or the transcript, so nothing else here changes.
   */
  private handleBtwAsk(sessionId: string, text: string): void {
    const sideChat = this.btwSideChat;
    if (sideChat === null || sessionId !== this.sessionId) {
      return;
    }
    const cwd = this.activeRuntimeCwd;
    if (cwd === null || !isTargetWorkspaceCurrent(this, cwd)) {
      return;
    }
    void sideChat.handleAsk(cwd, sessionId, text);
  }

  isCurrentTurn(
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    turnId: string,
  ): boolean {
    if (
      isCurrentRuntime(this, runtime, runtimeGeneration) &&
      this.turnGeneration === turnGeneration &&
      this.sessionId === sessionId &&
      this.turn?.turnId === turnId &&
      isTurnActive(this.turn)
    ) {
      return ensureActiveRuntimeWorkspaceCurrent(this);
    }
    return false;
  }
}

