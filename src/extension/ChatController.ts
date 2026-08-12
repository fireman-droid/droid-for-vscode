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
  isTranscriptProjection,
  isTurnActive,
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
/**
 * Poll cadence for a daemon-side turn recovered after a reload. The
 * read is one in-memory registry RPC over the persistent daemon
 * connection, so a sub-second cadence keeps the completed-result
 * replacement snappy without measurable cost.
 */
const RECOVERED_TURN_POLL_MS = 500;
/**
 * Poll cadence of the post-turn zombie-subagent reconcile. Each tick
 * is one session-file load; the probed settle latency of the ledger
 * is seconds-coarse, so 5s keeps the row honest without I/O churn.
 */
const ZOMBIE_SUBAGENT_POLL_MS = 5_000;
/**
 * Upper bound on the post-turn reconcile window. Rows that outlive
 * it stay "running in background" in the UI until the next session
 * load re-reads the ledger.
 */
const ZOMBIE_SUBAGENT_WATCH_MAX_MS = 10 * 60_000;
/**
 * Consecutive `unknown` working-state reads tolerated before a
 * recovered turn fails. `unknown` means the daemon stopped attributing
 * a state to the session (connection loss, registry eviction) — never
 * a clean idle — so persisting it must surface as a failure, not a
 * silent completion.
 */
const RECOVERED_TURN_MAX_UNKNOWN_READS = 3;
const RECOVERED_HISTORY_FAILED_MESSAGE =
  'The turn finished in the background, but its result could not be ' +
  'reloaded. Open the session again from History to see it.';
const RUNTIME_EVENT_ERROR_MESSAGE =
  'Droid reported a runtime error while processing this turn.';
const ASSISTANT_OUTPUT_TRUNCATED_MESSAGE =
  'Assistant output exceeded the display limit and was truncated.';
const CATALOG_ERROR_MESSAGE =
  'Saved Droid sessions could not be loaded.';
const SESSION_OPERATION_BLOCKED_MESSAGE =
  'Finish the current Droid activity before changing sessions.';
const UNKNOWN_SESSION_MESSAGE =
  'The selected Droid session is not available in this workspace.';
const SESSION_CLOSE_FAILED_MESSAGE =
  'The current Droid session could not be closed.';
const SESSION_RESUME_FAILED_MESSAGE =
  'The selected Droid session could not be opened.';
const SESSION_NEW_FAILED_MESSAGE =
  'A new Droid session could not be created.';
const WORKTREE_CREATE_UNAVAILABLE_MESSAGE =
  'Worktree sessions need the daemon runtime mode and a git workspace.';
const WORKSPACE_CHANGED_MESSAGE =
  'The workspace changed before the Droid session could be opened.';
const RENAME_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before renaming.';
const RENAME_UNSUPPORTED_MESSAGE =
  'This session cannot be renamed.';
const RENAME_FAILED_MESSAGE =
  'Droid could not rename the session.';
const FAVORITE_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before changing favorites.';
const FAVORITE_UNSUPPORTED_MESSAGE =
  'Session favorites are not available in this Droid runtime.';
const FAVORITE_FAILED_MESSAGE =
  'The session favorite could not be saved.';
const DAEMON_UNSUPPORTED_MESSAGE =
  'Archive and search are not available in this Droid runtime.';
const ARCHIVE_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before archiving.';
const ARCHIVE_ACTIVE_MESSAGE =
  'Switch to another session before archiving the active one.';
const ARCHIVE_FAILED_MESSAGE = 'The session could not be archived.';
const UNARCHIVE_FAILED_MESSAGE =
  'The session could not be restored from the archive.';
const COMPACT_BLOCKED_MESSAGE =
  'Droid cannot compact right now. Wait for the current activity to finish.';
const COMPACT_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support context compaction.';
const COMPACT_FAILED_MESSAGE =
  'Droid could not compact the conversation.';
const FORK_BLOCKED_MESSAGE =
  'Droid cannot fork right now. Wait for the current activity to finish.';
