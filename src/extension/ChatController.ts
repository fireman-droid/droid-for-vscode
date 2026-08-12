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

/**
 * Byte budget for retained sent-attachment payloads (memory only):
 * 8 attachments x 4 MB fits exactly one maximal message, covering
 * the common "edit the latest message" case.
 */
export const MAX_SENT_ATTACHMENT_RETENTION_BYTES = 32 * 1024 * 1024;

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
/**
 * Cadence of the daemon opened-session registry poll that watches
 * detached background turns. One cheap in-memory RPC per tick; the
 * loop only runs while a background flag is set.
 */
const BACKGROUND_RUNNING_POLL_MS = 1_000;
/**
 * Consecutive failed daemon reads before the background flags fail
 * closed. Better no indicator than a spinner nobody can verify.
 */
const BACKGROUND_RUNNING_MAX_FAILURES = 3;
/**
 * Daemon opened-session working states that mean a turn is in
 * flight. Closed set (SDK `DroidWorkingState` minus Idle);
 * unrecognized future states fail closed to "not running" so the
 * indicator never spins on guesswork.
 */
const LIVE_DAEMON_WORKING_STATES = new Set([
  'thinking',
  'streaming_assistant_message',
  'waiting_for_tool_confirmation',
  'executing_tool',
  'compacting_conversation',
]);
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
const SETTINGS_READ_FAILED_MESSAGE =
  'Droid session settings could not be loaded.';
const SETTINGS_UPDATE_FAILED_MESSAGE =
  'Droid session settings could not be updated.';
const SETTINGS_UPDATE_BLOCKED_MESSAGE =
  'Finish the current interaction or setting update before changing settings.';
const SETTINGS_UPDATE_UNSUPPORTED_MESSAGE =
  'This setting is not available for the current Droid session.';
const EDIT_RESEND_BLOCKED_MESSAGE =
  'Finish the current Droid activity before editing an earlier message.';
const EDIT_RESEND_QUEUE_BLOCKED_MESSAGE =
  'Clear the queued messages before editing an earlier message.';
const EDIT_RESEND_UNSUPPORTED_MESSAGE =
  'This message cannot be edited and resent.';
const EDIT_RESEND_FAILED_MESSAGE =
  'Droid could not rewind the session to that message.';
const MAX_FORK_TITLE_LENGTH = 60;
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
const FILE_DIFF_FAILED_MESSAGE =
  'That file could not be opened. It may have been moved or deleted.';
const FILE_NOT_READY_MESSAGE =
  'That file does not exist yet. Droid is still working on it.';
const PREVIEW_FAILED_MESSAGE =
  'That prototype could not be previewed. It may have been moved, deleted, or is too large.';
const OPEN_PATH_FAILED_MESSAGE =
  'That path could not be opened. It may have been moved or deleted.';
const ATTACHMENT_LIMIT_MESSAGE =
  `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`;
const ATTACHMENT_TOO_LARGE_MESSAGE =
  'That file is too large to attach.';
const ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE =
  'That file type cannot be attached.';
const ATTACHMENT_READ_FAILED_MESSAGE =
  'The selected content could not be read for attachment.';
const ATTACHMENT_OUTSIDE_WORKSPACE_MESSAGE =
  'Dropped files must be inside the current workspace.';
const ATTACHMENT_NO_EDITOR_MESSAGE =
  'Open a text editor first to attach its contents.';
const ATTACHMENT_NO_PROBLEMS_MESSAGE =
  'There are no problems to attach.';
const ATTACHMENT_NO_GIT_CHANGES_MESSAGE =
  'There are no uncommitted git changes to attach.';
