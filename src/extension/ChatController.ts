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
  collectToolFilePaths,
  createTurnActivityState,
  hasSubagentRows,
  projectAssistantDelta,
  projectSubagentStarted,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  reconcileSubagentSummaries,
  thinkingSegmentKey,
  type TurnActivityState,
} from './turnActivityState';
import { PendingInteractionCoordinator } from './pendingInteractionCoordinator';
import {
  clearPrompts,
  dropDispatchedPrompt,
  emptyQueuedPromptsState,
  enqueuePrompt,
  evaluateQueueDispatch,
  markDispatchBlocked,
  pauseAfterTerminal,
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

interface CurrentTurn {
  readonly turnId: string;
  status: TurnStatus;
  error?: string;
  activity: TurnActivityState;
  /**
   * Marks a turn synthesized by reload reconciliation: the agent loop
   * runs daemon-side with no local stream, so completion comes from
   * working-state polling and Stop must use `interruptSession()`.
   */
  readonly recovery?: true;
}

interface PendingAttachment {
  readonly summary: AttachmentSummary;
  readonly runtime: RuntimeAttachment;
}

/**
 * One entry of the per-message edit staging area. `runtime` is null
 * for chips whose original payload is no longer available (evicted
 * from the retention area or predating this window); those can only
 * be removed, never resent.
 */
interface EditStagedAttachment {
  readonly summary: EditAttachmentSummary;
  readonly runtime: RuntimeAttachment | null;
}

interface EditStage {
  readonly messageId: string;
  attachments: readonly EditStagedAttachment[];
}

/**
 * Byte budget for retained sent-attachment payloads (memory only):
 * 8 attachments x 4 MB fits exactly one maximal message, covering
 * the common "edit the latest message" case.
 */
export const MAX_SENT_ATTACHMENT_RETENTION_BYTES = 32 * 1024 * 1024;

interface DisposableSubscription {
  dispose(): void;
}

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
const QUEUE_DISPATCH_BLOCKED_MESSAGE =
  'Droid is busy, so the queued messages are paused. Use "Send now" once it settles.';
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
const DAEMON_NOT_LOGGED_IN_MESSAGE =
  'Sign in with the droid CLI to archive and search sessions.';
const DAEMON_UNAVAILABLE_MESSAGE =
  'The local droid daemon is unavailable.';
const ARCHIVE_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before archiving.';
const ARCHIVE_ACTIVE_MESSAGE =
  'Switch to another session before archiving the active one.';
const ARCHIVE_FAILED_MESSAGE = 'The session could not be archived.';
const UNARCHIVE_FAILED_MESSAGE =
  'The session could not be restored from the archive.';
const SKILLS_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose skills.';
const SKILLS_LOAD_FAILED_MESSAGE =
  'Droid did not return the skill list. Retry from the skills panel.';
const COMMANDS_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose custom commands.';
const COMMANDS_LOAD_FAILED_MESSAGE =
  'Droid did not return the command list. Type / again to retry.';
const SKILL_TOGGLE_FAILED_MESSAGE =
  'Droid could not update that skill. The list may be stale; refresh it.';
const PLUGINS_UNSUPPORTED_MESSAGE =
  'Plugins are not available in this Droid runtime.';
const PLUGINS_LOAD_FAILED_MESSAGE =
  'Droid did not return the plugin list. Retry from the plugins panel.';
const PLUGINS_NOT_LOGGED_IN_MESSAGE =
  'Sign in with the droid CLI to view plugins.';
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
const PREVIEW_FAILED_MESSAGE =
  'That prototype could not be previewed. It may have been moved, deleted, or is too large.';
const OPEN_PATH_FAILED_MESSAGE =
  'That path could not be opened. It may have been moved or deleted.';
const MCP_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose MCP servers.';
const MCP_LOAD_FAILED_MESSAGE =
  'Droid did not return the MCP catalog. Retry from the MCP panel.';
const MCP_TOGGLE_FAILED_MESSAGE =
  'Droid could not update that MCP server. The list may be stale; refresh it.';
const MCP_ADD_FAILED_MESSAGE =
  'Droid could not add that MCP server. Check the command or URL and retry.';
const MCP_REMOVE_FAILED_MESSAGE =
  'Droid could not remove that MCP server. The list may be stale; refresh it.';
const MCP_AUTH_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support MCP authentication.';
const MCP_AUTH_START_FAILED_MESSAGE =
  'Droid could not start authentication for that MCP server.';
const MCP_AUTH_BROWSER_MESSAGE =
  'Complete the sign-in in your browser.';
const MCP_AUTH_NO_URL_MESSAGE =
  'Droid did not start a browser sign-in. The server may already be authenticated; refresh the MCP list to check.';
const MCP_AUTH_BROWSER_FAILED_MESSAGE =
  'The sign-in page could not be opened in a browser.';
const MCP_AUTH_TIMEOUT_MESSAGE =
  'Stopped waiting for browser authentication. Refresh the MCP list to check the result.';
/**
 * How long the host waits for an MCP auth outcome before giving up.
 * Kept short: a browser OAuth round-trip either completes within a
 * couple of minutes or the user has abandoned it, and the previous
 * 10-minute wait outlived every real session.
 */
const MCP_AUTH_WAIT_TIMEOUT_MS = 2 * 60_000;
const MCP_REQUEST_DROPPED_MESSAGE =
  'Droid could not accept that MCP change right now. Retry in a moment.';
const SKILL_REQUEST_DROPPED_MESSAGE =
  'Droid could not accept that skill change right now. Retry in a moment.';
const CONTEXT_READ_FAILED_MESSAGE =
  'Droid did not return context usage. Retry, then open DroidVisX Logs if this continues.';
const MODEL_CATALOG_UNSUPPORTED_MESSAGE =
  'Model selection is unavailable in this Droid runtime.';
const MODEL_CATALOG_FAILED_MESSAGE =
  'Droid models could not be loaded.';
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
  private readonly listeners = new Set<ChatControllerListener>();
  private readonly interactions: PendingInteractionCoordinator;
  private runtime: DroidRuntime | null = null;
  private connection: ConnectionState = { status: 'idle' };
  private sessions: SessionCatalogState = {
    status: 'idle',
    items: [],
  };
  private transcript: HostTranscriptState =
    createHostTranscriptState('unavailable');
  private sessionId: string | null = null;
  /**
   * Read-only mission identity of the active session, from the last
   * successful history load; null for sessions outside a mission.
   */
  private mission: SessionMissionSummary | null = null;
  /**
   * Token-usage breakdown of the active session: cumulative totals
   * seeded from history and overwritten by live `token-usage`
   * events; `lastTurn` set by each completed turn in this window.
   */
  private tokenUsage: SessionTokenUsageState = EMPTY_SESSION_TOKEN_USAGE;
  private turn: CurrentTurn | null = null;
  private settings: SessionSettingsState = {
    status: 'loading',
    value: null,
  };
  private context: SessionContextState = {
    status: 'loading',
    value: null,
  };
  private modelCatalog: ModelCatalogState = {
    status: 'loading',
    items: [],
  };
  private sequence = -1;
  private runtimeGeneration = 0;
  private turnGeneration = 0;
  private contextGeneration = 0;
  private settingsUpdate: symbol | null = null;
  private catalogGeneration = 0;
  private catalogCwd: string | null = null;
  /**
   * True when the current workspace may create worktree sessions:
   * daemon runtime mode (worktreeSessions.enabled) and a git
   * workspace. Recomputed per catalog cwd binding; snapshots only
   * advertise it while true (fail closed).
   */
  private worktreeCreateAvailable = false;
  /** Workspace cwd the availability check was computed for. */
  private worktreeAvailabilityCwd: string | null = null;
  private activeRuntimeCwd: string | null = null;
  private initialization: Promise<void> | null = null;
  private workspaceContext: WorkspaceContext;
  private workspaceContextGeneration = 0;
  private workspaceTransition: Promise<void> | null = null;
  private sessionOperationInProgress = false;
  private refreshInProgress = false;
  /**
   * Spec-handoff state of the active turn: `expected` right after the
   * user approves an ExitSpecMode plan into a new session, `detected`
   * once the runtime reports the implementation session id. Adoption
   * happens when the turn completes.
   */
  private specHandoff:
    | { readonly turnId: string; readonly status: 'expected' }
    | {
        readonly turnId: string;
        readonly status: 'detected';
        readonly implementationSessionId: string;
      }
    | null = null;
  private pendingAttachments: PendingAttachment[] = [];
  /**
   * Prompts queued while a turn runs (queued-messages-design.md
   * §4.1). Host memory only — the queue dies with the session line
   * (reload, session switch, fork, compact, workspace change).
   */
  private queuedPrompts: QueuedPromptsState<PendingAttachment> =
    emptyQueuedPromptsState();
  private editStage: EditStage | null = null;
  /**
   * Payloads of already-sent attachments keyed by SDK message id, so
   * editing a recent message can resend its attachments without
   * re-reading them. Memory only; never persisted to checkpoints.
   */
  private readonly sentAttachments = new Map<
    string,
    readonly PendingAttachment[]
  >();
  /** Attachments consumed by the turn still waiting for its message id. */
  private pendingSentAttachments: {
    readonly turnId: string;
    readonly attachments: readonly PendingAttachment[];
  } | null = null;
  private attachmentOperationInProgress = false;
  private attachmentIdCounter = 0;
  private readonly managedRuntimes = new Set<DroidRuntime>();
  private readonly runtimeClosures = new Map<
    DroidRuntime,
    Promise<void>
  >();
  private readonly closedRuntimes = new WeakSet<DroidRuntime>();
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private pendingRecoveryCheckpoint: {
    readonly sessionId: string;
    readonly cache: HostTranscriptState;
  } | null = null;
  private recoveryCheckpointTimer: ReturnType<typeof setTimeout> | null =
    null;
  private mcpAuthServerName: string | null = null;
  private mcpAuthTimer: ReturnType<typeof setTimeout> | null = null;
  private commandsCache: {
    readonly sessionId: string;
    readonly items: readonly CommandSummary[];
  } | null = null;
  /**
   * Runtime generation of the in-flight command-catalog load, or null
   * when none. Tied to the generation instead of a boolean so a hung
   * short-lived catalog process stops blocking refreshes as soon as
   * the session or workspace binding changes.
   */
  private commandsRefreshGeneration: number | null = null;
  private readonly interactionOpenedAt = new Map<string, number>();
  /** Outbound Bridge message accounting for the active turn (P5). */
  private turnIo: {
    counts: Map<string, number>;
    bytes: number;
  } | null = null;
  /** Hidden-fork side chat; null outside process mode. */
  private readonly btwSideChat: BtwSideChat | null;

  constructor(
    private readonly createRuntime: DroidRuntimeFactory,
    private readonly getWorkspaceContext: WorkspaceContextProvider,
    private readonly sessionCatalog: SessionCatalog =
      createEmptySessionCatalog(),
    private readonly recoveryStore: SessionRecoveryStore =
      createTransientRecoveryStore(),
    private readonly sessionHistory: SessionHistoryLoader =
      createUnavailableSessionHistoryLoader(),
    private readonly attachmentSources: AttachmentSources =
      createUnavailableAttachmentSources(),
    private readonly fileDiff: FileDiffOpener =
      createUnavailableFileDiffOpener(),
    private readonly changeStats: ChangeStatsReader =
      createUnavailableChangeStatsReader(),
    private readonly externalUrl: ExternalUrlOpener =
      createUnavailableExternalUrlOpener(),
    private readonly recentCommands: RecentCommandsStore =
      new RecentCommandsStore(),
    private readonly diagnostics?: RuntimeDiagnosticSink,
    private readonly daemonSessions?: () => Promise<DaemonSessionCatalog>,
    private readonly pathOpener: PathOpener =
      createUnavailablePathOpener(),
    private readonly prototypePreview: PrototypePreviewOpener =
      createUnavailablePrototypePreviewOpener(),
    private readonly gitWorkflow: GitWorkflow =
      createUnavailableGitWorkflow(),
    private readonly worktreeSessions?: WorktreeSessionsFeature,
    private readonly terminalMirror?: TerminalMirror,
    private readonly daemonPlugins?: () => Promise<DaemonPluginCatalog>,
    btwSidecarFactory?: BtwSidecarFactory,
  ) {
    this.workspaceContext = {
      ...this.getWorkspaceContext(),
    };
    // Process-mode only (side-question-design.md §6): without a
    // factory the snapshot never advertises btwAvailable, so the
    // webview entry stays hidden (fail closed in daemon mode).
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
        this.handleQueueAdd(
          message.sessionId,
          message.queueId,
          message.text,
        );
        return;
      case 'queue.update':
        this.handleQueueUpdate(
          message.sessionId,
          message.queueId,
          message.text,
        );
        return;
      case 'queue.remove':
        this.handleQueueRemove(message.sessionId, message.queueId);
        return;
      case 'queue.resume':
        this.handleQueueResume(message.sessionId);
        return;
      case 'queue.clear':
        this.handleQueueClear(message.sessionId);
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
        this.handleContextRefresh(message.sessionId);
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
        this.handleSkillsRefresh(message.sessionId);
        return;
      case 'plugins.refresh':
        this.handlePluginsRefresh(message.sessionId);
        return;
      case 'commands.refresh':
        this.handleCommandsRefresh(message.sessionId);
        return;
      case 'skill.toggle':
        this.handleSkillToggle(
          message.sessionId,
          message.name,
          message.disabled,
        );
        return;
      case 'mcp.refresh':
        this.handleMcpRefresh(message.sessionId);
        return;
      case 'mcp.server.toggle':
        this.handleMcpServerToggle(
          message.sessionId,
          message.name,
          message.enabled,
        );
        return;
      case 'mcp.server.add': {
        const { type: _type, sessionId, ...params } = message;
        this.handleMcpServerAdd(sessionId, params);
        return;
      }
      case 'mcp.server.remove':
        this.handleMcpServerRemove(message.sessionId, message.name);
        return;
      case 'mcp.server.authenticate':
        this.handleMcpServerAuthenticate(message.sessionId, message.name);
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

  private handleSend(
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
    this.recordRecentCommand(sessionId, text);
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
          this.handleTurnComplete(sessionId, turnId, event);
          return;
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
        terminalEventSeen = true;
        this.failTurn(sessionId, turnId, 'runtime-stream-failed');
      }
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
        this.updateTokenUsage(sessionId, {
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
      this.updateTokenUsage(sessionId, { lastTurn: event.turnUsage });
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

  /**
   * Queued-messages intake (queued-messages-design.md §4.2). The
   * webview enqueues optimistically, so every request — accepted or
   * not — is answered with an authoritative `queue.state` echo that
   * confirms or rewinds the optimistic card. Rejections are silent
   * beyond a debug log; the composer already prevents them locally.
   */
  private handleQueueAdd(
    sessionId: string,
    queueId: string,
    text: string,
  ): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    // The composer staging area rides along with the queued prompt;
    // consume it only when the enqueue is accepted.
    const result = enqueuePrompt(this.queuedPrompts, {
      queueId,
      text,
      attachments: this.pendingAttachments,
    });
    if (!result.accepted) {
      this.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'add', reason: result.reason },
      });
      // Re-sync the chips too: the optimistic add already moved the
      // staged attachments into the webview's queued card.
      this.emitAttachments();
      this.emitQueueState();
      return;
    }
    if (this.pendingAttachments.length > 0) {
      this.pendingAttachments = [];
      this.emitAttachments();
    }
    this.queuedPrompts = result.state;
    this.recordHost({
      level: 'info',
      name: 'host.queue.added',
      attributes: {
        textLength: text.length,
        depth: this.queuedPrompts.items.length,
      },
      detail: text,
    });
    this.emitQueueState();
    // The turn may have settled while the enqueue was in flight;
    // dispatch now instead of stranding the prompt until the next
    // terminal turn (design §4.3 race note).
    this.maybeDispatchQueue();
  }

  private handleQueueUpdate(
    sessionId: string,
    queueId: string,
    text: string,
  ): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    const result = updatePromptText(this.queuedPrompts, queueId, text);
    if (!result.updated) {
      // Most likely dispatched while the edit was in flight; the
      // echo below rewinds the optimistic webview edit.
      this.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'update' },
      });
    }
    this.queuedPrompts = result.state;
    this.emitQueueState();
  }

  private handleQueueRemove(sessionId: string, queueId: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    const result = removePrompt(this.queuedPrompts, queueId);
    if (!result.removed) {
      this.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'remove' },
      });
    }
    this.queuedPrompts = result.state;
    this.emitQueueState();
  }

  private handleQueueResume(sessionId: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    this.queuedPrompts = resumeQueue(this.queuedPrompts);
    this.emitQueueState();
    this.maybeDispatchQueue();
  }

  private handleQueueClear(sessionId: string): void {
    if (
      this.connection.status !== 'connected' ||
      sessionId !== this.sessionId
    ) {
      return;
    }
    if (this.queuedPrompts.items.length > 0) {
      this.recordHost({
        level: 'info',
        name: 'host.queue.cleared',
        attributes: { count: this.queuedPrompts.items.length },
      });
    }
    this.queuedPrompts = clearPrompts();
    this.emitQueueState();
  }

  /**
   * Runs the dispatch decision (queued-messages-design.md §4.3).
   * Triggered by a completed turn, an accepted enqueue, and an
   * explicit resume. `handleSend` keeps its own guards, so a veto
   * there downgrades the queue to the paused `dispatch-blocked`
   * state instead of silently losing the prompt.
   */
  private maybeDispatchQueue(): void {
    const decision = evaluateQueueDispatch(this.queuedPrompts, {
      turnActive: isTurnActive(this.turn),
      connected: this.connection.status === 'connected',
      hasRuntime: this.runtime !== null,
      hasSession: this.sessionId !== null,
      hasPendingInteractions: this.interactions.hasPending(),
      sessionOperationInProgress: this.sessionOperationInProgress,
      settingsUpdateInProgress: this.settingsUpdate !== null,
    });
    if (decision.kind === 'idle' || decision.kind === 'wait') {
      return;
    }
    if (decision.kind === 'blocked') {
      this.pauseQueueAsBlocked();
      return;
    }
    const sessionId = this.sessionId;
    if (sessionId === null) {
      return;
    }
    const { prompt } = decision;
    // The generation only advances when handleSend accepts, so it
    // separates a real dispatch from a veto — matching turn ids
    // cannot (a stale completed turn may share the queued id).
    const generationBefore = this.turnGeneration;
    this.handleSend(
      sessionId,
      prompt.queueId,
      prompt.text,
      'queued',
      prompt.attachments,
    );
    if (
      this.turnGeneration === generationBefore ||
      this.turn?.turnId !== prompt.queueId
    ) {
      // A residual handleSend guard (workspace drift, duplicate turn
      // id) vetoed the send; keep the prompt and pause so the queue
      // does not spin against a send path that keeps refusing.
      this.pauseQueueAsBlocked();
      return;
    }
    this.queuedPrompts = dropDispatchedPrompt(
      this.queuedPrompts,
      prompt.queueId,
    );
    this.recordHost({
      level: 'info',
      name: 'host.queue.dispatched',
      attributes: { remaining: this.queuedPrompts.items.length },
    });
    this.emitQueueState();
    this.emitSnapshot();
  }

  private pauseQueueAsBlocked(): void {
    if (this.queuedPrompts.paused === 'dispatch-blocked') {
      return;
    }
    this.queuedPrompts = markDispatchBlocked(this.queuedPrompts);
    this.emitSessionDiagnostic(
      'queue-dispatch-blocked',
      QUEUE_DISPATCH_BLOCKED_MESSAGE,
    );
    this.emitQueueState();
  }

  /**
   * Applies the queue policy at a terminal turn boundary
   * (queued-messages-design.md §4.3/§4.4): `completed` attempts a
   * dispatch on a microtask (off the turn.state emission stack) so
   * completion side effects land first; Stop and failure park the
   * queue in a paused state that only `queue.resume`, emptying the
   * queue, or a session change leaves.
   */
  private settleQueueAfterTurn(
    sessionId: string,
    status: 'completed' | 'interrupted' | 'failed',
  ): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    if (status === 'completed') {
      queueMicrotask(() => {
        if (!this.disposed) {
          this.maybeDispatchQueue();
        }
      });
      return;
    }
    const paused = pauseAfterTerminal(this.queuedPrompts, status);
    if (paused !== this.queuedPrompts) {
      this.queuedPrompts = paused;
      this.emitQueueState();
    }
  }

  /** Bounded queue projection shared by `queue.state` and snapshots. */
  private projectQueueState(): SessionQueueState {
    return {
      items: this.queuedPrompts.items.map((item) => ({
        queueId: item.queueId,
        text: item.text,
        attachments: item.attachments.map(({ summary }) => ({
          kind: summary.kind,
          name: summary.name,
          sizeBytes: summary.sizeBytes,
        })),
      })),
      paused: this.queuedPrompts.paused,
    };
  }

  private emitQueueState(): void {
    if (this.sessionId === null) {
      return;
    }
    const { items, paused } = this.projectQueueState();
    this.emit({
      type: 'queue.state',
      sessionId: this.sessionId,
      items,
      paused,
    });
  }

  /**
   * Queue lifetime is bound to the session line
   * (queued-messages-design.md §4.5): any rebind — select, new
   * session, fork, compact, edit-resend adoption, workspace change —
   * discards the queued prompts with a visible info diagnostic.
   */
  private discardQueuedPrompts(): void {
    const count = this.queuedPrompts.items.length;
    if (count === 0) {
      return;
    }
    this.queuedPrompts = clearPrompts();
    this.recordHost({
      level: 'info',
      name: 'host.queue.discarded',
      attributes: { count },
    });
    if (this.sessionId !== null) {
      this.emit({
        type: 'runtime.diagnostic',
        sessionId: this.sessionId,
        turnId: null,
        severity: 'info',
        code: 'queued-messages-discarded',
        message:
          count === 1
            ? '1 queued message was discarded because the session changed.'
            : `${count} queued messages were discarded because the session changed.`,
      });
      this.emitQueueState();
    }
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

  private handleContextRefresh(sessionId: string): void {
    if (
      sessionId !== this.sessionId ||
      this.runtime === null ||
      this.connection.status !== 'connected' ||
      this.sessionOperationInProgress ||
      this.context.status === 'loading' ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
      return;
    }

    this.refreshContext(
      this.runtime,
      this.runtimeGeneration,
      sessionId,
      this.activeRuntimeCwd!,
    );
  }

  private handleSkillsRefresh(sessionId: string): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.recordDroppedPanelRequest(
        'skills.refresh',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    this.pushSkills(
      runtime,
      this.runtimeGeneration,
      sessionId,
      this.activeRuntimeCwd!,
    );
  }

  /**
   * Loads and emits the skills catalog. Called from the user-request
   * guard chain and directly from session activation
   * (`loadSessionMetadata`), where `sessionOperationInProgress` is
   * still set and the request guard would wrongly drop the push.
   */
  private pushSkills(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    if (typeof runtime.listSkills !== 'function') {
      this.emitSkills(sessionId, {
        status: 'unsupported',
        items: [],
        message: SKILLS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    this.emitSkills(sessionId, { status: 'loading', items: [] });
    void runtime.listSkills().then(
      (skills) => {
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
        this.emitSkills(sessionId, {
          status: 'ready',
          items: skills.map(projectSkillSummary),
        });
      },
      (error) => {
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
        this.recordPanelFailure(
          'skills-load-failed',
          formatUnknownError(error),
        );
        this.emitSkills(sessionId, {
          status: 'error',
          items: [],
          message: SKILLS_LOAD_FAILED_MESSAGE,
        });
      },
    );
  }

  private handleSkillToggle(
    sessionId: string,
    name: string,
    disabled: boolean,
  ): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      const reason = dropReason ?? 'no-runtime';
      this.recordDroppedPanelRequest('skill.toggle', reason);
      if (
        reason !== 'session-mismatch' &&
        sessionId === this.sessionId
      ) {
        this.emitSkills(sessionId, {
          status: 'error',
          items: [],
          message: SKILL_REQUEST_DROPPED_MESSAGE,
        });
      }
      return;
    }
    if (
      typeof runtime.setSkillDisabled !== 'function' ||
      typeof runtime.listSkills !== 'function'
    ) {
      this.emitSkills(sessionId, {
        status: 'unsupported',
        items: [],
        message: SKILLS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    this.emitSkills(sessionId, { status: 'loading', items: [] });
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd!;
    void runtime
      .setSkillDisabled(name, disabled)
      .then(() => runtime.listSkills!())
      .then(
        (skills) => {
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
          this.emitSkills(sessionId, {
            status: 'ready',
            items: skills.map(projectSkillSummary),
          });
        },
        (error) => {
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
          this.recordPanelFailure(
            'skill-toggle-failed',
            formatUnknownError(error),
          );
          this.emitSkills(sessionId, {
            status: 'error',
            items: [],
            message: SKILL_TOGGLE_FAILED_MESSAGE,
          });
        },
      );
  }

  private emitSkills(
    sessionId: string,
    skills: SessionSkillsState,
  ): void {
    this.emit({
      type: 'session.skills',
      sessionId,
      skills,
    });
  }

  /**
   * Serves the read-only plugins panel through the daemon sidecar:
   * `plugins.listInstalled` and `marketplaces.list` run concurrently
   * against the active session id (the daemon accepts any on-disk
   * session id for these RPCs — probe evidence in
   * docs/product/plugins-hooks-design.md §2.1). Daemon failures
   * surface as an explicit error state, never a silent empty list.
   */
  private handlePluginsRefresh(sessionId: string): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.recordDroppedPanelRequest(
        'plugins.refresh',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    const daemonPlugins = this.daemonPlugins;
    if (daemonPlugins === undefined) {
      this.emitPlugins(sessionId, {
        status: 'unsupported',
        items: [],
        message: PLUGINS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    this.emitPlugins(sessionId, { status: 'loading', items: [] });
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd!;
    void daemonPlugins()
      .then((catalog) => catalog.snapshot(sessionId))
      .then(
        (snapshot) => {
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
          this.emitPlugins(sessionId, {
            status: 'ready',
            items: projectPluginSummaries(snapshot.plugins),
            marketplaceCount: Math.min(
              snapshot.marketplaceCount,
              MAX_PLUGIN_MARKETPLACE_COUNT,
            ),
          });
        },
        (error) => {
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
          this.recordPanelFailure(
            'plugins-load-failed',
            formatUnknownError(error),
          );
          this.emitPlugins(sessionId, {
            status: 'error',
            items: [],
            message: daemonFailureMessage(
              error,
              PLUGINS_LOAD_FAILED_MESSAGE,
              PLUGINS_NOT_LOGGED_IN_MESSAGE,
            ),
          });
        },
      );
  }

  private emitPlugins(
    sessionId: string,
    plugins: SessionPluginsState,
  ): void {
    this.emit({
      type: 'session.plugins',
      sessionId,
      plugins,
    });
  }

  private handleCommandsRefresh(sessionId: string): void {
    const runtime = this.runtime;
    if (
      sessionId !== this.sessionId ||
      runtime === null ||
      this.connection.status !== 'connected' ||
      this.sessionOperationInProgress ||
      this.commandsRefreshGeneration === this.runtimeGeneration ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
      return;
    }
    if (typeof runtime.listCommands !== 'function') {
      this.emitCommands(sessionId, {
        status: 'unsupported',
        items: [],
        recent: [],
        message: COMMANDS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    const cachedItems = this.cachedCommandItems(sessionId);
    this.emitCommands(sessionId, {
      status: 'loading',
      items: cachedItems,
      recent: this.recentCommands.read(),
    });
    const generation = this.runtimeGeneration;
    this.commandsRefreshGeneration = generation;
    const cwd = this.activeRuntimeCwd!;
    void runtime.listCommands().then(
      (commands) => {
        if (this.commandsRefreshGeneration === generation) {
          this.commandsRefreshGeneration = null;
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
        const items = commands.map(projectCommandSummary);
        this.commandsCache = { sessionId, items };
        this.emitCommands(sessionId, {
          status: 'ready',
          items,
          recent: this.recentCommands.read(),
        });
      },
      () => {
        if (this.commandsRefreshGeneration === generation) {
          this.commandsRefreshGeneration = null;
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
        this.emitCommands(sessionId, {
          status: 'error',
          items: this.cachedCommandItems(sessionId),
          recent: this.recentCommands.read(),
          message: COMMANDS_LOAD_FAILED_MESSAGE,
        });
      },
    );
  }

  private cachedCommandItems(
    sessionId: string,
  ): readonly CommandSummary[] {
    return this.commandsCache?.sessionId === sessionId
      ? this.commandsCache.items
      : [];
  }

  /**
   * Records a `/command` invocation in the recent list when the sent
   * text starts with a known custom command, then re-broadcasts the
   * catalog so the popup reorders immediately.
   */
  private recordRecentCommand(sessionId: string, text: string): void {
    if (
      !text.startsWith('/') ||
      this.commandsCache?.sessionId !== sessionId
    ) {
      return;
    }
    const slug = text
      .slice(1)
      .split(/\s/, 1)[0]!
      .toLowerCase();
    const match = this.commandsCache.items.find(
      (item) => item.name.toLowerCase() === slug,
    );
    if (match === undefined) {
      return;
    }
    const recent = this.recentCommands.record(match.name);
    this.emitCommands(sessionId, {
      status: 'ready',
      items: this.commandsCache.items,
      recent,
    });
  }

  private emitCommands(
    sessionId: string,
    commands: SessionCommandsState,
  ): void {
    this.emit({
      type: 'session.commands',
      sessionId,
      commands,
    });
  }

  private handleMcpRefresh(sessionId: string): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.recordDroppedPanelRequest(
        'mcp.refresh',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    this.pushMcp(
      runtime,
      this.runtimeGeneration,
      sessionId,
      this.activeRuntimeCwd!,
    );
  }

  /**
   * Loads and emits the MCP server catalog. Shares the activation
   * push path with `pushSkills`; see that method for why this skips
   * the user-request guard chain.
   */
  private pushMcp(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    if (typeof runtime.listMcpServers !== 'function') {
      this.emitMcp(sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    this.emitMcp(sessionId, { status: 'loading', items: [] });
    void runtime.listMcpServers().then(
      (servers) => {
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
        this.emitMcp(sessionId, {
          status: 'ready',
          items: servers.map(projectMcpServerSummary),
        });
      },
      (error) => {
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
        this.recordPanelFailure(
          'mcp-load-failed',
          formatUnknownError(error),
        );
        this.emitMcp(sessionId, {
          status: 'error',
          items: [],
          message: MCP_LOAD_FAILED_MESSAGE,
        });
      },
    );
  }

  private handleMcpServerToggle(
    sessionId: string,
    name: string,
    enabled: boolean,
  ): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.reportDroppedMcpMutation(
        'mcp.server.toggle',
        sessionId,
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (
      typeof runtime.setMcpServerEnabled !== 'function' ||
      typeof runtime.listMcpServers !== 'function'
    ) {
      this.emitMcp(sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }
    this.applyMcpMutation(
      sessionId,
      runtime,
      'toggle',
      () => runtime.setMcpServerEnabled!(name, enabled),
      MCP_TOGGLE_FAILED_MESSAGE,
    );
  }

  private handleMcpServerAdd(
    sessionId: string,
    params: Omit<McpServerAddMessage, 'type' | 'sessionId'>,
  ): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.reportDroppedMcpMutation(
        'mcp.server.add',
        sessionId,
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (
      typeof runtime.addMcpServer !== 'function' ||
      typeof runtime.listMcpServers !== 'function'
    ) {
      this.emitMcp(sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }
    this.applyMcpMutation(
      sessionId,
      runtime,
      'add',
      () => runtime.addMcpServer!(params),
      MCP_ADD_FAILED_MESSAGE,
    );
  }

  private handleMcpServerRemove(sessionId: string, name: string): void {
    const runtime = this.runtime;
    const dropReason = this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.reportDroppedMcpMutation(
        'mcp.server.remove',
        sessionId,
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (
      typeof runtime.removeMcpServer !== 'function' ||
      typeof runtime.listMcpServers !== 'function'
    ) {
      this.emitMcp(sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }
    this.applyMcpMutation(
      sessionId,
      runtime,
      'remove',
      () => runtime.removeMcpServer!(name),
      MCP_REMOVE_FAILED_MESSAGE,
    );
  }

  /**
   * Logs a dropped MCP mutation and, when the request came from the
   * panel the user is looking at, surfaces a visible retry hint. A
   * dropped Add/Remove/Toggle must never look like a success.
   */
  private reportDroppedMcpMutation(
    op: string,
    sessionId: string,
    reason: string,
  ): void {
    this.recordDroppedPanelRequest(op, reason);
    if (reason !== 'session-mismatch' && sessionId === this.sessionId) {
      this.emitMcp(sessionId, {
        status: 'error',
        items: [],
        message: MCP_REQUEST_DROPPED_MESSAGE,
      });
    }
  }

  /**
   * Runs one MCP catalog mutation, then re-reads and broadcasts the
   * catalog. The caller must have verified `listMcpServers` support.
   * Failures still re-read the catalog: the mutation may have half
   * landed (Droid writes config before connecting), so the fresh
   * status badges are the trustworthy signal and the error message
   * rides along instead of blanking the list.
   */
  private applyMcpMutation(
    sessionId: string,
    runtime: DroidRuntime,
    op: string,
    mutation: () => Promise<void>,
    failureMessage: string,
  ): void {
    this.emitMcp(sessionId, { status: 'loading', items: [] });
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd!;
    void mutation().then(
      () =>
        this.finishMcpMutation(
          sessionId,
          runtime,
          generation,
          cwd,
          null,
        ),
      (error) => {
        this.recordPanelFailure(
          `mcp-${op}-failed`,
          formatUnknownError(error),
        );
        return this.finishMcpMutation(
          sessionId,
          runtime,
          generation,
          cwd,
          failureMessage,
        );
      },
    );
  }

  /** Re-reads the MCP catalog after a mutation attempt and broadcasts
   * it, attaching `failureMessage` when the mutation failed. */
  private async finishMcpMutation(
    sessionId: string,
    runtime: DroidRuntime,
    generation: number,
    cwd: string,
    failureMessage: string | null,
  ): Promise<void> {
    let items: McpServerSummary[] | null = null;
    try {
      items = (await runtime.listMcpServers!()).map(
        projectMcpServerSummary,
      );
    } catch (error) {
      this.recordPanelFailure(
        'mcp-load-failed',
        formatUnknownError(error),
      );
    }
    if (
      !this.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
    ) {
      return;
    }
    if (items === null) {
      // The webview store keeps the previous list on error states, so
      // an empty error payload degrades to "old list + message".
      this.emitMcp(sessionId, {
        status: 'error',
        items: [],
        message: failureMessage ?? MCP_LOAD_FAILED_MESSAGE,
      });
      return;
    }
    this.emitMcp(
      sessionId,
      failureMessage === null
        ? { status: 'ready', items }
        : { status: 'error', items, message: failureMessage },
    );
  }

  private handleMcpServerAuthenticate(
    sessionId: string,
    name: string,
  ): void {
    const runtime = this.runtime;
    const dropReason =
      this.mcpAuthServerName !== null
        ? 'auth-in-flight'
        : this.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      this.recordDroppedPanelRequest(
        'mcp.server.authenticate',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (typeof runtime.authenticateMcpServer !== 'function') {
      this.recordPanelFailure(
        'mcp-auth-unsupported',
        MCP_AUTH_UNSUPPORTED_MESSAGE,
      );
      this.emitMcpAuth(
        sessionId,
        name,
        'error',
        MCP_AUTH_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    this.mcpAuthServerName = name;
    this.recordHost({
      level: 'info',
      name: 'host.mcp.auth',
      attributes: { phase: 'started', serverName: name },
    });
    this.emitMcpAuth(sessionId, name, 'started', null);
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd!;
    const isCurrentFlow = () =>
      this.mcpAuthServerName === name &&
      this.isCurrentSessionOperation(runtime, generation, sessionId, cwd);
    const finishFlow = () => {
      if (this.mcpAuthTimer !== null) {
        clearTimeout(this.mcpAuthTimer);
        this.mcpAuthTimer = null;
      }
      this.mcpAuthServerName = null;
    };
    this.mcpAuthTimer = setTimeout(() => {
      if (this.mcpAuthServerName !== name) {
        return;
      }
      finishFlow();
      this.recordPanelFailure(
        'mcp-auth-timeout',
        `${name}: ${MCP_AUTH_TIMEOUT_MESSAGE}`,
      );
      if (
        this.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
      ) {
        this.emitMcpAuth(
          sessionId,
          name,
          'error',
          MCP_AUTH_TIMEOUT_MESSAGE,
        );
      }
    }, MCP_AUTH_WAIT_TIMEOUT_MS);

    void runtime
      .authenticateMcpServer(name, (outcome) => {
        if (this.mcpAuthServerName !== name) {
          return;
        }
        const current = this.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        );
        finishFlow();
        this.recordHost({
          level: outcome === 'success' ? 'info' : 'warn',
          name: 'host.mcp.auth',
          attributes: { phase: outcome, serverName: name },
        });
        if (!current) {
          return;
        }
        this.emitMcpAuth(sessionId, name, outcome, null);
        if (outcome === 'success') {
          this.handleMcpRefresh(sessionId);
        }
      })
      .then(
        async ({ authUrl }) => {
          if (!isCurrentFlow()) {
            return;
          }
          if (authUrl === null) {
            // Droid accepted the request but never announced an OAuth
            // URL - typical for a server that is already signed in.
            // End the flow now instead of waiting minutes for a
            // completion notification that will not arrive.
            finishFlow();
            this.recordPanelFailure(
              'mcp-auth-no-url',
              `${name}: ${MCP_AUTH_NO_URL_MESSAGE}`,
            );
            this.emitMcpAuth(
              sessionId,
              name,
              'error',
              MCP_AUTH_NO_URL_MESSAGE,
            );
            this.handleMcpRefresh(sessionId);
            return;
          }
          const opened = await this.externalUrl.openExternal(authUrl);
          if (!isCurrentFlow()) {
            return;
          }
          this.recordHost({
            level: opened ? 'info' : 'warn',
            name: 'host.mcp.auth',
            attributes: {
              phase: opened ? 'browser-opened' : 'browser-failed',
              serverName: name,
            },
          });
          this.emitMcpAuth(
            sessionId,
            name,
            'browser',
            opened
              ? MCP_AUTH_BROWSER_MESSAGE
              : MCP_AUTH_BROWSER_FAILED_MESSAGE,
          );
        },
        () => {
          if (this.mcpAuthServerName !== name) {
            return;
          }
          const current = this.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          );
          finishFlow();
          this.recordPanelFailure(
            'mcp-auth-start-failed',
            `${name}: ${MCP_AUTH_START_FAILED_MESSAGE}`,
          );
          if (current) {
            this.emitMcpAuth(
              sessionId,
              name,
              'error',
              MCP_AUTH_START_FAILED_MESSAGE,
            );
          }
        },
      );
  }

  private emitMcpAuth(
    sessionId: string,
    serverName: string,
    phase: McpAuthPhase,
    message: string | null,
  ): void {
    this.emit({
      type: 'mcp.auth',
      sessionId,
      serverName,
      phase,
      message,
    });
  }

  private emitMcp(sessionId: string, mcp: SessionMcpState): void {
    this.emit({
      type: 'session.mcp',
      sessionId,
      mcp,
    });
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

  private emitAttachments(): void {
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
    }
    this.emitSnapshot();
  }

  private canReplaceSession(): boolean {
    if (
      isTurnActive(this.turn) ||
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
        await this.closeRuntime(previousRuntime);
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
    }
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
        this.emitModelCatalog(sessionId);
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
        this.emitModelCatalog(sessionId);
      });

    this.refreshContext(runtime, generation, sessionId, cwd);
    // Server-side backstop for the skills/MCP panels: a session switch
    // resets the webview catalogs to 'idle', and a panel-issued
    // re-request can be dropped mid-switch. Pushing fresh state on
    // activation converges an open panel without user action.
    this.pushSkills(runtime, generation, sessionId, cwd);
    this.pushMcp(runtime, generation, sessionId, cwd);
  }

  private refreshContext(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    const request = ++this.contextGeneration;
    const confirmed =
      this.context.status === 'ready' ||
      this.context.status === 'error'
        ? this.context.value
        : null;
    this.context = { status: 'loading', value: confirmed };
    this.emitContext(sessionId);
    void runtime
      .readContextStats()
      .then((result) => {
        if (
          request !== this.contextGeneration ||
          !this.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        this.context = {
          status: 'ready',
          value: projectContextStats(result),
        };
        this.emitContext(sessionId);
      })
      .catch(() => {
        if (
          request !== this.contextGeneration ||
          !this.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        this.context = {
          status: 'error',
          value: confirmed,
          message: CONTEXT_READ_FAILED_MESSAGE,
        };
        this.emitContext(sessionId);
      });
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

  private emitSnapshot(): void {
    if (this.turn === null) {
      // Invariant: an open turn scope always corresponds to the live
      // turn. Session adoption paths clear the turn without a terminal
      // turn.state, so close the scope here.
      this.diagnostics?.endTurnScope?.();
    }
    const sessions = this.withActiveSession(this.sessions);
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
        : { queue: this.projectQueueState() }),
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
      this.settleQueueAfterTurn(sessionId, status);
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

  private recordHost(event: RuntimeDiagnosticEvent): void {
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

  private emitContext(sessionId: string): void {
    this.emit({
      type: 'session.context',
      sessionId,
      context: this.context,
    });
  }

  private updateTokenUsage(
    sessionId: string,
    update: Partial<{
      cumulative: TokenUsageBreakdown;
      lastTurn: TokenUsageBreakdown;
    }>,
  ): void {
    if (this.sessionId !== sessionId) {
      return;
    }
    this.tokenUsage = { ...this.tokenUsage, ...update };
    this.emit({
      type: 'session.tokenUsage',
      sessionId,
      tokenUsage: this.tokenUsage,
    });
  }

  private emitModelCatalog(sessionId: string): void {
    this.emit({
      type: 'session.model-catalog',
      sessionId,
      modelCatalog: this.modelCatalog,
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
        summaries === null ||
        this.disposed ||
        this.sessionId !== sessionId ||
        turn?.turnId !== turnId
      ) {
        return;
      }
      const result = reconcileSubagentSummaries(
        turn.activity,
        summaries,
      );
      turn.activity = result.state;
      for (const projection of result.projections) {
        this.emit({
          type: 'tool.activity',
          sessionId,
          turnId,
          ...projection,
        });
      }
    });
  }

  private refreshContextAfterTurn(sessionId: string): void {
    if (
      this.runtime !== null &&
      this.activeRuntimeCwd !== null &&
      this.sessionId === sessionId &&
      this.connection.status === 'connected'
    ) {
      this.refreshContext(
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

  private emit(
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
  private sessionRequestDropReason(sessionId: string): string | null {
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
  private recordDroppedPanelRequest(op: string, reason: string): void {
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
  private recordPanelFailure(code: string, detail: string): void {
    this.recordHost({
      level: 'warn',
      name: 'host.ui.diagnostic',
      attributes: { code },
      detail,
    });
  }

  private emitSessionDiagnostic(
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

  private closeRuntime(runtime: DroidRuntime): Promise<void> {
    if (this.closedRuntimes.has(runtime)) {
      return Promise.resolve();
    }
    const existing = this.runtimeClosures.get(runtime);
    if (existing) {
      return existing;
    }
    const closure = Promise.resolve()
      .then(() => runtime.dispose())
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

  private isCurrentSessionOperation(
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
    this.discardQueuedPrompts();
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

  private ensureActiveRuntimeWorkspaceCurrent(): boolean {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTurnActive(turn: CurrentTurn | null): boolean {
  return (
    turn?.status === 'submitting' ||
    turn?.status === 'streaming' ||
    turn?.status === 'stopping'
  );
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

/**
 * Maps daemon-path failures to fixed user-facing messages. Raw error
 * text never crosses to the Bridge: SDK errors may embed payloads.
 */
function daemonFailureMessage(
  error: unknown,
  fallback: string,
  notLoggedIn: string = DAEMON_NOT_LOGGED_IN_MESSAGE,
): string {
  if (error instanceof DaemonAvailabilityError) {
    return error.reason === 'not-logged-in'
      ? notLoggedIn
      : DAEMON_UNAVAILABLE_MESSAGE;
  }
  return fallback;
}

function isSameWorkspaceContext(
  left: WorkspaceContext,
  right: WorkspaceContext,
): boolean {
  return left.cwd === right.cwd && left.trusted === right.trusted;
}

function isTranscriptProjection(
  message: HostToWebviewMessage,
): message is HostTranscriptProjectionMessage {
  return (
    message.type === 'assistant.delta' ||
    message.type === 'thinking.delta' ||
    message.type === 'thinking.complete' ||
    message.type === 'tool.activity' ||
    message.type === 'transcript.image' ||
    message.type === 'runtime.diagnostic' ||
    message.type === 'turn.state'
  );
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

function projectContextStats(
  context: RuntimeContextStats,
): SessionContextStats {
  if (
    !isSafeContextNumber(context.used) ||
    !isSafeContextNumber(context.remaining) ||
    !isSafeContextNumber(context.limit) ||
    (context.accuracy !== 'exact' &&
      context.accuracy !== 'estimated')
  ) {
    throw new Error('Invalid runtime context statistics.');
  }
  return {
    used: context.used,
    remaining: context.remaining,
    limit: context.limit,
    accuracy: context.accuracy,
  };
}

function projectModelCatalog(
  catalog: RuntimeModelCatalog,
): ModelCatalogState {
  if (catalog.status === 'unavailable') {
    return {
      status: 'unsupported',
      items: [],
      message: MODEL_CATALOG_UNSUPPORTED_MESSAGE,
    };
  }
  if (
    catalog.status !== 'available' ||
    !Array.isArray(catalog.items) ||
    catalog.items.length > MAX_MODEL_CATALOG_ITEMS
  ) {
    throw new Error('Invalid runtime model catalog.');
  }

  const ids = new Set<string>();
  const items = catalog.items.map((item: RuntimeModelCatalogItem) => {
    if (
      !isSafeModelId(item.id) ||
      ids.has(item.id) ||
      !isSafeDisplayName(item.displayName) ||
      !Array.isArray(item.supportedReasoningEfforts) ||
      item.supportedReasoningEfforts.length === 0 ||
      item.supportedReasoningEfforts.length >
        SESSION_REASONING_EFFORTS.length
    ) {
      throw new Error('Invalid runtime model catalog item.');
    }
    const efforts = new Set(item.supportedReasoningEfforts);
    if (
      efforts.size !== item.supportedReasoningEfforts.length ||
      item.supportedReasoningEfforts.some(
        (effort) =>
          !isEnumValue(effort, SESSION_REASONING_EFFORTS),
      )
    ) {
      throw new Error('Invalid runtime model reasoning efforts.');
    }
    ids.add(item.id);
    return {
      id: item.id,
      displayName: item.displayName,
      supportedReasoningEfforts: [...item.supportedReasoningEfforts],
    };
  });
  return { status: 'ready', items };
}

function projectSkillSummary(skill: RuntimeSkill): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.location,
    enabled: skill.enabled,
    userInvocable: skill.userInvocable,
  };
}

/**
 * Projects daemon plugin rows into bounded Bridge summaries. Rows
 * that violate the contract — oversized or control-character ids,
 * duplicate ids, or a scope outside the user/project whitelist — are
 * dropped (fail closed) rather than displayed with invented values.
 */
function projectPluginSummaries(
  entries: readonly InstalledPluginEntry[],
): PluginSummary[] {
  const items: PluginSummary[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      items.length >= MAX_PLUGIN_ITEMS ||
      entry.id.length === 0 ||
      entry.id.length > MAX_PLUGIN_ID_LENGTH ||
      /[\u0000-\u001f\u007f-\u009f]/.test(entry.id) ||
      ids.has(entry.id) ||
      !isPluginScope(entry.scope)
    ) {
      continue;
    }
    ids.add(entry.id);
    items.push({
      id: entry.id,
      scope: entry.scope,
      version: entry.version
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, '')
        .slice(0, MAX_PLUGIN_VERSION_LENGTH),
      active: entry.active,
    });
  }
  return items;
}

function isPluginScope(value: string): value is PluginScope {
  return (PLUGIN_SCOPES as readonly string[]).includes(value);
}

function projectCommandSummary(command: RuntimeCommand): CommandSummary {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    isExecutable: command.isExecutable,
  };
}

function projectMcpServerSummary(
  server: RuntimeMcpServer,
): McpServerSummary {
  return {
    name: server.name,
    status: server.status,
    toolCount: server.toolCount,
    requiresAuth: server.requiresAuth,
    hasAuthTokens: server.hasAuthTokens,
    tools: server.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      readOnly: tool.readOnly,
    })),
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

function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MODEL_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function isSafeDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MODEL_DISPLAY_NAME_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function isEnumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}

function isSafeContextNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function forkTitleFromText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= MAX_FORK_TITLE_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_FORK_TITLE_LENGTH - 1)}…`;
}

function isSafeBridgeId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function createEmptySessionCatalog(): SessionCatalog {
  return {
    async listSessions() {
      return { status: 'available', sessions: [] };
    },
  };
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function createTransientRecoveryStore(): SessionRecoveryStore {
  const values = new Map<string, unknown>();
  const persistence: SessionRecoveryPersistence = {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
  return new SessionRecoveryStore(persistence);
}