const FORK_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support session forking.';
const FORK_FAILED_MESSAGE = 'Droid could not fork this session.';
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
        if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
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
        void this.handleReady();
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
        if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
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
        if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
          return;
        }
        this.interactions.respondAskUser(message);
        return;
      case 'sessions.refresh':
        this.handleRefresh();
        return;
      case 'session.select':
        this.handleSessionSelect(message.sessionId);
        return;
      case 'session.new':
        this.handleSessionNew();
        return;
      case 'worktree.createSession':
        this.handleWorktreeCreateSession();
        return;
      case 'session.rename':
        this.handleSessionRename(message.sessionId, message.title);
        return;
      case 'session.favorite':
        this.handleSessionFavorite(
          message.sessionId,
          message.favorite,
        );
        return;
      case 'session.archive':
        this.handleSessionArchive(message.sessionId);
        return;
      case 'session.unarchive':
        this.handleSessionUnarchive(message.sessionId);
        return;
      case 'sessions.archivedRefresh':
        this.handleArchivedRefresh();
        return;
      case 'session.search':
        this.handleSessionSearch(message.query);
        return;
      case 'session.context.refresh':
        handleContextRefresh(this, message.sessionId);
        return;
      case 'session.compact':
        this.handleSessionCompact(message.sessionId);
        return;
      case 'session.fork':
        this.handleSessionFork(message.sessionId);
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
    this.resetSessionMetadata();
    if (
      this.recoveryCheckpointTimer !== null ||
      this.pendingRecoveryCheckpoint !== null
    ) {
      this.checkpointRecoveryTranscript();
    }
    this.runtime = null;
    this.activeRuntimeCwd = null;
    this.turn = null;
    this.interactions.cancelAll();
    if (isUsableWorkspace(workspace)) {
      this.bindCatalogViewToWorkspace(workspace.cwd);
      this.connection = {
        status: 'unavailable',
        message: WORKSPACE_CHANGED_MESSAGE,
      };
      this.emitSnapshot();
    } else {
      this.clearCatalog();
      this.emitWorkspaceUnavailable(workspace);
    }
    this.queueWorkspaceTransition(generation, staleRuntimes);
  }

  dispose(): Promise<void> {
    if (this.disposal) {
      return this.disposal;
    }

    this.checkpointRecoveryTranscript();
    this.interactions.cancelAll();
    this.btwSideChat?.reset();
    if (this.mcpAuthTimer !== null) {
      clearTimeout(this.mcpAuthTimer);
      this.mcpAuthTimer = null;
    }
    this.mcpAuthServerName = null;
    this.clearZombieSubagentWatch();
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
        ...runtimes.map((runtime) => this.closeRuntime(runtime)),
        this.recoveryStore.flush(),
      ]);
      await this.recoveryStore.dispose();
    })();
    return this.disposal;
  }

  private async handleReady(): Promise<void> {
    if (this.initialization) {
      await this.initialization;
      await this.waitForWorkspaceTransition();
      if (this.disposed) {
        return;
      }
      if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
        return;
      }
      this.emitSnapshot();
      this.interactions.replayPending();
      return;
    }

    this.initialization = this.startup();
    await this.initialization;
  }

  private async startup(): Promise<void> {
    let recoveryLoaded = false;
    while (!this.disposed) {
      const workspace = this.getWorkspaceContext();
      if (!isUsableWorkspace(workspace)) {
        this.clearCatalog();
        this.emitWorkspaceUnavailable(workspace);
        return;
      }

      this.connection = { status: 'connecting' };
      const catalogRequest = this.beginCatalogLoad(workspace.cwd);
      const catalogPromise = this.loadCatalog(workspace.cwd);
      if (!recoveryLoaded) {
        await this.recoveryStore.load();
        recoveryLoaded = true;
        if (this.disposed) {
          return;
        }
        this.emitEarlyRecoverySnapshot();
      }
      const catalog = await catalogPromise;
      if (this.disposed) {
        return;
      }
      if (!this.isCurrentCatalogRequest(catalogRequest, workspace.cwd)) {
        this.discardCatalogRequest(catalogRequest);
        continue;
      }
      this.sessions = catalog;
      seedBackgroundRunning(this, workspace.cwd);

      const selectedSessionId =
        this.recoveryStore.getSelectedSessionId();
      const resumable =
        selectedSessionId !== null &&
        this.hasCatalogSession(selectedSessionId, workspace.cwd);
      const target: RuntimeSessionTarget = resumable
        ? {
            kind: 'resume',
            cwd: workspace.cwd,
            sessionId: selectedSessionId,
          }
        : { kind: 'new', cwd: workspace.cwd };
      await this.activateInitialRuntime(
        target,
        resumable ? selectedSessionId : null,
      );
      if (this.isTargetWorkspaceCurrent(workspace.cwd)) {
        return;
      }
    }
  }

  /**
   * Pushes the locally recovered checkpoint transcript to the webview
   * before the slow catalog/history/runtime activation completes, so a
   * reopened window paints content immediately. The connection stays
   * `connecting`, which keeps every mutating handler rejected until the
   * authoritative activation snapshot replaces this one wholesale.
   */
  private emitEarlyRecoverySnapshot(): void {
    const sessionId = this.recoveryStore.getSelectedSessionId();
    if (sessionId === null) {
      return;
    }
    const checkpoint = this.recoveryStore.readSession(sessionId);
    if (
      checkpoint === undefined ||
      checkpoint.transcript.length === 0
    ) {
      return;
    }
    this.sessionId = sessionId;
    this.transcript = checkpoint;
    this.recordHost({
      level: 'info',
      name: 'host.perf.early-snapshot',
      attributes: {
        sessionId,
        items: checkpoint.transcript.length,
      },
    });
    this.emitSnapshot();
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
      !this.ensureActiveRuntimeWorkspaceCurrent()
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
    this.scheduleRecoveryCheckpoint();
    this.touchActiveSession();
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
        this.scheduleRecoveryCheckpoint();
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
        void this.flushRecoveryCheckpoint();
        this.settleTurnSubagents(sessionId, turnId);
        this.refreshContextAfterTurn(sessionId);
        this.finishSpecHandoff(sessionId, turnId);
        return;
      case 'interrupted':
        this.publishTurnChanges(sessionId, turnId);
        this.setTurnStatus(sessionId, turnId, 'interrupted');
        void this.flushRecoveryCheckpoint();
        this.settleTurnSubagents(sessionId, turnId);
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
    this.startReplacement({
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
      this.scheduleRecoveryCheckpoint();
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
      !this.ensureActiveRuntimeWorkspaceCurrent()
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
      !this.ensureActiveRuntimeWorkspaceCurrent()
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
      this.activeSessionSummary()?.title ?? 'Current session';
    // The compacted session stays in the catalog: its file remains on
    // disk with the full pre-compaction history, and the compaction
    // divider's "View full history" jump needs it selectable.
    this.sessionId = compactedSessionId;
    this.turn = null;
    clearPendingAttachments(this);
    this.sessions = this.withActiveSession(this.sessions, {
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
      const loaded = await this.loadHistoryTimed(
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

  private handleSessionFork(sessionId: string): void {
    const runtime = this.runtime;
    if (
      runtime !== null &&
      !this.ensureActiveRuntimeWorkspaceCurrent()
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
        'session-fork-blocked',
        FORK_BLOCKED_MESSAGE,
      );
      return;
    }
    if (typeof runtime.fork !== 'function') {
      this.emitSessionDiagnostic(
        'session-fork-unsupported',
        FORK_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    this.sessionOperationInProgress = true;
    void this.performFork(runtime, sessionId).finally(() => {
      this.sessionOperationInProgress = false;
    });
  }

  /**
   * Forks the active session and adopts the copy that Droid returns.
   * The original session stays in the catalog so the user can go back
   * to it; the current transcript carries over unchanged.
   */
  private async performFork(
    runtime: DroidRuntime,
    sessionId: string,
  ): Promise<void> {
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }

    const previousTitle =
      this.activeSessionSummary()?.title ?? 'Current session';
    const forkTitle = forkTitleFromText(`${previousTitle} (fork)`);

    let forkedSessionId: string;
    try {
      const result = await runtime.fork!(forkTitle);
      forkedSessionId = result.sessionId;
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
          'session-fork-failed',
          FORK_FAILED_MESSAGE,
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
    if (
      !isSafeBridgeId(forkedSessionId) ||
      forkedSessionId === sessionId
    ) {
      this.emitSessionDiagnostic(
        'session-fork-failed',
        FORK_FAILED_MESSAGE,
      );
      return;
    }

    // Unlike compaction, the forked-from session remains valid and
    // stays in the catalog; only the active marker moves to the fork.
    this.sessionId = forkedSessionId;
    this.turn = null;
    clearPendingAttachments(this);
    this.sessions = this.withActiveSession(this.sessions, {
      id: forkedSessionId,
      title: forkTitle,
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    });

    // The fork copies the conversation, but message IDs may differ, so
    // reload its history; keep the current transcript if that fails.
    let transcript: HostTranscriptState | null = null;
    let mission: SessionMissionSummary | null = null;
    let tokenUsage: TokenUsageBreakdown | null = null;
    {
      const loaded = await this.loadHistoryTimed(cwd, forkedSessionId);
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
        forkedSessionId,
        cwd,
      )
    ) {
      return;
    }
    this.mission = mission;
    // The fork is a new session; its counters restart.
    this.tokenUsage = { cumulative: tokenUsage, lastTurn: null };
    this.transcript =
      transcript ?? { ...this.transcript, historyStatus: 'partial' };
    this.recoveryStore.writeSession(forkedSessionId, this.transcript);
    this.recoveryStore.selectSession(forkedSessionId);
    void this.recoveryStore.flush();
    this.emitSnapshot();
    this.emit({
      type: 'runtime.diagnostic',
      sessionId: forkedSessionId,
      turnId: null,
      severity: 'info',
      code: 'session-forked',
      message: 'Session forked. You are now on the copy.',
    });
    this.refreshContextAfterTurn(forkedSessionId);
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
      this.emitWorkspaceUnavailable(workspace);
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
      this.hasCatalogSession(this.sessionId, workspace.cwd)
        ? this.sessionId
        : null;
    this.startReplacement(
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
    const catalogRequest = this.beginCatalogLoad(cwd);
    this.emitSnapshot();
    const [, catalog] = await Promise.all([
      this.recoveryStore.load(),
      this.loadCatalog(cwd),
    ]);
    if (this.disposed) {
      return;
    }
    if (!this.isCurrentCatalogRequest(catalogRequest, cwd)) {
      this.discardCatalogRequest(catalogRequest);
      return;
    }
    this.sessions = catalog;
    seedBackgroundRunning(this, cwd);
    const selectedSessionId =
      this.recoveryStore.getSelectedSessionId();
    await this.replaceRuntime(
      selectedSessionId !== null &&
        this.hasCatalogSession(selectedSessionId, cwd)
        ? {
            kind: 'resume',
            cwd,
            sessionId: selectedSessionId,
          }
        : { kind: 'new', cwd },
    );
  }

  private handleSessionNew(): void {
    const workspace = this.getWorkspaceContext();
    if (!this.canReplaceSession() || !isUsableWorkspace(workspace)) {
      if (!isUsableWorkspace(workspace)) {
        this.emitWorkspaceUnavailable(workspace);
      }
      return;
    }
    this.bindCatalogViewToWorkspace(workspace.cwd);
    this.startReplacement({ kind: 'new', cwd: workspace.cwd });
  }

  private handleWorktreeCreateSession(): void {
    const workspace = this.getWorkspaceContext();
    if (!this.canReplaceSession() || !isUsableWorkspace(workspace)) {
      if (!isUsableWorkspace(workspace)) {
        this.emitWorkspaceUnavailable(workspace);
      }
      return;
    }
    // The drawer entry never renders without the advertised
    // capability, so a request without it is stale or hostile. Fail
    // closed with a diagnostic instead of degrading to a plain
    // in-workspace session.
    if (
      this.worktreeSessions?.enabled !== true ||
      !this.worktreeCreateAvailable
    ) {
      this.emitSessionDiagnostic(
        'worktree-create-unavailable',
        WORKTREE_CREATE_UNAVAILABLE_MESSAGE,
      );
      return;
    }
    this.bindCatalogViewToWorkspace(workspace.cwd);
    this.startReplacement({
      kind: 'new',
      cwd: workspace.cwd,
      worktree: true,
    });
  }

  private handleSessionRename(sessionId: string, title: string): void {
    const runtime = this.runtime;
    if (
      runtime !== null &&
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
      return;
    }
    const trimmedTitle = title.trim();
    if (
      runtime === null ||
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId ||
      trimmedTitle.length === 0
    ) {
      return;
    }
    if (
      this.sessionOperationInProgress ||
      this.refreshInProgress
    ) {
      this.emitSessionDiagnostic(
        'session-rename-blocked',
        RENAME_BLOCKED_MESSAGE,
      );
      return;
    }
    if (typeof runtime.rename !== 'function') {
      this.emitSessionDiagnostic(
        'session-rename-unsupported',
        RENAME_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }
    void runtime.rename(trimmedTitle).then(
      () => {
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
        this.sessions = {
          ...this.sessions,
          items: this.sessions.items.map((item) =>
            item.id === sessionId
              ? { ...item, title: trimmedTitle }
              : item,
          ),
        };
        this.emitSnapshot();
      },
      () => {
        if (
          this.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          this.emitSessionDiagnostic(
            'session-rename-failed',
            RENAME_FAILED_MESSAGE,
          );
        }
      },
    );
  }

  private handleSessionFavorite(
    sessionId: string,
    favorite: boolean,
  ): void {
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (this.sessionOperationInProgress || this.refreshInProgress) {
      this.emitSessionDiagnostic(
        'session-favorite-blocked',
        FAVORITE_BLOCKED_MESSAGE,
      );
      return;
    }
    if (
      this.sessions.status !== 'ready' ||
      !this.hasCatalogSession(sessionId, workspace.cwd)
    ) {
      this.emitSessionDiagnostic(
        'session-favorite-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      return;
    }
    const writeFavorite = this.sessionCatalog.writeFavorite?.bind(
      this.sessionCatalog,
    );
    if (writeFavorite === undefined) {
      this.emitSessionDiagnostic(
        'session-favorite-unsupported',
        FAVORITE_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    // Blocks concurrent catalog reads/writes for the duration of the
    // file write and the follow-up re-list.
    this.refreshInProgress = true;
    void (async () => {
      let written = false;
      try {
        written = await writeFavorite(sessionId, favorite);
      } catch {
        written = false;
      }
      if (this.disposed) {
        return;
      }
      if (!written) {
        this.refreshInProgress = false;
        this.emitSessionDiagnostic(
          'session-favorite-failed',
          FAVORITE_FAILED_MESSAGE,
        );
        return;
      }

      // Close the loop through the public listSessions() readback so
      // the drawer shows what the SDK actually reports.
      const previousActive = this.activeSessionSummary();
      const catalogGeneration = this.catalogGeneration;
      const result = await this.loadCatalog(workspace.cwd);
      this.refreshInProgress = false;
      if (
        this.disposed ||
        this.catalogGeneration !== catalogGeneration ||
        this.catalogCwd !== workspace.cwd ||
        !this.isTargetWorkspaceCurrent(workspace.cwd)
      ) {
        return;
      }
      if (result.status === 'ready') {
        this.sessions = this.withActiveSession(result, previousActive);
        seedBackgroundRunning(this, workspace.cwd);
      } else {
        // The write succeeded but the re-list failed; reflect the
        // write locally so the toggle does not look ignored.
        this.sessions = {
          ...this.sessions,
          items: this.sessions.items.map((item) =>
            item.id === sessionId
              ? { ...item, isFavorite: favorite }
              : item,
          ),
        };
      }
      this.emitSnapshot();
    })();
  }

  /**
   * Archives a non-active catalog session through the daemon sidecar,
   * then closes the loop with a catalog re-list (the process-path
   * `listSessions` skips archived sessions) and an archived-list
   * refresh.
   */
  private handleSessionArchive(sessionId: string): void {
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (this.sessionOperationInProgress || this.refreshInProgress) {
      this.emitSessionDiagnostic(
        'session-archive-blocked',
        ARCHIVE_BLOCKED_MESSAGE,
      );
      return;
    }
    if (
      this.sessions.status !== 'ready' ||
      !this.hasCatalogSession(sessionId, workspace.cwd)
    ) {
      this.emitSessionDiagnostic(
        'session-archive-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      return;
    }
    if (sessionId === this.sessionId) {
      this.emitSessionDiagnostic(
        'session-archive-active',
        ARCHIVE_ACTIVE_MESSAGE,
      );
      return;
    }
    const daemonSessions = this.daemonSessions;
    if (daemonSessions === undefined) {
      this.emitSessionDiagnostic(
        'session-archive-unsupported',
        DAEMON_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    this.refreshInProgress = true;
    void (async () => {
      let archived = false;
      let failure = ARCHIVE_FAILED_MESSAGE;
      try {
        archived = await (await daemonSessions()).archive(sessionId);
      } catch (error) {
        failure = daemonFailureMessage(error, ARCHIVE_FAILED_MESSAGE);
      }
      if (this.disposed) {
        return;
      }
      if (!archived) {
        this.refreshInProgress = false;
        this.emitSessionDiagnostic('session-archive-failed', failure);
        return;
      }
      await this.reloadCatalogAfterDaemonWrite(workspace.cwd);
    })();
  }

  /**
   * Restores an archived session. The id is not required to be in the
   * live catalog (archived sessions left it), only shape-validated by
   * the Bridge.
   */
  private handleSessionUnarchive(sessionId: string): void {
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (this.sessionOperationInProgress || this.refreshInProgress) {
      this.emitSessionDiagnostic(
        'session-unarchive-blocked',
        ARCHIVE_BLOCKED_MESSAGE,
      );
      return;
    }
    const daemonSessions = this.daemonSessions;
    if (daemonSessions === undefined) {
      this.emitSessionDiagnostic(
        'session-unarchive-unsupported',
        DAEMON_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    this.refreshInProgress = true;
    void (async () => {
      let restored = false;
      let failure = UNARCHIVE_FAILED_MESSAGE;
      try {
        restored = await (await daemonSessions()).unarchive(sessionId);
      } catch (error) {
        failure = daemonFailureMessage(error, UNARCHIVE_FAILED_MESSAGE);
      }
      if (this.disposed) {
        return;
      }
      if (!restored) {
        this.refreshInProgress = false;
        this.emitSessionDiagnostic('session-unarchive-failed', failure);
        return;
      }
      await this.reloadCatalogAfterDaemonWrite(workspace.cwd);
    })();
  }

  /**
   * Shared readback after a successful daemon archive/unarchive:
   * re-list the regular catalog, emit the snapshot, then refresh the
   * archived section. Clears `refreshInProgress`.
   */
  private async reloadCatalogAfterDaemonWrite(
    cwd: string,
  ): Promise<void> {
    const previousActive = this.activeSessionSummary();
    const catalogGeneration = this.catalogGeneration;
    const result = await this.loadCatalog(cwd);
    this.refreshInProgress = false;
    if (this.disposed) {
      return;
    }
    if (
      this.catalogGeneration === catalogGeneration &&
      this.catalogCwd === cwd &&
      this.isTargetWorkspaceCurrent(cwd) &&
      result.status === 'ready'
    ) {
      this.sessions = this.withActiveSession(result, previousActive);
      seedBackgroundRunning(this, cwd);
      this.emitSnapshot();
    }
    await this.refreshArchived(cwd);
  }

  private handleArchivedRefresh(): void {
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    void this.refreshArchived(workspace.cwd);
  }

  private async refreshArchived(cwd: string): Promise<void> {
    const daemonSessions = this.daemonSessions;
    if (daemonSessions === undefined) {
      this.emit({
        type: 'session.archived',
        archived: {
          status: 'error',
          items: [],
          message: DAEMON_UNSUPPORTED_MESSAGE,
        },
      });
      return;
    }
    this.emit({
      type: 'session.archived',
      archived: { status: 'loading', items: [] },
    });
    let items: readonly ArchivedSessionSummary[];
    try {
      items = (await (await daemonSessions()).listArchived(cwd)).slice(
        0,
        MAX_ARCHIVED_SESSION_ITEMS,
      );
    } catch (error) {
      // The unavailable copy renders only inside the drawer; without
      // this record a failed daemon acquire leaves no local-log trace.
      this.recordPanelFailure(
        'archived-load-failed',
        formatUnknownError(error),
      );
      if (!this.disposed) {
        this.emit({
          type: 'session.archived',
          archived: {
            status: 'error',
            items: [],
            message: daemonFailureMessage(
              error,
              DAEMON_UNAVAILABLE_MESSAGE,
            ),
          },
        });
      }
      return;
    }
    if (this.disposed || !this.isTargetWorkspaceCurrent(cwd)) {
      return;
    }
    this.emit({
      type: 'session.archived',
      archived: { status: 'ready', items },
    });
  }

  private handleSessionSearch(query: string): void {
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    const daemonSessions = this.daemonSessions;
    if (daemonSessions === undefined) {
      this.emit({
        type: 'session.searchResults',
        search: {
          status: 'error',
          query,
          items: [],
          message: DAEMON_UNSUPPORTED_MESSAGE,
        },
      });
      return;
    }
    void (async () => {
      try {
        const matches = (
          await (await daemonSessions()).search(query)
        ).slice(0, MAX_SESSION_SEARCH_RESULTS);
        if (this.disposed) {
          return;
        }
        this.emit({
          type: 'session.searchResults',
          search: { status: 'ready', query, items: matches },
        });
      } catch (error) {
        if (this.disposed) {
          return;
        }
        this.emit({
          type: 'session.searchResults',
          search: {
            status: 'error',
            query,
            items: [],
            message: daemonFailureMessage(
              error,
              DAEMON_UNAVAILABLE_MESSAGE,
            ),
          },
        });
      }
    })();
  }

  private handleSessionSelect(sessionId: string): void {
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      this.clearCatalog();
      this.emitWorkspaceUnavailable(workspace);
      return;
    }
    if (!this.canReplaceSession()) {
      return;
    }
    if (this.catalogCwd !== workspace.cwd) {
      this.emitSessionDiagnostic(
        'session-selection-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      this.startCatalogRefresh(workspace.cwd);
      return;
    }
    if (
      this.sessions.status !== 'ready' ||
      !this.hasCatalogSession(sessionId, workspace.cwd)
    ) {
      this.emitSessionDiagnostic(
        'session-selection-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      return;
    }
    if (
      sessionId === this.sessionId &&
      this.activeRuntimeCwd === workspace.cwd
    ) {
      this.emitSnapshot();
      return;
    }
    this.startReplacement({
      kind: 'resume',
      cwd: workspace.cwd,
      sessionId,
    });
  }

  private handleRefresh(): void {
    if (
      this.connection.status === 'connecting' ||
      this.refreshInProgress ||
      this.sessionOperationInProgress
    ) {
      this.emitSessionDiagnostic(
        'session-operation-blocked',
        SESSION_OPERATION_BLOCKED_MESSAGE,
      );
      return;
    }
    const workspace = this.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      this.emitWorkspaceUnavailable(workspace);
      return;
    }

    this.startCatalogRefresh(workspace.cwd);
  }

  private startCatalogRefresh(cwd: string): void {
    const previousActive = this.activeSessionSummary();
    const catalogRequest = this.beginCatalogLoad(cwd);
    this.refreshInProgress = true;
    this.emitSnapshot();
    void this.refreshCatalog(
      cwd,
      catalogRequest,
      previousActive,
    ).finally(() => {
      this.refreshInProgress = false;
    });
  }

  private async refreshCatalog(
    cwd: string,
    catalogRequest: number,
    previousActive: SessionSummary | undefined,
  ): Promise<void> {
    const result = await this.loadCatalog(cwd);
    if (this.disposed) {
      return;
    }
    if (!this.isCurrentCatalogRequest(catalogRequest, cwd)) {
      this.discardCatalogRequest(catalogRequest);
      return;
    }
    if (result.status === 'error') {
      this.sessions = {
        status: 'error',
        items: this.markActive(this.sessions.items),
        message: CATALOG_ERROR_MESSAGE,
      };
    } else {
      this.sessions = this.withActiveSession(
        result,
        previousActive,
      );
      seedBackgroundRunning(this, cwd);
    }
    this.emitSnapshot();
  }

  private canReplaceSession(): boolean {
    // A running daemon-backed turn no longer blocks switching:
    // replaceRuntime detaches it and the turn continues on the daemon
    // (the drawer row then carries the quiet running indicator). A
    // process-mode turn still blocks — disposal would kill it. An
    // unanswered interaction always blocks: it must be settled first.
    const turnBlocks =
      isTurnActive(this.turn) &&
      this.runtime?.supportsBackgroundTurns?.() !== true;
    if (
      turnBlocks ||
      this.interactions.hasPending() ||
      this.connection.status === 'connecting' ||
      this.sessionOperationInProgress ||
      this.refreshInProgress ||
      this.settingsUpdate !== null
    ) {
      this.emitSessionDiagnostic(
        'session-operation-blocked',
        SESSION_OPERATION_BLOCKED_MESSAGE,
      );
      return false;
    }
    return true;
  }

  private startReplacement(target: RuntimeSessionTarget): void {
    this.sessionOperationInProgress = true;
    this.connection = { status: 'connecting' };
    this.emitSnapshot();
    void this.replaceRuntime(target).finally(() => {
      this.sessionOperationInProgress = false;
    });
  }

  private async replaceRuntime(
    target: RuntimeSessionTarget,
  ): Promise<void> {
    const switchStartedAt = performance.now();
    // Captured before any state reset: a live daemon-backed turn
    // survives the switch. Disposal then detaches instead of
    // interrupting, and the old session's drawer row keeps a running
    // indicator until the daemon reports it idle.
    const detachedSessionId =
      this.runtime !== null &&
      isTurnActive(this.turn) &&
      this.runtime.supportsBackgroundTurns?.() === true
        ? this.sessionId
        : null;
    const generation = ++this.runtimeGeneration;
    this.turnGeneration += 1;
    this.resetSessionMetadata();
    this.interactions.cancelAll();
    await this.flushRecoveryCheckpoint();
    if (!this.isCurrentRuntimeGeneration(generation)) {
      return;
    }
    if (!this.isTargetWorkspaceCurrent(target.cwd)) {
      this.reportWorkspaceChanged(generation);
      return;
    }

    const previousRuntime = this.runtime;
    if (previousRuntime) {
      try {
        await this.closeRuntime(
          previousRuntime,
          detachedSessionId !== null,
        );
      } catch {
        if (
          this.isCurrentRuntimeGeneration(generation) &&
          this.isTargetWorkspaceCurrent(target.cwd)
        ) {
          this.connection = {
            status: 'unavailable',
            message: SESSION_CLOSE_FAILED_MESSAGE,
          };
          this.emitSessionDiagnostic(
            'session-close-failed',
            SESSION_CLOSE_FAILED_MESSAGE,
          );
          this.emitSnapshot();
        } else if (this.isCurrentRuntimeGeneration(generation)) {
          this.reportWorkspaceChanged(generation);
        }
        return;
      }
      if (!this.isCurrentRuntimeGeneration(generation)) {
        return;
      }
      if (this.runtime === previousRuntime) {
        this.runtime = null;
      }
      if (detachedSessionId !== null) {
        // The turn now runs unattended on the daemon: drop the local
        // projection without a terminal turn.state (the turn did not
        // end) and flag the row for the background watcher.
        this.turn = null;
        this.diagnostics?.endTurnScope?.();
        setSessionRunning(this, detachedSessionId, true);
        ensureBackgroundRunningPoll(this);
      }
      if (!this.isTargetWorkspaceCurrent(target.cwd)) {
        this.reportWorkspaceChanged(generation);
        return;
      }
    }

    // The transcript projection and the runtime resume each spawn their
    // own droid CLI process and stay independent until activateRuntime
    // consumes both; running them serially doubled session-switch
    // latency (9-12s observed). Neither branch throws: both funnel
    // failures into their return values.
    const [transcript, activation] = await Promise.all([
      this.prepareActivationTranscript(target, generation),
      this.createInitializedRuntime(target, generation),
    ]);
    if (
      transcript === null ||
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      // A stale switch can still hold a live runtime when the
      // invalidation landed after createInitializedRuntime's own
      // staleness checks had already passed.
      if (activation !== null && activation.status === 'available') {
        await this.closeRuntime(activation.runtime).catch(
          () => undefined,
        );
      }
      if (
        this.isCurrentRuntimeGeneration(generation) &&
        !this.isTargetWorkspaceCurrent(target.cwd)
      ) {
        this.reportWorkspaceChanged(generation);
      }
      return;
    }
    if (activation === null) {
      return;
    }
    if (activation.status === 'failed') {
      this.connection = {
        status: 'unavailable',
        message:
          target.kind === 'resume'
            ? SESSION_RESUME_FAILED_MESSAGE
            : SESSION_NEW_FAILED_MESSAGE,
      };
      this.emitSessionDiagnostic(
        target.kind === 'resume'
          ? 'session-resume-failed'
          : 'session-new-failed',
        this.connection.message!,
      );
      this.emitSnapshot();
      return;
    }

    if (!this.isTargetWorkspaceCurrent(target.cwd)) {
      await this.closeRuntime(activation.runtime).catch(() => undefined);
      this.reportWorkspaceChanged(generation);
      return;
    }
    await this.activateRuntime(
      target,
      activation.runtime,
      activation.id,
      generation,
      transcript,
    );
    // End-to-end switch latency, from the replace request to the
    // activated runtime — the number the parallel activation above is
    // meant to shrink (verification for the serial 9-12s baseline).
    this.recordHost({
      level: 'info',
      name: 'host.perf.session-switch',
      attributes: {
        kind: target.kind,
        durationMs: Math.round(performance.now() - switchStartedAt),
      },
    });
  }

  private async activateInitialRuntime(
    target: RuntimeSessionTarget,
    failedResumeId: string | null,
  ): Promise<void> {
    const generation = ++this.runtimeGeneration;
    // Same parallel activation as replaceRuntime: history projection
    // and runtime resume are independent droid CLI processes.
    const [transcript, activation] = await Promise.all([
      this.prepareActivationTranscript(target, generation),
      this.createInitializedRuntime(target, generation),
    ]);
    if (
      transcript === null ||
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      if (activation !== null && activation.status === 'available') {
        await this.closeRuntime(activation.runtime).catch(
          () => undefined,
        );
      }
      return;
    }
    if (activation === null) {
      return;
    }
    if (activation.status === 'failed') {
      if (failedResumeId) {
        this.sessionId = failedResumeId;
        this.transcript =
          this.recoveryStore.readSession(failedResumeId) ??
          createHostTranscriptState('unavailable');
        this.sessions = this.withActiveSession(this.sessions);
      } else {
        this.sessionId = null;
        this.mission = null;
        this.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
        this.transcript = createHostTranscriptState('unavailable');
      }
      this.connection = {
        status: 'unavailable',
        message: activation.message,
      };
      this.emitSnapshot();
      return;
    }
    if (!this.isTargetWorkspaceCurrent(target.cwd)) {
      await this.closeRuntime(activation.runtime).catch(() => undefined);
      return;
    }
    await this.activateRuntime(
      target,
      activation.runtime,
      activation.id,
      generation,
      transcript,
    );
  }

  private async prepareActivationTranscript(
    target: RuntimeSessionTarget,
    generation: number,
  ): Promise<HostTranscriptState | null> {
    if (target.kind === 'new') {
      this.mission = null;
      this.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
      return createHostTranscriptState('complete');
    }

    const recovered = this.recoveryStore.readSession(target.sessionId);
    const loaded = await this.loadHistoryTimed(
      target.cwd,
      target.sessionId,
    );
    if (
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      return null;
    }
    this.mission =
      loaded?.status === 'available' ? (loaded.mission ?? null) : null;
    // Cumulative usage persists in the session file; `lastTurn` does
    // not (history carries no per-turn usage), so it starts null.
    this.tokenUsage = {
      cumulative:
        loaded?.status === 'available'
          ? (loaded.tokenUsage ?? null)
          : null,
      lastTurn: null,
    };
    if (loaded?.status === 'available') {
      const reconcileStart = performance.now();
      const reconciled = reconcileSessionHistory(
        loaded.state,
        recovered,
      );
      // Recovery reconciliation accounting (P7): a merge that degrades
      // to concatenation (reconciled ≈ recovered + loaded) is the
      // signature of the duplicate-transcript / duplicate-toolUseId
      // class of bugs.
      this.recordHost({
        level: 'info',
        name: 'host.perf.recovery',
        attributes: {
          sessionId: target.sessionId,
          recovered: recovered?.transcript.length ?? 0,
          loaded: loaded.state.transcript.length,
          reconciled: reconciled.transcript.length,
          reconcileMs: Math.round(
            performance.now() - reconcileStart,
          ),
        },
      });
      return reconciled;
    }
    return recovered ?? createHostTranscriptState('unavailable');
  }

  /** Timed history load with a structured log record (P6). */
  private async loadHistoryTimed(
    cwd: string,
    sessionId: string,
  ): Promise<Awaited<
    ReturnType<SessionHistoryLoader['loadHistory']>
  > | null> {
    const startedAt = performance.now();
    try {
      const loaded = await this.sessionHistory.loadHistory({
        cwd,
        sessionId,
      });
      this.recordHost({
        level: 'info',
        name: 'runtime.history.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: loaded.status,
          sessionId,
          ...(loaded.status === 'available'
            ? {
                items: loaded.state.transcript.length,
                historyStatus: loaded.state.historyStatus,
              }
            : {}),
        },
      });
      return loaded;
    } catch (error) {
      this.recordHost({
        level: 'error',
        name: 'runtime.history.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'failed',
          sessionId,
        },
        detail: formatUnknownError(error),
      });
      return null;
    }
  }

  private async createInitializedRuntime(
    target: RuntimeSessionTarget,
    generation: number,
  ): Promise<
    | {
        readonly status: 'available';
        readonly runtime: DroidRuntime;
        readonly id: string;
      }
    | { readonly status: 'failed'; readonly message: string }
    | null
  > {
    let runtime: DroidRuntime;
    try {
      runtime = this.createRuntime(
        this.interactions.createRuntimeHandler(),
      );
    } catch {
      return {
        status: 'failed',
        message: 'The local Droid runtime could not be created.',
      };
    }
    this.managedRuntimes.add(runtime);
    // A daemon resume replays permission/ask-user requests that were
    // pending when the previous window died. Without an active
    // interaction context the coordinator would answer them with an
    // automatic cancel, killing the daemon-side turn. The synthesized
    // recovery turn holds them until reload reconciliation
    // (reconcileDaemonTurn) decides whether the turn is still live.
    const releaseRecoveryContext = (): void => {
      if (target.kind === 'resume') {
        this.interactions.endTurn(
          target.sessionId,
          recoveryTurnId(generation),
        );
      }
    };
    if (target.kind === 'resume') {
      this.interactions.beginTurn(
        target.sessionId,
        recoveryTurnId(generation),
      );
    }

    let availability: RuntimeAvailability;
    try {
      availability = await runtime.initialize(target);
    } catch {
      releaseRecoveryContext();
      await this.closeRuntime(runtime).catch(() => undefined);
      return this.isCurrentRuntimeGeneration(generation) &&
        this.isTargetWorkspaceCurrent(target.cwd)
        ? {
            status: 'failed',
            message: 'The local Droid runtime could not be initialized.',
          }
        : null;
    }

    if (
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      releaseRecoveryContext();
      await this.closeRuntime(runtime).catch(() => undefined);
      return null;
    }
    if (
      availability.status === 'unavailable' ||
      !isSafeBridgeId(availability.sessionId) ||
      (target.kind === 'resume' &&
        availability.sessionId !== target.sessionId)
    ) {
      releaseRecoveryContext();
      await this.closeRuntime(runtime).catch(() => undefined);
      if (
        !this.isCurrentRuntimeGeneration(generation) ||
        !this.isTargetWorkspaceCurrent(target.cwd)
      ) {
        return null;
      }
      return {
        status: 'failed',
        message:
          availability.status === 'unavailable'
            ? unavailableMessage(availability.reason)
            : target.kind === 'resume'
              ? SESSION_RESUME_FAILED_MESSAGE
              : SESSION_NEW_FAILED_MESSAGE,
      };
    }

    return {
      status: 'available',
      runtime,
      id: availability.sessionId,
    };
  }

  private async activateRuntime(
    target: RuntimeSessionTarget,
    runtime: DroidRuntime,
    sessionId: string,
    generation: number,
    transcript: HostTranscriptState,
  ): Promise<void> {
    if (
      !this.isActivationCandidateCurrent(
        runtime,
        generation,
        target.cwd,
      )
    ) {
      await this.closeRuntime(runtime).catch(() => undefined);
      if (
        this.isCurrentRuntimeGeneration(generation) &&
        !this.isTargetWorkspaceCurrent(target.cwd)
      ) {
        this.reportWorkspaceChanged(generation);
      }
      return;
    }
    this.recoveryStore.writeSession(sessionId, transcript);
    await this.recoveryStore.flush();
    if (
      !this.isActivationCandidateCurrent(
        runtime,
        generation,
        target.cwd,
      )
    ) {
      await this.closeRuntime(runtime).catch(() => undefined);
      if (
        this.isCurrentRuntimeGeneration(generation) &&
        !this.isTargetWorkspaceCurrent(target.cwd)
      ) {
        this.reportWorkspaceChanged(generation);
      }
      return;
    }

    this.runtime = runtime;
    this.activeRuntimeCwd = target.cwd;
    this.sessionId = sessionId;
    this.turn = null;
    this.transcript = transcript;
    this.sessions = this.withActiveSession(
      this.sessions,
      target.kind === 'new'
        ? {
            id: sessionId,
            title: 'New session',
            messageCount: 0,
            modifiedTime: new Date().toISOString(),
            active: true,
            isFavorite: false,
          }
        : undefined,
    );
    this.connection = { status: 'connected' };
    this.recoveryStore.selectSession(sessionId);
    void this.recoveryStore.flush();
    this.emitSnapshot();
    if (target.kind === 'new' && target.worktree === true) {
      this.bindWorktreeSessionMetadata(
        runtime,
        generation,
        sessionId,
        target.cwd,
      );
    }
    this.loadSessionMetadata(
      runtime,
      generation,
      sessionId,
      target.cwd,
    );
    if (target.kind === 'resume') {
      this.reconcileDaemonTurn(runtime, generation, sessionId, target.cwd);
      // Replayed rows the ledger still reported live at load time
      // need the same post-turn ledger poll a live turn would have
      // armed — a reload otherwise freezes them at "running".
      this.armReplayedSubagentWatch(sessionId, target.cwd, transcript);
    }
  }

  /**
   * Re-arms the zombie-delegation ledger poll from a replayed
   * transcript (Reload Window / session switch), covering rows whose
   * delegation outlived the turn that dispatched it. The existing
   * watch merge keeps rows from a live turn-end reconcile intact.
   */
  private armReplayedSubagentWatch(
    sessionId: string,
    cwd: string,
    transcript: HostTranscriptState,
  ): void {
    const loadSummaries = this.sessionHistory.loadSubagentSummaries?.bind(
      this.sessionHistory,
    );
    if (loadSummaries === undefined) {
      return;
    }
    this.armZombieSubagentWatch(
      sessionId,
      cwd,
      loadSummaries,
      collectTranscriptSubagentRows(transcript.transcript),
    );
  }

  /**
   * Reload reconciliation for a resumed daemon session (A4 basic
   * tier). A daemon-side turn keeps running while the window reloads;
   * this probes the daemon's working state after activation and, when
   * the turn is still live, projects it as a synthesized recovery
   * turn: the transcript tail shows the existing generating indicator
   * and permissions the SDK replayed during resume surface again. The
   * poll loop closes the turn once the daemon goes idle by reloading
   * the session history (full-result replacement; the basic tier does
   * not re-stream tokens). Process sessions cannot report a working
   * state — the probe throws there — so process-mode recovery is
   * unchanged.
   */
  private reconcileDaemonTurn(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    const turnId = recoveryTurnId(generation);
    if (typeof runtime.readSessionWorkingState !== 'function') {
      this.interactions.endTurn(sessionId, turnId);
      return;
    }
    void (async () => {
      let state: RuntimeSessionWorkingState;
      try {
        state = await runtime.readSessionWorkingState!();
      } catch {
        this.interactions.endTurn(sessionId, turnId);
        return;
      }
      if (
        !this.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        ) ||
        this.turn !== null
      ) {
        return;
      }
      // `unknown` with a replayed interaction still means a live turn
      // (the daemon blocked on it before the state read went stale);
      // `unknown` without one has nothing to project, so stay quiet.
      const live =
        state === 'running' ||
        state === 'waiting-for-user' ||
        (state === 'unknown' && this.interactions.hasPending());
      if (!live) {
        this.interactions.endTurn(sessionId, turnId);
        return;
      }

      const turnGeneration = ++this.turnGeneration;
      this.diagnostics?.beginTurnScope?.(turnId);
      this.turnIo = { counts: new Map(), bytes: 0 };
      this.turn = {
        turnId,
        status: 'streaming',
        activity: createTurnActivityState(),
        recovery: true,
      };
      this.recordHost({
        level: 'info',
        name: 'host.reload.turn-recovered',
        attributes: { sessionId, workingState: state },
      });
      // The re-adopted turn owns the running flag again (it may have
      // been set while the session ran detached).
      setSessionRunning(this, sessionId, true);
      // The webview adopts a turn from its own send or from a
      // snapshot; the recovery turn exists only host-side, so a
      // snapshot (not a bare turn.state) announces it.
      this.emitSnapshot();
      // Interactions replayed during resume were published before the
      // webview knew the recovery turn; publish them again now.
      this.interactions.replayPending();

      await this.pollRecoveredTurn(
        runtime,
        generation,
        turnGeneration,
        sessionId,
        cwd,
        turnId,
      );
    })();
  }

  /**
   * Watches a recovered daemon-side turn until the daemon reports the
   * session idle, then swaps the placeholder for the persisted result.
   * Repeated `unknown` reads fail the turn (fail closed: the daemon
   * lost track of the session, so the result may never arrive).
   */
  private async pollRecoveredTurn(
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    cwd: string,
    turnId: string,
  ): Promise<void> {
    let unknownReads = 0;
    while (true) {
      await delay(RECOVERED_TURN_POLL_MS);
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
      let state: RuntimeSessionWorkingState;
      try {
        state = await runtime.readSessionWorkingState!();
      } catch {
        state = 'unknown';
      }
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
      if (state === 'unknown') {
        unknownReads += 1;
        if (unknownReads >= RECOVERED_TURN_MAX_UNKNOWN_READS) {
          this.failTurn(sessionId, turnId, 'recovered-turn-lost');
          return;
        }
        continue;
      }
      unknownReads = 0;
      if (state === 'idle') {
        await this.finishRecoveredTurn(
          runtime,
          runtimeGeneration,
          turnGeneration,
          sessionId,
          cwd,
          turnId,
        );
        return;
      }
    }
  }

  /**
   * Terminal step of a recovered turn: the daemon went idle, so the
   * completed content now lives in the session file. Reload it and
   * reconcile against the live transcript so the generating
   * placeholder is replaced by the full result in one snapshot.
   */
  private async finishRecoveredTurn(
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    cwd: string,
    turnId: string,
  ): Promise<void> {
    const loaded = await this.loadHistoryTimed(cwd, sessionId);
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
    // Stop pressed while the history loaded still ends as interrupted.
    const interrupted = this.turn?.status === 'stopping';
    this.interactions.endTurn(sessionId, turnId);
    if (loaded?.status === 'available') {
      this.mission = loaded.mission ?? null;
      this.tokenUsage = {
        cumulative: loaded.tokenUsage ?? this.tokenUsage.cumulative,
        lastTurn: this.tokenUsage.lastTurn,
      };
      this.transcript = reconcileSessionHistory(
        loaded.state,
        this.transcript,
      );
    } else {
      this.emitSessionDiagnostic(
        'recovered-turn-history-failed',
        RECOVERED_HISTORY_FAILED_MESSAGE,
      );
    }
    this.setTurnStatus(
      sessionId,
      turnId,
      interrupted ? 'interrupted' : 'completed',
    );
    this.emitSnapshot();
    void this.flushRecoveryCheckpoint();
    this.refreshContextAfterTurn(sessionId);
  }

  /**
   * Binds a freshly created worktree session to its worktree
   * directory (registry + git branch recovery) and annotates the
   * interim catalog row. Fail-soft: a missing binding leaves the row
   * unannotated while the session itself stays live.
   */
  private bindWorktreeSessionMetadata(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    workspaceCwd: string,
  ): void {
    const feature = this.worktreeSessions;
    if (feature === undefined) {
      return;
    }
    void recordCreatedWorktreeSession({
      workspaceCwd,
      sessionId,
      sessionCwd: runtime.getSessionCwd?.() ?? null,
      feature,
    }).then((info) => {
      if (
        info === null ||
        !this.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          workspaceCwd,
        )
      ) {
        return;
      }
      this.sessions = {
        ...this.sessions,
        items: this.sessions.items.map((item) =>
          item.id === sessionId ? { ...item, worktree: info } : item,
        ),
      };
      this.emitSnapshot();
    });
  }

  private loadSessionMetadata(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    void runtime
      .readSessionSettings()
      .then((result) => {
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
        this.settings = {
          status: 'ready',
          value: projectConfirmedSettings(result),
        };
        emitSettings(this, sessionId);
      })
      .catch(() => {
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
        this.settings = {
          status: 'error',
          value: null,
          message: SETTINGS_READ_FAILED_MESSAGE,
        };
        emitSettings(this, sessionId);
      });

    void runtime
      .readModelCatalog()
      .then((result) => {
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
        this.modelCatalog = projectModelCatalog(result);
        emitModelCatalog(this, sessionId);
      })
      .catch(() => {
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
        this.modelCatalog = {
          status: 'error',
          items: [],
          message: MODEL_CATALOG_FAILED_MESSAGE,
        };
        emitModelCatalog(this, sessionId);
      });

    refreshContext(this, runtime, generation, sessionId, cwd);
    // Server-side backstop for the skills/MCP panels: a session switch
    // resets the webview catalogs to 'idle', and a panel-issued
    // re-request can be dropped mid-switch. Pushing fresh state on
    // activation converges an open panel without user action.
    pushSkills(this, runtime, generation, sessionId, cwd);
    pushMcp(this, runtime, generation, sessionId, cwd);
  }

  private async loadCatalog(cwd: string): Promise<SessionCatalogState> {
    let result: SessionCatalogResult;
    try {
      result = await this.sessionCatalog.listSessions(cwd);
    } catch {
      result = {
        status: 'unavailable',
        reason: 'catalog-failed',
        message: CATALOG_ERROR_MESSAGE,
      };
    }
    if (result.status === 'unavailable') {
      return {
        status: 'error',
        items: [],
        message: CATALOG_ERROR_MESSAGE,
      };
    }
    const items = projectCatalogEntries(result.sessions);
    const feature = this.worktreeSessions;
    if (feature?.enabled !== true) {
      return { status: 'ready', items };
    }
    // Worktree sessions list under their worktree cwd, never under the
    // workspace cwd (probe: artifacts/probe-worktree-catalog.mjs), so
    // the registry re-attaches them here.
    return {
      status: 'ready',
      items: await appendWorktreeSessions({
        cwd,
        items,
        store: feature.store,
        listSessions: (worktreeCwd) =>
          this.sessionCatalog.listSessions(worktreeCwd),
        project: projectCatalogEntries,
      }),
    };
  }

  private failTurn(
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
    void this.flushRecoveryCheckpoint();
    this.refreshContextAfterTurn(sessionId);
  }

  private setTurnStatus(
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
      this.withActiveSession(this.sessions),
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

  /**
   * Settles the finished turn's subagent rows with the CLI's durable
   * invocation ledger (`loadSession().subagentInvocations`). The
   * session file is loaded only when the turn actually delegated, and
   * the result applies only while the same turn is still current.
   */
  private settleTurnSubagents(sessionId: string, turnId: string): void {
    const cwd = this.activeRuntimeCwd;
    const loadSummaries = this.sessionHistory.loadSubagentSummaries?.bind(
      this.sessionHistory,
    );
    if (
      cwd === null ||
      loadSummaries === undefined ||
      this.sessionId !== sessionId ||
      this.turn?.turnId !== turnId ||
      !hasSubagentRows(this.turn.activity)
    ) {
      return;
    }
    void loadSummaries({ cwd, sessionId }).then((summaries) => {
      const turn = this.turn;
      if (
        this.disposed ||
        this.sessionId !== sessionId ||
        turn?.turnId !== turnId
      ) {
        return;
      }
      if (summaries !== null) {
        const result = reconcileSubagentSummaries(
          turn.activity,
          summaries,
        );
        turn.activity = result.state;
        for (const projection of result.projections) {
          // The turn already reached its terminal state, so a live
          // webview drops tool.activity (acceptsActiveTurn). Only
          // subagent.update lands after the turn — without it the
          // rows stay "running" on screen until a full reload.
          if (projection.subagent !== undefined) {
            this.emit({
              type: 'subagent.update',
              sessionId,
              turnId,
              toolUseId: projection.toolUseId,
              subagent: projection.subagent,
            });
          }
        }
      }
      // Background delegations the ledger still reports as running
      // outlive the turn; keep reconciling them out of band.
      this.armZombieSubagentWatch(
        sessionId,
        cwd,
        loadSummaries,
        collectRunningSubagentRows(turn.activity, turnId),
      );
    });
  }

  /**
   * Starts (or extends) the post-turn ledger poll for delegations
   * still running after their turn settled. Rows from an earlier
   * turn of the same session stay watched when a newer turn adds
   * its own zombies.
   */
  private armZombieSubagentWatch(
    sessionId: string,
    cwd: string,
    loadSummaries: NonNullable<
      SessionHistoryLoader['loadSubagentSummaries']
    >,
    rows: readonly PendingSubagentRow[],
  ): void {
    const existing = this.zombieSubagentWatch;
    if (existing !== null && existing.sessionId !== sessionId) {
      this.clearZombieSubagentWatch();
    }
    if (rows.length === 0) {
      return;
    }
    const current = this.zombieSubagentWatch;
    if (current !== null) {
      const known = new Set(
        current.rows.map((row) => `${row.turnId}:${row.toolUseId}`),
      );
      current.rows = [
        ...current.rows,
        ...rows.filter(
          (row) => !known.has(`${row.turnId}:${row.toolUseId}`),
        ),
      ];
      return;
    }
    const watch = {
      sessionId,
      rows,
      deadlineAt: Date.now() + ZOMBIE_SUBAGENT_WATCH_MAX_MS,
      ticking: false,
      timer: setInterval(() => {
        void this.tickZombieSubagentWatch(cwd, loadSummaries);
      }, ZOMBIE_SUBAGENT_POLL_MS),
    };
    this.zombieSubagentWatch = watch;
    this.recordHost({
      level: 'info',
      name: 'host.subagent.zombie-watch-armed',
      attributes: { rows: rows.length },
    });
  }

  private clearZombieSubagentWatch(): void {
    const watch = this.zombieSubagentWatch;
    if (watch === null) {
      return;
    }
    this.zombieSubagentWatch = null;
    clearInterval(watch.timer);
  }

  private async tickZombieSubagentWatch(
    cwd: string,
    loadSummaries: NonNullable<
      SessionHistoryLoader['loadSubagentSummaries']
    >,
  ): Promise<void> {
    const watch = this.zombieSubagentWatch;
    if (watch === null || watch.ticking) {
      return;
    }
    if (
      this.disposed ||
      this.sessionId !== watch.sessionId ||
      Date.now() > watch.deadlineAt
    ) {
      this.clearZombieSubagentWatch();
      return;
    }
    watch.ticking = true;
    const summaries = await loadSummaries({
      cwd,
      sessionId: watch.sessionId,
    }).catch(() => null);
    watch.ticking = false;
    if (
      summaries === null ||
      this.zombieSubagentWatch !== watch ||
      this.disposed ||
      this.sessionId !== watch.sessionId
    ) {
      return;
    }
    const { settled, pending } = settleZombieSubagents(
      watch.rows,
      summaries,
    );
    if (settled.length === 0) {
      return;
    }
    for (const { row, subagent } of settled) {
      if (this.turn?.turnId === row.turnId) {
        this.turn.activity = applySubagentSettlement(
          this.turn.activity,
          row.toolUseId,
          subagent,
        );
      }
      this.emit({
        type: 'subagent.update',
        sessionId: watch.sessionId,
        turnId: row.turnId,
        toolUseId: row.toolUseId,
        subagent,
      });
    }
    if (pending.length === 0) {
      this.clearZombieSubagentWatch();
    } else {
      watch.rows = pending;
    }
  }

  private refreshContextAfterTurn(sessionId: string): void {
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
    this.scheduleRecoveryCheckpoint();
  }

  private scheduleRecoveryCheckpoint(): void {
    const sessionId = this.sessionId;
    if (sessionId === null) {
      return;
    }
    this.pendingRecoveryCheckpoint = {
      sessionId,
      cache: this.transcript,
    };
    if (this.recoveryCheckpointTimer !== null) {
      return;
    }
    this.recoveryCheckpointTimer = setTimeout(() => {
      this.recoveryCheckpointTimer = null;
      const checkpoint = this.pendingRecoveryCheckpoint;
      this.pendingRecoveryCheckpoint = null;
      if (checkpoint) {
        this.recoveryStore.writeSession(
          checkpoint.sessionId,
          checkpoint.cache,
        );
      }
    }, SESSION_RECOVERY_DEBOUNCE_MS);
  }

  private checkpointRecoveryTranscript(): void {
    if (this.recoveryCheckpointTimer !== null) {
      clearTimeout(this.recoveryCheckpointTimer);
      this.recoveryCheckpointTimer = null;
    }
    this.pendingRecoveryCheckpoint = null;
    if (this.sessionId !== null) {
      this.recoveryStore.writeSession(
        this.sessionId,
        this.transcript,
      );
    }
  }

  private flushRecoveryCheckpoint(): Promise<void> {
    this.checkpointRecoveryTranscript();
    return this.recoveryStore.flush();
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
    if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
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

  private emitWorkspaceUnavailable(workspace: WorkspaceContext): void {
    this.connection =
      workspace.cwd === null
        ? {
            status: 'unavailable',
            message: 'Open a workspace folder to use DroidVisX.',
          }
        : {
            status: 'unavailable',
            message:
              'Trust this workspace to start the local Droid runtime.',
          };
    this.emitSnapshot();
  }

  private hasCatalogSession(sessionId: string, cwd: string): boolean {
    return (
      this.catalogCwd === cwd &&
      this.sessions.status === 'ready' &&
      this.sessions.items.some(({ id }) => id === sessionId)
    );
  }

  private activeSessionSummary(): SessionSummary | undefined {
    return this.sessionId === null
      ? undefined
      : this.sessions.items.find(({ id }) => id === this.sessionId);
  }

  withActiveSession(
    sessions: SessionCatalogState,
    fallback?: SessionSummary,
  ): SessionCatalogState {
    if (
      this.sessionId === null ||
      this.catalogCwd === null ||
      this.activeRuntimeCwd !== this.catalogCwd
    ) {
      return {
        ...sessions,
        items: sessions.items.map((item) => ({
          ...item,
          active: false,
        })),
      };
    }
    const existing = sessions.items.find(
      ({ id }) => id === this.sessionId,
    );
    const active =
      existing ??
      fallback ??
      this.activeSessionSummary() ?? {
        id: this.sessionId,
        title: 'Current session',
        messageCount: 0,
        modifiedTime: new Date().toISOString(),
        active: true,
        isFavorite: false,
      };
    const items = sessions.items
      .filter(({ id }) => id !== this.sessionId)
      .map((item) => ({ ...item, active: false }));
    if (items.length >= SESSION_CATALOG_LIMIT) {
      items.length = SESSION_CATALOG_LIMIT - 1;
    }
    items.push({ ...active, active: true });
    return { ...sessions, items };
  }

  private markActive(
    items: readonly SessionSummary[],
  ): readonly SessionSummary[] {
    return this.withActiveSession({
      status: this.sessions.status,
      items,
    }).items;
  }

  private touchActiveSession(): void {
    if (this.sessionId === null) {
      return;
    }
    const modifiedTime = new Date().toISOString();
    this.sessions = {
      ...this.sessions,
      items: this.sessions.items.map((item) =>
        item.id === this.sessionId
          ? { ...item, modifiedTime }
          : item,
      ),
    };
  }

  private closeRuntime(
    runtime: DroidRuntime,
    preserveBackendTurn = false,
  ): Promise<void> {
    if (this.closedRuntimes.has(runtime)) {
      return Promise.resolve();
    }
    const existing = this.runtimeClosures.get(runtime);
    if (existing) {
      return existing;
    }
    const closure = Promise.resolve()
      .then(() =>
        runtime.dispose(
          preserveBackendTurn ? { preserveBackendTurn: true } : undefined,
        ),
      )
      .then(() => {
        this.closedRuntimes.add(runtime);
        this.managedRuntimes.delete(runtime);
      })
      .finally(() => {
        if (this.runtimeClosures.get(runtime) === closure) {
          this.runtimeClosures.delete(runtime);
        }
      });
    this.runtimeClosures.set(runtime, closure);
    return closure;
  }

  private queueWorkspaceTransition(
    generation: number,
    staleRuntimes: readonly DroidRuntime[],
  ): void {
    const previous =
      this.workspaceTransition ?? Promise.resolve();
    const transition = previous
      .catch(() => undefined)
      .then(() =>
        this.reconcileWorkspaceContext(
          generation,
          staleRuntimes,
        ),
      )
      .catch(() => {
        if (
          this.disposed ||
          generation !== this.workspaceContextGeneration
        ) {
          return;
        }
        this.connection = {
          status: 'unavailable',
          message: WORKSPACE_CHANGED_MESSAGE,
        };
        this.emitSnapshot();
      });
    this.workspaceTransition = transition;
    void transition.finally(() => {
      if (this.workspaceTransition === transition) {
        this.workspaceTransition = null;
      }
    });
  }

  private async reconcileWorkspaceContext(
    generation: number,
    staleRuntimes: readonly DroidRuntime[],
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.recoveryStore.flush(),
      ...staleRuntimes.map((runtime) => this.closeRuntime(runtime)),
    ]);
    if (
      this.disposed ||
      generation !== this.workspaceContextGeneration
    ) {
      return;
    }
    if (results.slice(1).some((result) => result.status === 'rejected')) {
      this.connection = {
        status: 'unavailable',
        message: SESSION_CLOSE_FAILED_MESSAGE,
      };
      this.emitSessionDiagnostic(
        'session-close-failed',
        SESSION_CLOSE_FAILED_MESSAGE,
      );
      this.emitSnapshot();
      return;
    }

    const workspace = this.getWorkspaceContext();
    if (!isSameWorkspaceContext(this.workspaceContext, workspace)) {
      this.handleWorkspaceContextChanged();
      return;
    }
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (
      this.runtime !== null &&
      this.activeRuntimeCwd === workspace.cwd
    ) {
      return;
    }

    const initialStartup = this.initialization;
    if (initialStartup !== null) {
      await initialStartup;
    }
    if (
      this.disposed ||
      generation !== this.workspaceContextGeneration
    ) {
      return;
    }
    if (
      this.runtime !== null &&
      this.activeRuntimeCwd === workspace.cwd
    ) {
      return;
    }
    if (!this.isTargetWorkspaceCurrent(workspace.cwd)) {
      this.handleWorkspaceContextChanged();
      return;
    }
    await this.startup();
  }

  private async waitForWorkspaceTransition(): Promise<void> {
    while (this.workspaceTransition !== null) {
      await this.workspaceTransition;
    }
  }

  private nextSequence(): number {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('DroidVisX host message sequence was exhausted.');
    }
    this.sequence += 1;
    return this.sequence;
  }

  private isCurrentRuntime(
    runtime: DroidRuntime,
    generation: number,
  ): boolean {
    return (
      this.isCurrentRuntimeGeneration(generation) &&
      this.runtime === runtime
    );
  }

  isCurrentSessionOperation(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): boolean {
    return (
      this.isCurrentRuntime(runtime, generation) &&
      this.sessionId === sessionId &&
      this.activeRuntimeCwd === cwd &&
      this.isTargetWorkspaceCurrent(cwd)
    );
  }

  private resetSessionMetadata(): void {
    this.contextGeneration += 1;
    this.specHandoff = null;
    this.settingsUpdate = null;
    this.settings = { status: 'loading', value: null };
    this.context = { status: 'loading', value: null };
    this.modelCatalog = { status: 'loading', items: [] };
    clearPendingAttachments(this);
    // Runs while sessionId still names the old session, so the
    // discard diagnostic lands on the session that owned the queue.
    discardQueuedPrompts(this);
    // Discard-on-close: any session rebind abandons the hidden fork.
    this.btwSideChat?.reset();
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
    if (cwd === null || !this.isTargetWorkspaceCurrent(cwd)) {
      return;
    }
    void sideChat.handleAsk(cwd, sessionId, text);
  }

  private isCurrentRuntimeGeneration(generation: number): boolean {
    return !this.disposed && this.runtimeGeneration === generation;
  }

  private beginCatalogLoad(cwd: string): number {
    const generation = ++this.catalogGeneration;
    this.catalogCwd = cwd;
    this.sessions = { status: 'loading', items: [] };
    this.refreshWorktreeAvailability(cwd);
    return generation;
  }

  private bindCatalogViewToWorkspace(cwd: string): void {
    if (this.catalogCwd === cwd) {
      return;
    }
    this.catalogGeneration += 1;
    this.catalogCwd = cwd;
    this.sessions = { status: 'idle', items: [] };
    this.refreshWorktreeAvailability(cwd);
  }

  private clearCatalog(): void {
    this.catalogGeneration += 1;
    this.catalogCwd = null;
    this.sessions = { status: 'idle', items: [] };
    this.worktreeAvailabilityCwd = null;
    this.worktreeCreateAvailable = false;
    // No catalog, no rows to indicate; the poll loop ends itself.
    this.runningSessionIds.clear();
  }

  /**
   * Recomputes the worktree-create capability for a workspace binding.
   * One git check per cwd: the async result only lands while the
   * binding is unchanged, and a later snapshot broadcasts it.
   */
  private refreshWorktreeAvailability(cwd: string): void {
    const feature = this.worktreeSessions;
    if (
      feature?.enabled !== true ||
      this.worktreeAvailabilityCwd === cwd
    ) {
      return;
    }
    this.worktreeAvailabilityCwd = cwd;
    this.worktreeCreateAvailable = false;
    void feature.isGitWorkspace(cwd).then((isGit) => {
      if (
        this.disposed ||
        this.worktreeAvailabilityCwd !== cwd ||
        !isGit
      ) {
        return;
      }
      this.worktreeCreateAvailable = true;
      this.emitSnapshot();
    });
  }

  private isCurrentCatalogRequest(
    generation: number,
    cwd: string,
  ): boolean {
    return (
      !this.disposed &&
      this.catalogGeneration === generation &&
      this.catalogCwd === cwd &&
      this.isTargetWorkspaceCurrent(cwd)
    );
  }

  private discardCatalogRequest(generation: number): void {
    if (
      this.disposed ||
      this.catalogGeneration !== generation
    ) {
      return;
    }
    const workspace = this.getWorkspaceContext();
    this.catalogGeneration += 1;
    this.catalogCwd = isUsableWorkspace(workspace)
      ? workspace.cwd
      : null;
    this.sessions = { status: 'idle', items: [] };
    if (isUsableWorkspace(workspace)) {
      this.emitSnapshot();
    } else {
      this.emitWorkspaceUnavailable(workspace);
    }
  }

  private isTargetWorkspaceCurrent(cwd: string): boolean {
    const workspace = this.getWorkspaceContext();
    return isUsableWorkspace(workspace) && workspace.cwd === cwd;
  }

  private isActivationCandidateCurrent(
    runtime: DroidRuntime,
    generation: number,
    cwd: string,
  ): boolean {
    return (
      this.isCurrentRuntimeGeneration(generation) &&
      this.managedRuntimes.has(runtime) &&
      this.isTargetWorkspaceCurrent(cwd)
    );
  }

  ensureActiveRuntimeWorkspaceCurrent(): boolean {
    if (
      this.runtime === null ||
      (this.activeRuntimeCwd !== null &&
        this.isTargetWorkspaceCurrent(this.activeRuntimeCwd))
    ) {
      return true;
    }
    this.handleWorkspaceContextChanged();
    return false;
  }

  private reportWorkspaceChanged(generation: number): void {
    if (!this.isCurrentRuntimeGeneration(generation)) {
      return;
    }
    this.connection = {
      status: 'unavailable',
      message: WORKSPACE_CHANGED_MESSAGE,
    };
    this.emitSessionDiagnostic(
      'workspace-changed',
      WORKSPACE_CHANGED_MESSAGE,
    );
    this.emitSnapshot();
  }

  private isCurrentTurn(
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    turnId: string,
  ): boolean {
    if (
      this.isCurrentRuntime(runtime, runtimeGeneration) &&
      this.turnGeneration === turnGeneration &&
      this.sessionId === sessionId &&
      this.turn?.turnId === turnId &&
      isTurnActive(this.turn)
    ) {
      return this.ensureActiveRuntimeWorkspaceCurrent();
    }
    return false;
  }
}

/**
 * Turn id synthesized for a daemon turn recovered after a reload. The
 * runtime generation is unique per activation, so recovery turns never
 * collide with each other or with webview-generated turn ids.
 */
function recoveryTurnId(generation: number): string {
  return `recovery-${generation}`;
}

function unavailableMessage(
  reason: Extract<
    RuntimeAvailability,
    { status: 'unavailable' }
  >['reason'],
): string {
  switch (reason) {
    case 'cli-not-found':
      return 'Install the Droid CLI and sign in before using DroidVisX.';
    case 'invalid-cwd':
      return 'Droid could not use the selected workspace folder.';
    case 'initialization-failed':
      return 'The local Droid runtime could not be initialized.';
  }
}

function isUsableWorkspace(
  workspace: WorkspaceContext,
): workspace is { readonly cwd: string; readonly trusted: true } {
  return workspace.cwd !== null && workspace.trusted;
}

function isSameWorkspaceContext(
  left: WorkspaceContext,
  right: WorkspaceContext,
): boolean {
  return left.cwd === right.cwd && left.trusted === right.trusted;
}

function projectCatalogEntries(
  entries: readonly SessionCatalogEntry[],
): SessionSummary[] {
  const items: SessionSummary[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      items.length >= SESSION_CATALOG_LIMIT ||
      !isSafeBridgeId(entry.id) ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.messageCount) ||
      entry.messageCount < 0
    ) {
      continue;
    }
    const modified = new Date(entry.modifiedTime);
    if (!Number.isFinite(modified.getTime())) {
      continue;
    }
    ids.add(entry.id);
    items.push({
      id: entry.id,
      title: sanitizeSessionTitle(entry.title),
      messageCount: entry.messageCount,
      modifiedTime: modified.toISOString(),
      active: false,
      isFavorite: entry.isFavorite === true,
      ...(entry.missionRole === undefined
        ? {}
        : { missionRole: entry.missionRole }),
    });
  }
  return items;
}

function sanitizeSessionTitle(title: string): string {
  if (typeof title !== 'string') {
    return 'Untitled session';
  }
  const safe = title
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SESSION_TITLE_LIMIT)
    .trim();
  return safe || 'Untitled session';
}