const ATTACHMENT_NO_SELECTION_MESSAGE =
  'Select text in an editor first to attach the selection.';

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
        this.handleEditResend(
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
        this.handleRewindInfo(message.sessionId, message.messageId);
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
        this.handleFileOpenDiff(message.sessionId, message.path);
        return;
      case 'file.preview':
        this.handleFilePreview(message.sessionId, message.path);
        return;
      case 'preview.inlineHtml':
        this.handleInlineHtmlPreview(message.sessionId, message.html);
        return;
      case 'workspace.openPath':
        this.handleWorkspaceOpenPath(
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
        this.handleAttachmentPick(message.sessionId, message.stage);
        return;
      case 'attachment.addEditor':
        this.handleAttachmentCapture(
          message.sessionId,
          'editor',
          message.stage,
        );
        return;
      case 'attachment.addSelection':
        this.handleAttachmentCapture(
          message.sessionId,
          'selection',
          message.stage,
        );
        return;
      case 'attachment.addProblems':
        this.handleAttachmentCapture(
          message.sessionId,
          'problems',
          message.stage,
        );
        return;
      case 'attachment.addGitChanges':
        this.handleAttachmentCapture(
          message.sessionId,
          'git-changes',
          message.stage,
        );
        return;
      case 'attachment.addPath':
        this.handleAttachmentAddPath(
          message.sessionId,
          message.path,
          message.stage,
        );
        return;
      case 'attachment.addImage':
        this.handleAttachmentAddImage(
          message.sessionId,
          message.name,
          message.mediaType,
          message.dataBase64,
          message.stage,
        );
        return;
      case 'attachment.addUris':
        this.handleAttachmentAddUris(
          message.sessionId,
          message.uris,
          message.stage,
        );
        return;
      case 'attachment.addTextFile':
        this.handleAttachmentAddTextFile(
          message.sessionId,
          message.name,
          message.text,
          message.truncated,
          message.stage,
        );
        return;
      case 'editStage.begin':
        this.handleEditStageBegin(
          message.sessionId,
          message.messageId,
        );
        return;
      case 'editStage.cancel':
        this.handleEditStageCancel(message.sessionId);
        return;
      case 'workspace.searchFiles':
        this.handleWorkspaceSearchFiles(
          message.sessionId,
          message.requestId,
          message.query,
        );
        return;
      case 'workspace.readImage':
        this.handleWorkspaceReadImage(message.sessionId, message.path);
        return;
      case 'attachment.remove':
        this.handleAttachmentRemove(
          message.sessionId,
          message.attachmentId,
          message.stage,
        );
        return;
      case 'session.setting.update':
        this.handleSettingUpdate(message);
        return;
      case 'git.requestStatus':
        this.handleGitRequestStatus(message.sessionId);
        return;
      case 'git.commit':
        this.handleGitCommit(
          message.sessionId,
          message.paths,
          message.message,
        );
        return;
      case 'terminal.openMirror':
        this.handleTerminalOpenMirror(message.sessionId);
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
      this.seedBackgroundRunning(workspace.cwd);

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
      attachmentsOverride ?? this.takePendingAttachments();
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
    this.echoUserImageAttachments(sessionId, turnId, attachments);
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

  /**
   * Projects the image attachments of an accepted prompt as user-origin
   * image transcript items right after the prompt text. The stream does
   * not echo user images back, so this is their only live projection.
   */
  private echoUserImageAttachments(
    sessionId: string,
    turnId: string,
    attachments: readonly RuntimeAttachment[] | undefined,
  ): void {
    if (attachments === undefined) {
      return;
    }
    let index = 0;
    for (const attachment of attachments) {
      if (attachment.kind !== 'image') {
        continue;
      }
      const oversized = attachment.data.length > MAX_IMAGE_DATA_LENGTH;
      const item: ImageTranscriptItem = {
        id: stableTranscriptId(
          'image',
          turnId,
          'user-echo',
          String(index),
        ),
        kind: 'image',
        turnId,
        origin: 'user',
        mediaType: attachment.mediaType,
        data: oversized ? '' : attachment.data,
        generated: false,
        byteLength: base64ByteLength(attachment.data),
      };
      this.emit({
        type: 'transcript.image',
        sessionId,
        turnId,
        item,
      });
      index += 1;
    }
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
        this.retainSentAttachments(turnId, event.messageId);
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
        this.refreshSettingsAfterRuntimeEvent(sessionId);
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

  private handleRewindInfo(sessionId: string, messageId: string): void {
    const runtime = this.runtime;
    if (
      runtime === null ||
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId ||
      typeof runtime.getRewindInfo !== 'function'
    ) {
      return;
    }
    void runtime.getRewindInfo(messageId).then(
      (info) => {
        if (sessionId === this.sessionId) {
          this.emit({
            type: 'rewind.info',
            sessionId,
            messageId,
            restorableCount: info.restorableCount,
            createdCount: info.createdCount,
          });
        }
      },
      () => {
        // File info is advisory; the editor simply omits the option.
      },
    );
  }

  private handleEditResend(
    sessionId: string,
    turnId: string,
    messageId: string,
    text: string,
    restoreFiles: boolean,
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
      this.turn?.turnId === turnId
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
        'edit-resend-blocked',
        EDIT_RESEND_BLOCKED_MESSAGE,
      );
      this.emitEditResendRejected(sessionId, messageId, 'busy');
      return;
    }
    // Edit-resend forks the session, which would silently discard the
    // queue (design §4.6): make the user resolve the queue first.
    if (this.queuedPrompts.items.length > 0) {
      this.emitSessionDiagnostic(
        'edit-resend-blocked',
        EDIT_RESEND_QUEUE_BLOCKED_MESSAGE,
      );
      this.emitEditResendRejected(sessionId, messageId, 'busy');
      return;
    }
    if (typeof runtime.rewind !== 'function') {
      this.emitSessionDiagnostic(
        'edit-resend-unsupported',
        EDIT_RESEND_UNSUPPORTED_MESSAGE,
      );
      this.emitEditResendRejected(sessionId, messageId, 'unsupported');
      return;
    }
    const truncated = truncateFromUserMessage(
      this.transcript,
      messageId,
    );
    if (truncated === null) {
      this.emitSessionDiagnostic(
        'edit-resend-unsupported',
        EDIT_RESEND_UNSUPPORTED_MESSAGE,
      );
      this.emitEditResendRejected(sessionId, messageId, 'unsupported');
      return;
    }

    // Resendable payloads staged for this message: kept originals plus
    // anything added in edit mode. Non-restorable chips resend nothing.
    const editAttachments: readonly PendingAttachment[] =
      this.editStage?.messageId === messageId
        ? this.editStage.attachments.flatMap(({ summary, runtime: payload }) =>
            payload === null
              ? []
              : [
                  {
                    summary: {
                      id: summary.id,
                      kind: summary.kind,
                      name: summary.name,
                      sizeBytes: summary.sizeBytes,
                      truncated: summary.truncated,
                    },
                    runtime: payload,
                  },
                ],
          )
        : [];

    this.sessionOperationInProgress = true;
    void this.performEditResend(
      runtime,
      sessionId,
      messageId,
      text,
      truncated,
      restoreFiles,
    ).then((forkedSessionId) => {
      this.sessionOperationInProgress = false;
      if (forkedSessionId === null) {
        return;
      }
      // Send first, then snapshot: the single snapshot then carries the
      // forked session id, the truncated transcript with the edited
      // prompt, and the submitting turn, so the webview adopts the fork
      // atomically.
      this.handleSend(
        forkedSessionId,
        turnId,
        text,
        'edit-resend',
        editAttachments,
      );
      this.emitSnapshot();
    });
  }

  private emitEditResendRejected(
    sessionId: string,
    messageId: string,
    reason: EditResendRejectReason,
  ): void {
    this.emit({
      type: 'turn.editResendRejected',
      sessionId,
      messageId,
      reason,
    });
  }

  /**
   * Rewinds the runtime to `messageId` and adopts the forked session.
   * Returns the forked session id when the controller should resend the
   * edited prompt, or null when the operation failed or became stale.
   */
  private async performEditResend(
    runtime: DroidRuntime,
    sessionId: string,
    messageId: string,
    text: string,
    truncated: HostTranscriptState,
    restoreFiles: boolean,
  ): Promise<string | null> {
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd;
    if (cwd === null) {
      return null;
    }

    let forkedSessionId: string;
    try {
      const result = await runtime.rewind!({
        messageId,
        forkTitle: forkTitleFromText(text),
        restoreFiles,
      });
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
          'edit-resend-failed',
          EDIT_RESEND_FAILED_MESSAGE,
        );
        this.emitEditResendRejected(sessionId, messageId, 'failed');
      }
      return null;
    }
    if (
      !this.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    ) {
      return null;
    }
    if (!isSafeBridgeId(forkedSessionId)) {
      this.emitSessionDiagnostic(
        'edit-resend-failed',
        EDIT_RESEND_FAILED_MESSAGE,
      );
      this.emitEditResendRejected(sessionId, messageId, 'failed');
      return null;
    }

    this.sessionId = forkedSessionId;
    this.transcript = truncated;
    this.turn = null;
    this.clearPendingAttachments();
    this.sessions = this.withActiveSession(this.sessions, {
      id: forkedSessionId,
      title: forkTitleFromText(text),
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    });
    this.recoveryStore.writeSession(forkedSessionId, truncated);
    this.recoveryStore.selectSession(forkedSessionId);
    void this.recoveryStore.flush();
    return forkedSessionId;
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
    this.clearPendingAttachments();
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

  private handleFileOpenDiff(sessionId: string, path: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    void this.fileDiff.openDiff(path).then((outcome) => {
      if (outcome === 'not-found') {
        // Missing during an active turn means Droid has not written
        // the file yet; missing on a settled transcript means it was
        // moved or deleted after the fact.
        const turnActive =
          this.turn !== null &&
          this.turn.status !== 'completed' &&
          this.turn.status !== 'interrupted' &&
          this.turn.status !== 'failed';
        if (turnActive) {
          this.emitSessionDiagnostic(
            'file-not-ready',
            FILE_NOT_READY_MESSAGE,
          );
          return;
        }
        this.emitSessionDiagnostic(
          'file-diff-failed',
          FILE_DIFF_FAILED_MESSAGE,
        );
        return;
      }
      if (outcome === 'failed') {
        this.emitSessionDiagnostic(
          'file-diff-failed',
          FILE_DIFF_FAILED_MESSAGE,
        );
      }
    });
  }

  private handleFilePreview(sessionId: string, path: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    void this.prototypePreview.openPreview(path).then((outcome) => {
      if (outcome === 'failed') {
        this.emitSessionDiagnostic(
          'preview-failed',
          PREVIEW_FAILED_MESSAGE,
        );
      }
    });
  }

  /** Renders a bridge-validated transcript HTML code block in the
   * sandboxed preview panel (same surface as file previews). */
  private handleInlineHtmlPreview(sessionId: string, html: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    void this.prototypePreview.openInlineHtml(html).then((outcome) => {
      if (outcome === 'failed') {
        this.emitSessionDiagnostic(
          'preview-failed',
          PREVIEW_FAILED_MESSAGE,
        );
      }
    });
  }

  private handleTerminalOpenMirror(sessionId: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    this.terminalMirror?.open();
  }

  /**
   * Paths of the newest changes card, which drive the commit panel's
   * default selection (`inTurn`); normalized to forward slashes to
   * match `GitStatusFile` paths.
   */
  private latestTurnChangePaths(): ReadonlySet<string> {
    const items = this.transcript.transcript;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item !== undefined && item.kind === 'changes') {
        return new Set(
          item.files.map((file) => file.path.replaceAll('\\', '/')),
        );
      }
    }
    return new Set();
  }

  private handleGitRequestStatus(sessionId: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    const root = this.activeRuntimeCwd;
    if (root === null) {
      this.emit({
        type: 'git.status',
        sessionId,
        branch: null,
        files: [],
        unavailableReason: 'unsupported-workspace',
      });
      return;
    }
    const inTurn = this.latestTurnChangePaths();
    void this.gitWorkflow.status(root, inTurn).then((status) => {
      if (this.disposed || this.sessionId !== sessionId) {
        return;
      }
      this.emit(
        status.available
          ? {
              type: 'git.status',
              sessionId,
              branch: status.branch,
              files: status.files,
            }
          : {
              type: 'git.status',
              sessionId,
              branch: null,
              files: [],
              unavailableReason: status.reason,
            },
      );
    });
  }

  private handleGitCommit(
    sessionId: string,
    paths: readonly string[],
    message: string,
  ): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    const root = this.activeRuntimeCwd;
    if (root === null) {
      this.emit({
        type: 'git.commitResult',
        sessionId,
        ok: false,
        error: 'Git is unavailable (unsupported-workspace).',
      });
      return;
    }
    void this.gitWorkflow
      .commit(root, paths, message)
      .then((outcome) => {
        if (this.disposed || this.sessionId !== sessionId) {
          return;
        }
        this.emit(
          outcome.ok
            ? {
                type: 'git.commitResult',
                sessionId,
                ok: true,
                hash: outcome.hash,
                subject: commitSubject(message),
              }
            : {
                type: 'git.commitResult',
                sessionId,
                ok: false,
                error: outcome.error,
              },
        );
      });
  }

  private handleWorkspaceOpenPath(
    sessionId: string,
    path: string,
    line?: number,
    column?: number,
  ): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    void this.pathOpener.openPath(path, line, column).then((outcome) => {
      if (outcome === 'failed') {
        this.emitSessionDiagnostic(
          'open-path-failed',
          OPEN_PATH_FAILED_MESSAGE,
        );
      }
    });
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
    this.clearPendingAttachments();
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
    this.seedBackgroundRunning(cwd);
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
        this.seedBackgroundRunning(workspace.cwd);
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
      this.seedBackgroundRunning(cwd);
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

  private canStageAttachments(
    sessionId: string,
    stage?: AttachmentStage,
  ): boolean {
    return (
      sessionId === this.sessionId &&
      this.runtime !== null &&
      this.connection.status === 'connected' &&
      !this.attachmentOperationInProgress &&
      (stage !== 'edit' || this.editStage !== null) &&
      this.ensureActiveRuntimeWorkspaceCurrent()
    );
  }

  /** How many attachments the targeted staging area already holds. */
  private stagedCount(stage?: AttachmentStage): number {
    return stage === 'edit'
      ? (this.editStage?.attachments.length ?? 0)
      : this.pendingAttachments.length;
  }

  private handleAttachmentPick(
    sessionId: string,
    stage?: AttachmentStage,
  ): void {
    if (!this.canStageAttachments(sessionId, stage)) {
      return;
    }
    const remaining =
      MAX_PENDING_ATTACHMENTS - this.stagedCount(stage);
    if (remaining <= 0) {
      this.emitSessionDiagnostic(
        'attachment-limit',
        ATTACHMENT_LIMIT_MESSAGE,
      );
      return;
    }
    this.attachmentOperationInProgress = true;
    void this.attachmentSources.pickFiles(remaining).then(
      (outcome) => {
        this.attachmentOperationInProgress = false;
        if (sessionId !== this.sessionId) {
          return;
        }
        switch (outcome.status) {
          case 'picked':
            this.stageAttachmentPayloads(outcome.items, undefined, stage);
            return;
          case 'cancelled':
            return;
          case 'rejected':
            this.emitSessionDiagnostic(
              'attachment-rejected',
              outcome.reason === 'too-large'
                ? ATTACHMENT_TOO_LARGE_MESSAGE
                : ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
            );
            return;
          case 'failed':
            this.emitSessionDiagnostic(
              'attachment-read-failed',
              ATTACHMENT_READ_FAILED_MESSAGE,
            );
            return;
        }
      },
      () => {
        this.attachmentOperationInProgress = false;
        if (sessionId === this.sessionId) {
          this.emitSessionDiagnostic(
            'attachment-read-failed',
            ATTACHMENT_READ_FAILED_MESSAGE,
          );
        }
      },
    );
  }

  private handleAttachmentCapture(
    sessionId: string,
    capture: 'editor' | 'selection' | 'problems' | 'git-changes',
    stage?: AttachmentStage,
  ): void {
    if (!this.canStageAttachments(sessionId, stage)) {
      return;
    }
    if (this.stagedCount(stage) >= MAX_PENDING_ATTACHMENTS) {
      this.emitSessionDiagnostic(
        'attachment-limit',
        ATTACHMENT_LIMIT_MESSAGE,
      );
      return;
    }
    this.attachmentOperationInProgress = true;
    const read =
      capture === 'editor'
        ? this.attachmentSources.readActiveEditor()
        : capture === 'selection'
          ? this.attachmentSources.readActiveSelection()
          : capture === 'problems'
            ? this.attachmentSources.readProblems()
            : this.attachmentSources.readGitChanges();
    void read.then(
      (outcome) => {
        this.attachmentOperationInProgress = false;
        if (sessionId !== this.sessionId) {
          return;
        }
        switch (outcome.status) {
          case 'captured':
            this.stageAttachmentPayloads(
              [outcome.item],
              capture === 'editor' || capture === 'selection'
                ? capture
                : undefined,
              stage,
            );
            return;
          case 'empty':
            this.emitSessionDiagnostic(
              'attachment-empty',
              capture === 'editor'
                ? ATTACHMENT_NO_EDITOR_MESSAGE
                : capture === 'selection'
                  ? ATTACHMENT_NO_SELECTION_MESSAGE
                  : capture === 'problems'
                    ? ATTACHMENT_NO_PROBLEMS_MESSAGE
                    : ATTACHMENT_NO_GIT_CHANGES_MESSAGE,
            );
            return;
          case 'failed':
            this.emitSessionDiagnostic(
              'attachment-read-failed',
              ATTACHMENT_READ_FAILED_MESSAGE,
            );
            return;
        }
      },
      () => {
        this.attachmentOperationInProgress = false;
        if (sessionId === this.sessionId) {
          this.emitSessionDiagnostic(
            'attachment-read-failed',
            ATTACHMENT_READ_FAILED_MESSAGE,
          );
        }
      },
    );
  }

  private handleAttachmentAddPath(
    sessionId: string,
    path: string,
    stage?: AttachmentStage,
  ): void {
    if (!this.canStageAttachments(sessionId, stage)) {
      return;
    }
    if (this.stagedCount(stage) >= MAX_PENDING_ATTACHMENTS) {
      this.emitSessionDiagnostic(
        'attachment-limit',
        ATTACHMENT_LIMIT_MESSAGE,
      );
      return;
    }
    this.attachmentOperationInProgress = true;
    void this.attachmentSources.readWorkspaceFile(path).then(
      (outcome) => {
        this.attachmentOperationInProgress = false;
        if (sessionId !== this.sessionId) {
          return;
        }
        switch (outcome.status) {
          case 'picked':
            this.stageAttachmentPayloads(outcome.items, undefined, stage);
            return;
          case 'cancelled':
            return;
          case 'rejected':
            this.emitSessionDiagnostic(
              'attachment-rejected',
              outcome.reason === 'too-large'
                ? ATTACHMENT_TOO_LARGE_MESSAGE
                : ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
            );
            return;
          case 'failed':
            this.emitSessionDiagnostic(
              'attachment-read-failed',
              ATTACHMENT_READ_FAILED_MESSAGE,
            );
            return;
        }
      },
      () => {
        this.attachmentOperationInProgress = false;
        if (sessionId === this.sessionId) {
          this.emitSessionDiagnostic(
            'attachment-read-failed',
            ATTACHMENT_READ_FAILED_MESSAGE,
          );
        }
      },
    );
  }

  /**
   * Stages one image dropped or pasted into the composer. The base64
   * payload already passed the bridge validator (media type
   * whitelist, base64 shape, 4 MB cap); the decoded-size check here
   * keeps this path bound by the same rule as the file picker.
   */
  private handleAttachmentAddImage(
    sessionId: string,
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
    stage?: AttachmentStage,
  ): void {
    if (!this.canStageAttachments(sessionId, stage)) {
      return;
    }
    if (this.stagedCount(stage) >= MAX_PENDING_ATTACHMENTS) {
      this.emitSessionDiagnostic(
        'attachment-limit',
        ATTACHMENT_LIMIT_MESSAGE,
      );
      return;
    }
    const sizeBytes = base64ByteLength(dataBase64);
    if (sizeBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
      this.emitSessionDiagnostic(
        'attachment-rejected',
        ATTACHMENT_TOO_LARGE_MESSAGE,
      );
      return;
    }
    this.stageAttachmentPayloads(
      [
        {
          kind: 'image',
          name,
          data: dataBase64,
          mediaType,
          sizeBytes,
          truncated: false,
        },
      ],
      undefined,
      stage,
    );
  }

  /**
   * Stages files dropped onto the composer as `file://` URIs (editor
   * explorer drags). URIs resolving outside the active workspace are
   * reported once as a diagnostic; the rest go through the same
   * workspace file reader as `attachment.addPath`.
   */
  private handleAttachmentAddUris(
    sessionId: string,
    uris: readonly string[],
    stage?: AttachmentStage,
  ): void {
    if (!this.canStageAttachments(sessionId, stage)) {
      return;
    }
    const cwd = this.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }
    const relativePaths: string[] = [];
    let outsideWorkspace = false;
    for (const uri of uris) {
      let absolute: string;
      try {
        absolute = fileURLToPath(uri);
      } catch {
        outsideWorkspace = true;
        continue;
      }
      const relativePath = relative(cwd, absolute).replaceAll(
        '\\',
        '/',
      );
      if (
        relativePath.length === 0 ||
        relativePath.startsWith('..') ||
        isAbsolute(relativePath) ||
        !isSafeWorkspaceRelativePath(relativePath)
      ) {
        outsideWorkspace = true;
        continue;
      }
      relativePaths.push(relativePath);
    }
    if (outsideWorkspace) {
      this.emitSessionDiagnostic(
        'attachment-outside-workspace',
        ATTACHMENT_OUTSIDE_WORKSPACE_MESSAGE,
      );
    }
    if (relativePaths.length === 0) {
      return;
    }
    const remaining =
      MAX_PENDING_ATTACHMENTS - this.stagedCount(stage);
    if (remaining <= 0) {
      this.emitSessionDiagnostic(
        'attachment-limit',
        ATTACHMENT_LIMIT_MESSAGE,
      );
      return;
    }
    this.attachmentOperationInProgress = true;
    void (async () => {
      const payloads: AttachmentPayload[] = [];
      let rejectedReason: 'too-large' | 'unsupported-type' | null =
        null;
      let failed = false;
      for (const relativePath of relativePaths.slice(0, remaining)) {
        let outcome: AttachmentPickOutcome;
        try {
          outcome =
            await this.attachmentSources.readWorkspaceFile(
              relativePath,
            );
        } catch {
          failed = true;
          continue;
        }
        switch (outcome.status) {
          case 'picked':
            payloads.push(...outcome.items);
            break;
          case 'rejected':
            rejectedReason = outcome.reason;
            break;
          case 'failed':
            failed = true;
            break;
          case 'cancelled':
            break;
        }
      }
      this.attachmentOperationInProgress = false;
      if (sessionId !== this.sessionId) {
        return;
      }
      if (payloads.length > 0) {
        this.stageAttachmentPayloads(payloads, undefined, stage);
      }
      if (rejectedReason !== null) {
        this.emitSessionDiagnostic(
          'attachment-rejected',
          rejectedReason === 'too-large'
            ? ATTACHMENT_TOO_LARGE_MESSAGE
            : ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
        );
      }
      if (failed) {
        this.emitSessionDiagnostic(
          'attachment-read-failed',
          ATTACHMENT_READ_FAILED_MESSAGE,
        );
      }
    })();
  }

  /**
   * Stages one non-image file dropped onto the composer whose text
   * content the webview already read and bounded. The bridge validator
   * enforced the character cap and rejected binary content.
   */
  private handleAttachmentAddTextFile(
    sessionId: string,
    name: string,
    text: string,
    truncated: boolean,
    stage?: AttachmentStage,
  ): void {
    if (!this.canStageAttachments(sessionId, stage)) {
      return;
    }
    if (this.stagedCount(stage) >= MAX_PENDING_ATTACHMENTS) {
      this.emitSessionDiagnostic(
        'attachment-limit',
        ATTACHMENT_LIMIT_MESSAGE,
      );
      return;
    }
    this.stageAttachmentPayloads(
      [
        {
          kind: 'text',
          name,
          data: text,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
          truncated,
        },
      ],
      undefined,
      stage,
    );
  }

  private handleWorkspaceSearchFiles(
    sessionId: string,
    requestId: string,
    query: string,
  ): void {
    if (
      sessionId !== this.sessionId ||
      this.connection.status !== 'connected'
    ) {
      // Always answer with the original request id: a silently dropped
      // request left the mention popup on "Searching files..." forever.
      const status =
        this.getWorkspaceContext().cwd === null ? 'no-workspace' : 'ok';
      this.emitWorkspaceFiles(sessionId, requestId, [], status);
      this.recordWorkspaceSearch(query, {
        outcome: 'dropped',
        reason:
          sessionId !== this.sessionId
            ? 'session-mismatch'
            : 'not-connected',
        status,
      });
      return;
    }
    if (query.trim().length === 0) {
      // A bare `@` lists the open editor tabs instead of nothing.
      const openFiles = (
        this.attachmentSources.listOpenEditorFiles?.(
          MAX_FILE_SEARCH_RESULTS,
        ) ?? []
      ).filter((file) => isSafeWorkspaceRelativePath(file));
      this.emitWorkspaceFiles(sessionId, requestId, openFiles, 'ok');
      return;
    }
    const startedAt = performance.now();
    void this.attachmentSources
      .searchWorkspaceFiles(query.trim(), MAX_FILE_SEARCH_RESULTS)
      .then(
        (files) => {
          const safeFiles = files
            .filter((file) => isSafeWorkspaceRelativePath(file))
            .slice(0, MAX_FILE_SEARCH_RESULTS);
          const status =
            safeFiles.length === 0 &&
            this.getWorkspaceContext().cwd === null
              ? 'no-workspace'
              : 'ok';
          this.recordWorkspaceSearch(query, {
            outcome: 'ok',
            resultCount: safeFiles.length,
            durationMs: Math.round(performance.now() - startedAt),
            status,
          });
          if (sessionId === this.sessionId) {
            this.emitWorkspaceFiles(
              sessionId,
              requestId,
              safeFiles,
              status,
            );
          }
        },
        (error) => {
          this.recordWorkspaceSearch(query, {
            outcome: 'failed',
            durationMs: Math.round(performance.now() - startedAt),
            detail: formatUnknownError(error),
          });
          if (sessionId === this.sessionId) {
            this.emitWorkspaceFiles(sessionId, requestId, [], 'ok');
          }
        },
      );
  }

  /** Structured record for one `@` mention file search (P0 gap: the
   * search round-trip previously produced zero log events). */
  private recordWorkspaceSearch(
    query: string,
    attributes: {
      outcome: 'ok' | 'failed' | 'dropped';
      resultCount?: number;
      durationMs?: number;
      reason?: string;
      status?: string;
      detail?: string;
    },
  ): void {
    const { detail, ...rest } = attributes;
    this.recordHost({
      level: attributes.outcome === 'ok' ? 'info' : 'warn',
      name: 'host.workspace.search',
      attributes: { queryLength: query.length, ...rest },
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /**
   * Reads a workspace-local image referenced by transcript markdown.
   * Reuses the attachment reader, which enforces workspace
   * containment and per-kind size caps; anything that is not a
   * displayable image degrades to a non-ok status so the webview can
   * fall back to a clickable path link.
   */
  private handleWorkspaceReadImage(
    sessionId: string,
    path: string,
  ): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    const respond = (
      status: WorkspaceImageStatus,
      mediaType: ImageMediaType | null = null,
      data = '',
    ): void => {
      if (sessionId !== this.sessionId) {
        return;
      }
      this.emit({
        type: 'workspace.imageData',
        sessionId,
        path,
        status,
        mediaType,
        data,
      });
    };
    const cwd = this.getWorkspaceContext().cwd;
    if (cwd === null) {
      respond('not-found');
      return;
    }
    // Markdown may reference the file absolutely; the reader only
    // accepts workspace-relative paths, so rebase inside-root
    // absolutes and refuse everything else.
    const relativePath = isAbsolute(path) ? relative(cwd, path) : path;
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      respond('not-found');
      return;
    }
    void this.attachmentSources
      .readWorkspaceFile(relativePath.replaceAll('\\', '/'))
      .then(
        (outcome) => {
          switch (outcome.status) {
            case 'picked': {
              const item = outcome.items[0];
              if (item === undefined || item.kind !== 'image') {
                respond('unsupported');
              } else if (item.data.length > MAX_IMAGE_DATA_LENGTH) {
                respond('too-large');
              } else {
                respond('ok', item.mediaType, item.data);
              }
              return;
            }
            case 'rejected':
              respond(
                outcome.reason === 'too-large'
                  ? 'too-large'
                  : 'unsupported',
              );
              return;
            default:
              respond('not-found');
          }
        },
        () => respond('not-found'),
      );
  }

  private emitWorkspaceFiles(
    sessionId: string,
    requestId: string,
    files: readonly string[],
    status: WorkspaceFilesStatus,
  ): void {
    this.emit({
      type: 'workspace.files',
      sessionId,
      requestId,
      status,
      files,
    });
  }

  private handleAttachmentRemove(
    sessionId: string,
    attachmentId: string,
    stage?: AttachmentStage,
  ): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    if (stage === 'edit') {
      if (this.editStage === null) {
        return;
      }
      const next = this.editStage.attachments.filter(
        ({ summary }) => summary.id !== attachmentId,
      );
      if (next.length === this.editStage.attachments.length) {
        return;
      }
      this.editStage.attachments = next;
      this.emitEditAttachments();
      return;
    }
    const next = this.pendingAttachments.filter(
      ({ summary }) => summary.id !== attachmentId,
    );
    if (next.length === this.pendingAttachments.length) {
      return;
    }
    this.pendingAttachments = next;
    this.emitAttachments();
  }

  /**
   * Converts environment payloads into pending attachments. `capture`
   * overrides the display kind for editor and selection captures so
   * the chip communicates the source rather than the payload format.
   */
  private stageAttachmentPayloads(
    payloads: readonly AttachmentPayload[],
    capture?: 'editor' | 'selection',
    stage?: AttachmentStage,
  ): void {
    // The edit staging area may have been cancelled while an async
    // read (file picker, workspace file) was in flight; drop late
    // results instead of staging them into the composer.
    if (stage === 'edit' && this.editStage === null) {
      return;
    }
    let staged = 0;
    for (const payload of payloads) {
      if (this.stagedCount(stage) >= MAX_PENDING_ATTACHMENTS) {
        this.emitSessionDiagnostic(
          'attachment-limit',
          ATTACHMENT_LIMIT_MESSAGE,
        );
        break;
      }
      const runtime = toRuntimeAttachment(payload);
      if (runtime === null) {
        continue;
      }
      this.attachmentIdCounter += 1;
      const kind: AttachmentKind = capture ?? payload.kind;
      const summary: AttachmentSummary = {
        id: `attachment-${this.attachmentIdCounter}`,
        kind,
        name: boundAttachmentName(payload.name),
        sizeBytes: payload.sizeBytes,
        truncated: payload.truncated,
      };
      if (stage === 'edit') {
        this.editStage!.attachments = [
          ...this.editStage!.attachments,
          { summary: { ...summary, restorable: true }, runtime },
        ];
      } else {
        this.pendingAttachments = [
          ...this.pendingAttachments,
          { summary, runtime },
        ];
      }
      staged += 1;
    }
    if (staged > 0) {
      if (stage === 'edit') {
        this.emitEditAttachments();
      } else {
        this.emitAttachments();
      }
    }
  }

  private takePendingAttachments():
    | readonly PendingAttachment[]
    | undefined {
    if (this.pendingAttachments.length === 0) {
      return undefined;
    }
    const attachments = this.pendingAttachments;
    this.pendingAttachments = [];
    this.emitAttachments();
    return attachments;
  }

  private clearPendingAttachments(): void {
    this.pendingAttachments = [];
    this.editStage = null;
    this.pendingSentAttachments = null;
  }

  /**
   * Moves the attachments consumed by `turnId` into the retention
   * area once the SDK reports the message id they were sent under.
   * Oldest entries are evicted in insertion order when the byte
   * budget overflows; an entry can evict itself if it alone exceeds
   * the budget.
   */
  private retainSentAttachments(
    turnId: string,
    messageId: string,
  ): void {
    const pending = this.pendingSentAttachments;
    if (pending === null || pending.turnId !== turnId) {
      return;
    }
    this.pendingSentAttachments = null;
    this.sentAttachments.delete(messageId);
    this.sentAttachments.set(messageId, pending.attachments);
    let total = 0;
    for (const entries of this.sentAttachments.values()) {
      total += retentionBytes(entries);
    }
    for (const [key, entries] of this.sentAttachments) {
      if (total <= MAX_SENT_ATTACHMENT_RETENTION_BYTES) {
        break;
      }
      this.sentAttachments.delete(key);
      total -= retentionBytes(entries);
    }
  }

  emitAttachments(): void {
    if (this.sessionId === null) {
      return;
    }
    this.emit({
      type: 'session.attachments',
      sessionId: this.sessionId,
      attachments: this.pendingAttachments.map(
        ({ summary }) => summary,
      ),
    });
  }

  private emitEditAttachments(): void {
    if (this.sessionId === null || this.editStage === null) {
      return;
    }
    this.emit({
      type: 'session.editAttachments',
      sessionId: this.sessionId,
      messageId: this.editStage.messageId,
      attachments: this.editStage.attachments.map(
        ({ summary }) => summary,
      ),
    });
  }

  /**
   * Enters edit mode for one sent user message: initializes the edit
   * staging area from the retention area when the payloads are still
   * held, otherwise from the message's chip metadata (removable-only)
   * plus user-echo image items whose base64 is still in the transcript.
   */
  private handleEditStageBegin(
    sessionId: string,
    messageId: string,
  ): void {
    if (
      sessionId !== this.sessionId ||
      this.connection.status !== 'connected'
    ) {
      return;
    }
    const index = this.transcript.transcript.findIndex(
      (item) => item.kind === 'user' && item.messageId === messageId,
    );
    if (index < 0) {
      return;
    }
    this.editStage = {
      messageId,
      attachments: this.buildEditStageAttachments(messageId, index),
    };
    this.emitEditAttachments();
  }

  private handleEditStageCancel(sessionId: string): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    this.editStage = null;
  }

  private buildEditStageAttachments(
    messageId: string,
    userItemIndex: number,
  ): readonly EditStagedAttachment[] {
    const retained = this.sentAttachments.get(messageId);
    if (retained !== undefined) {
      return retained.map(({ summary, runtime }) => ({
        summary: { ...summary, restorable: true },
        runtime,
      }));
    }
    const staged: EditStagedAttachment[] = [];
    const userItem = this.transcript.transcript[userItemIndex];
    if (userItem?.kind === 'user' && userItem.attachments !== undefined) {
      for (const meta of userItem.attachments) {
        this.attachmentIdCounter += 1;
        staged.push({
          summary: {
            id: `attachment-${this.attachmentIdCounter}`,
            kind: meta.kind,
            name: meta.name,
            sizeBytes: meta.sizeBytes,
            truncated: false,
            restorable: false,
          },
          runtime: null,
        });
      }
    }
    // User-echo image items directly follow their prompt in both live
    // and loaded transcripts; ones still carrying full base64 can be
    // rebuilt into resendable payloads.
    const transcript = this.transcript.transcript;
    for (
      let index = userItemIndex + 1;
      index < transcript.length && staged.length < MAX_PENDING_ATTACHMENTS;
      index += 1
    ) {
      const item = transcript[index]!;
      if (item.kind === 'user') {
        break;
      }
      if (item.kind !== 'image' || item.origin !== 'user') {
        continue;
      }
      this.attachmentIdCounter += 1;
      const restorable = item.data.length > 0;
      staged.push({
        summary: {
          id: `attachment-${this.attachmentIdCounter}`,
          kind: 'image',
          name: `image.${item.mediaType.slice('image/'.length)}`,
          sizeBytes: item.byteLength,
          truncated: false,
          restorable,
        },
        runtime: restorable
          ? {
              kind: 'image',
              data: item.data,
              mediaType: item.mediaType,
            }
          : null,
      });
    }
    return staged.slice(0, MAX_PENDING_ATTACHMENTS);
  }

  private handleSettingUpdate(
    message: SessionSettingUpdateMessage,
  ): void {
    const runtime = this.runtime;
    const cwd = this.activeRuntimeCwd;
    if (
      runtime === null ||
      cwd === null ||
      message.sessionId !== this.sessionId ||
      this.connection.status !== 'connected' ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
      return;
    }
    if (
      this.interactions.hasPending() ||
      this.sessionOperationInProgress ||
      this.settingsUpdate !== null ||
      this.settings.status === 'loading' ||
      this.settings.status === 'updating' ||
      this.settings.value === null
    ) {
      this.emitSessionDiagnostic(
        'settings-update-blocked',
        SETTINGS_UPDATE_BLOCKED_MESSAGE,
      );
      return;
    }
    if (!this.isSettingUpdateSupported(message)) {
      this.emitSessionDiagnostic(
        'settings-update-unsupported',
        SETTINGS_UPDATE_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    const operation = Symbol('settings-update');
    const generation = this.runtimeGeneration;
    const confirmed = this.settings.value;
    this.settingsUpdate = operation;
    this.settings = { status: 'updating', value: confirmed };
    this.emitSettings(message.sessionId);
    const update: RuntimeSessionSettingUpdate = {
      field: message.field,
      value: message.value,
    } as RuntimeSessionSettingUpdate;
    void runtime
      .updateSessionSetting(update)
      .then((result) => {
        if (
          !this.isCurrentSettingsUpdate(
            runtime,
            generation,
            message.sessionId,
            cwd,
            operation,
          )
        ) {
          return;
        }
        this.settings = {
          status: 'ready',
          value: projectConfirmedSettings(result),
        };
        this.emitSettings(message.sessionId);
      })
      .catch(() => {
        if (
          !this.isCurrentSettingsUpdate(
            runtime,
            generation,
            message.sessionId,
            cwd,
            operation,
          )
        ) {
          return;
        }
        this.settings = {
          status: 'error',
          value: confirmed,
          message: SETTINGS_UPDATE_FAILED_MESSAGE,
        };
        this.emitSettings(message.sessionId);
      })
      .finally(() => {
        if (this.settingsUpdate === operation) {
          this.settingsUpdate = null;
        }
      });
  }

  private isSettingUpdateSupported(
    message: SessionSettingUpdateMessage,
  ): boolean {
    if (
      message.field === 'interactionMode' ||
      message.field === 'autonomyLevel'
    ) {
      return true;
    }
    if (
      (message.field === 'specModeModelId' ||
        message.field === 'specModeReasoningEffort') &&
      message.value === null
    ) {
      // Resetting a spec override needs no catalog knowledge.
      return true;
    }
    const settings = this.settings.value;
    if (
      this.modelCatalog.status !== 'ready' ||
      settings === null
    ) {
      return false;
    }
    if (
      message.field === 'modelId' ||
      message.field === 'specModeModelId'
    ) {
      return this.modelCatalog.items.some(
        ({ id }) => id === message.value,
      );
    }
    // Reasoning effort must be supported by the model it applies to:
    // the spec drafting model for spec efforts (falling back to the
    // session model when no spec model is set).
    const targetModelId =
      message.field === 'specModeReasoningEffort'
        ? (settings.specModeModelId ?? settings.modelId)
        : settings.modelId;
    const model = this.modelCatalog.items.find(
      ({ id }) => id === targetModelId,
    );
    return (
      model !== undefined &&
      message.value !== null &&
      model.supportedReasoningEfforts.includes(message.value)
    );
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
      this.seedBackgroundRunning(cwd);
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
        this.setSessionRunning(detachedSessionId, true);
        this.ensureBackgroundRunningPoll();
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
      this.setSessionRunning(sessionId, true);
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
        this.emitSettings(sessionId);
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
        this.emitSettings(sessionId);
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
    const sessions = this.stampRunningFlags(
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
      this.setSessionRunning(sessionId, false);
    } else {
      this.setSessionRunning(sessionId, true);
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

  private emitSettings(sessionId: string): void {
    this.emit({
      type: 'session.settings',
      sessionId,
      settings: this.settings,
    });
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

  private refreshSettingsAfterRuntimeEvent(sessionId: string): void {
    const runtime = this.runtime;
    const cwd = this.activeRuntimeCwd;
    if (
      runtime === null ||
      cwd === null ||
      this.sessionId !== sessionId ||
      this.connection.status !== 'connected'
    ) {
      return;
    }
    const generation = this.runtimeGeneration;
    const confirmed = this.settings.value;
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
        this.emitSettings(sessionId);
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
          value: confirmed,
          message: SETTINGS_READ_FAILED_MESSAGE,
        };
        this.emitSettings(sessionId);
      });
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

  private withActiveSession(
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

  /** Projects the running registry onto catalog rows (`running`). */
  private stampRunningFlags(
    sessions: SessionCatalogState,
  ): SessionCatalogState {
    if (this.runningSessionIds.size === 0) {
      return sessions;
    }
    return {
      ...sessions,
      items: sessions.items.map((item) =>
        this.runningSessionIds.has(item.id)
          ? { ...item, running: true }
          : item,
      ),
    };
  }

  /**
   * Tracks one session's running flag and streams the change as an
   * incremental `session.running` message. No-op when unchanged, so
   * repeated turn.state pushes and poll ticks stay quiet.
   */
  private setSessionRunning(sessionId: string, running: boolean): void {
    if (this.runningSessionIds.has(sessionId) === running) {
      return;
    }
    if (running) {
      this.runningSessionIds.add(sessionId);
    } else {
      this.runningSessionIds.delete(sessionId);
    }
    this.emit({ type: 'session.running', sessionId, running });
  }

  /**
   * True when a flagged session is not covered by local turn state —
   * a detached daemon turn whose only truth source is the daemon's
   * opened-session registry, so a poll must watch it.
   */
  private hasBackgroundRunning(): boolean {
    for (const id of this.runningSessionIds) {
      if (!(id === this.sessionId && isTurnActive(this.turn))) {
        return true;
      }
    }
    return false;
  }

  /** Drops every flag not owned by the local turn (fail closed). */
  private clearBackgroundRunning(): void {
    for (const id of [...this.runningSessionIds]) {
      if (!(id === this.sessionId && isTurnActive(this.turn))) {
        this.setSessionRunning(id, false);
      }
    }
  }

  /**
   * Watches detached running sessions through the daemon's
   * opened-session registry and clears each flag when its session
   * stops reporting a live working state. One cheap registry RPC per
   * tick; the loop ends itself when nothing is left to watch.
   */
  private ensureBackgroundRunningPoll(): void {
    const daemonSessions = this.daemonSessions;
    if (
      this.backgroundRunningPoll !== null ||
      daemonSessions === undefined ||
      !this.hasBackgroundRunning()
    ) {
      return;
    }
    const poll = (async () => {
      let failures = 0;
      while (!this.disposed && this.hasBackgroundRunning()) {
        await delay(BACKGROUND_RUNNING_POLL_MS);
        if (this.disposed || !this.hasBackgroundRunning()) {
          return;
        }
        let states: ReadonlyMap<string, string>;
        try {
          states = await (
            await daemonSessions()
          ).readOpenedWorkingStates();
        } catch {
          failures += 1;
          if (failures >= BACKGROUND_RUNNING_MAX_FAILURES) {
            this.clearBackgroundRunning();
            return;
          }
          continue;
        }
        failures = 0;
        if (this.disposed) {
          return;
        }
        for (const id of [...this.runningSessionIds]) {
          // The active session's flag is owned by local turn state.
          if (id === this.sessionId && isTurnActive(this.turn)) {
            continue;
          }
          if (!LIVE_DAEMON_WORKING_STATES.has(states.get(id) ?? '')) {
            this.setSessionRunning(id, false);
          }
        }
      }
    })().finally(() => {
      this.backgroundRunningPoll = null;
      // A flag added while the loop was exiting still gets a watcher.
      if (!this.disposed && this.hasBackgroundRunning()) {
        this.ensureBackgroundRunningPoll();
      }
    });
    this.backgroundRunningPoll = poll;
  }

  /**
   * Reconciles the running registry against the daemon's
   * opened-session registry after a catalog load: rows with a live
   * daemon turn (detached from here, another window, or the CLI)
   * gain the flag, stale flags drop. Quiet on failure — the
   * indicator stays as-is until the next refresh.
   */
  private seedBackgroundRunning(cwd: string): void {
    const daemonSessions = this.daemonSessions;
    if (daemonSessions === undefined) {
      return;
    }
    void (async () => {
      let states: ReadonlyMap<string, string>;
      try {
        states = await (
          await daemonSessions()
        ).readOpenedWorkingStates();
      } catch {
        return;
      }
      if (this.disposed || this.catalogCwd !== cwd) {
        return;
      }
      const known = new Set<string>();
      for (const item of this.sessions.items) {
        known.add(item.id);
        // The active session's flag is owned by local turn state.
        if (item.id === this.sessionId) {
          continue;
        }
        this.setSessionRunning(
          item.id,
          LIVE_DAEMON_WORKING_STATES.has(states.get(item.id) ?? ''),
        );
      }
      // Prune flags of rows that left the catalog (archived away).
      for (const id of [...this.runningSessionIds]) {
        if (id !== this.sessionId && !known.has(id)) {
          this.setSessionRunning(id, false);
        }
      }
      this.ensureBackgroundRunningPoll();
    })();
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

  private isCurrentSettingsUpdate(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
    operation: symbol,
  ): boolean {
    return (
      this.settingsUpdate === operation &&
      this.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    );
  }

  private resetSessionMetadata(): void {
    this.contextGeneration += 1;
    this.specHandoff = null;
    this.settingsUpdate = null;
    this.settings = { status: 'loading', value: null };
    this.context = { status: 'loading', value: null };
    this.modelCatalog = { status: 'loading', items: [] };
    this.clearPendingAttachments();
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

/** Display subject of a commit: first line, trimmed and capped. */
function commitSubject(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  return firstLine.trim().slice(0, MAX_GIT_COMMIT_SUBJECT_LENGTH);
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

function projectConfirmedSettings(
  settings: RuntimeSessionSettings,
): ConfirmedSessionSettings {
  if (
    !isEnumValue(settings.interactionMode, SESSION_INTERACTION_MODES) ||
    !isSafeModelId(settings.modelId) ||
    !isEnumValue(settings.reasoningEffort, SESSION_REASONING_EFFORTS) ||
    !isEnumValue(settings.autonomyLevel, SESSION_AUTONOMY_LEVELS) ||
    (settings.specModeModelId !== null &&
      !isSafeModelId(settings.specModeModelId)) ||
    (settings.specModeReasoningEffort !== null &&
      !isEnumValue(
        settings.specModeReasoningEffort,
        SESSION_REASONING_EFFORTS,
      ))
  ) {
    throw new Error('Invalid runtime session settings.');
  }
  return {
    interactionMode: settings.interactionMode,
    modelId: settings.modelId,
    reasoningEffort: settings.reasoningEffort,
    autonomyLevel: settings.autonomyLevel,
    specModeModelId: settings.specModeModelId,
    specModeReasoningEffort: settings.specModeReasoningEffort,
  };
}

function toRuntimeAttachment(
  payload: AttachmentPayload,
): RuntimeAttachment | null {
  switch (payload.kind) {
    case 'image':
      return payload.mediaType === undefined
        ? null
        : {
            kind: 'image',
            data: payload.data,
            mediaType: payload.mediaType,
          };
    case 'pdf':
      return { kind: 'pdf', data: payload.data, name: payload.name };
    case 'text':
      return { kind: 'text', data: payload.data, name: payload.name };
  }
}

/**
 * Chip metadata for the non-image attachments a prompt was sent with.
 * Image attachments are represented by their own image transcript
 * items (user-echo), so they are excluded here.
 */
function sentAttachmentSummaries(
  attachments: readonly PendingAttachment[],
): readonly SentAttachmentSummary[] | undefined {
  const summaries = attachments
    .filter(({ summary }) => summary.kind !== 'image')
    .map(({ summary }) => ({
      kind: summary.kind,
      name: summary.name,
      sizeBytes: summary.sizeBytes,
    }));
  return summaries.length > 0 ? summaries : undefined;
}

function retentionBytes(
  attachments: readonly PendingAttachment[],
): number {
  let total = 0;
  for (const { runtime } of attachments) {
    total += runtime.data.length;
  }
  return total;
}

function boundAttachmentName(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed.length === 0 ? 'attachment' : trimmed;
  return safe.length > MAX_ATTACHMENT_NAME_LENGTH
    ? safe.slice(0, MAX_ATTACHMENT_NAME_LENGTH)
    : safe;
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

function forkTitleFromText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= MAX_FORK_TITLE_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_FORK_TITLE_LENGTH - 1)}…`;
}

