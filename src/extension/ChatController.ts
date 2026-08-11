import type {
  AttachmentKind,
  AttachmentSummary,
  ConnectionState,
  ConfirmedSessionSettings,
  HostToWebviewMessage,
  ModelCatalogState,
  SessionCatalogState,
  SessionContextState,
  SessionContextStats,
  McpServerSummary,
  SessionMcpState,
  SessionSettingUpdateMessage,
  SessionSettingsState,
  SessionSkillsState,
  SessionSummary,
  SkillSummary,
  TurnStatus,
  WebviewToHostMessage,
} from '../shared/bridgeMessages';
import {
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_MODEL_CATALOG_ITEMS,
  MAX_PENDING_ATTACHMENTS,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_SESSION_CATALOG_ITEMS as SESSION_CATALOG_LIMIT,
  MAX_SESSION_TITLE_LENGTH as SESSION_TITLE_LIMIT,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
} from '../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeAttachment,
  RuntimeContextStats,
  RuntimeModelCatalog,
  RuntimeModelCatalogItem,
  RuntimeSessionSettings,
  RuntimeMcpServer,
  RuntimeSessionSettingUpdate,
  RuntimeSessionTarget,
  RuntimeSkill,
} from '../runtime/DroidRuntime';
import type {
  RuntimeAvailability,
  RuntimeEvent,
} from '../runtime/runtimeEvents';
import type { RuntimeInteractionHandler } from '../runtime/runtimeInteractions';
import type {
  SessionCatalog,
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../runtime/SessionCatalog';
import {
  createUnavailableSessionHistoryLoader,
  type SessionHistoryLoader,
} from '../runtime/history/SessionHistory';
import {
  createTurnActivityState,
  projectAssistantDelta,
  projectThinkingDelta,
  projectToolEvent,
  type TurnActivityState,
} from './turnActivityState';
import { PendingInteractionCoordinator } from './pendingInteractionCoordinator';
import {
  SESSION_RECOVERY_DEBOUNCE_MS,
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import {
  appendAcceptedUserPrompt,
  attachUserMessageId,
  createHostTranscriptState,
  projectHostTranscriptMessage,
  truncateFromUserMessage,
  type HostTranscriptProjectionMessage,
  type HostTranscriptState,
} from './hostTranscriptState';
import { reconcileSessionHistory } from './reconcileSessionHistory';
import {
  createUnavailableAttachmentSources,
  type AttachmentPayload,
  type AttachmentSources,
} from './attachmentSources';
import {
  createUnavailableFileDiffOpener,
  type FileDiffOpener,
} from './fileDiffOpener';

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
}

interface PendingAttachment {
  readonly summary: AttachmentSummary;
  readonly runtime: RuntimeAttachment;
}

interface DisposableSubscription {
  dispose(): void;
}

const TURN_FAILURE_MESSAGE =
  'Droid could not complete this turn. Retry to start a fresh session.';
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
const SKILLS_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose skills.';
const SKILLS_LOAD_FAILED_MESSAGE =
  'Droid did not return the skill list. Retry from the skills panel.';
const SKILL_TOGGLE_FAILED_MESSAGE =
  'Droid could not update that skill. The list may be stale; refresh it.';
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
const FILE_DIFF_FAILED_MESSAGE =
  'That file could not be opened. It may have been moved or deleted.';
const MCP_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose MCP servers.';
const MCP_LOAD_FAILED_MESSAGE =
  'Droid did not return the MCP catalog. Retry from the MCP panel.';
const MCP_TOGGLE_FAILED_MESSAGE =
  'Droid could not update that MCP server. The list may be stale; refresh it.';
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
const ATTACHMENT_NO_EDITOR_MESSAGE =
  'Open a text editor first to attach its contents.';
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
  private activeRuntimeCwd: string | null = null;
  private initialization: Promise<void> | null = null;
  private workspaceContext: WorkspaceContext;
  private workspaceContextGeneration = 0;
  private workspaceTransition: Promise<void> | null = null;
  private sessionOperationInProgress = false;
  private refreshInProgress = false;
  private pendingAttachments: PendingAttachment[] = [];
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
  ) {
    this.workspaceContext = {
      ...this.getWorkspaceContext(),
    };
    this.interactions = new PendingInteractionCoordinator(
      ({ sessionId, turnId, request }) => {
        if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
          return;
        }
        this.emit({
          type: 'interaction.request',
          sessionId,
          turnId,
          request,
        });
      },
      ({ sessionId, turnId, requestId }) => {
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
        );
        return;
      case 'runtime.retry':
        this.handleRetry(message.sessionId);
        return;
      case 'permission.respond':
        if (!this.ensureActiveRuntimeWorkspaceCurrent()) {
          return;
        }
        this.interactions.respondPermission(message);
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
      case 'session.rename':
        this.handleSessionRename(message.sessionId, message.title);
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
      case 'file.openDiff':
        this.handleFileOpenDiff(message.sessionId, message.path);
        return;
      case 'skills.refresh':
        this.handleSkillsRefresh(message.sessionId);
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
      case 'attachment.pick':
        this.handleAttachmentPick(message.sessionId);
        return;
      case 'attachment.addEditor':
        this.handleAttachmentCapture(message.sessionId, 'editor');
        return;
      case 'attachment.addSelection':
        this.handleAttachmentCapture(message.sessionId, 'selection');
        return;
      case 'attachment.remove':
        this.handleAttachmentRemove(
          message.sessionId,
          message.attachmentId,
        );
        return;
      case 'session.setting.update':
        this.handleSettingUpdate(message);
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
      const [, catalog] = await Promise.all([
        recoveryLoaded
          ? Promise.resolve()
          : this.recoveryStore.load(),
        this.loadCatalog(workspace.cwd),
      ]);
      recoveryLoaded = true;
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

  private handleSend(
    sessionId: string,
    turnId: string,
    text: string,
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
    this.turn = {
      turnId,
      status: 'submitting',
      activity: createTurnActivityState(),
    };
    this.interactions.beginTurn(sessionId, turnId);
    this.transcript = appendAcceptedUserPrompt(
      this.transcript,
      turnId,
      text,
    );
    this.scheduleRecoveryCheckpoint();
    this.touchActiveSession();
    this.emitTurnState(sessionId, turnId, 'submitting');
    void this.consumeTurn(
      runtime,
      runtimeGeneration,
      turnGeneration,
      sessionId,
      turnId,
      text,
      this.takePendingRuntimeAttachments(),
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
      case 'thinking-complete':
        this.emit({
          type: 'thinking.complete',
          sessionId,
          turnId,
          durationMs: event.durationMs,
        });
        return;
      case 'tool-start':
      case 'tool-progress':
      case 'tool-result': {
        this.startStreaming(sessionId, turnId);
        const turn = this.turn;
        if (turn === null) {
          return;
        }
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
      case 'user-message':
        this.transcript = attachUserMessageId(
          this.transcript,
          turnId,
          event.messageId,
        );
        this.scheduleRecoveryCheckpoint();
        this.emit({
          type: 'user.message-meta',
          sessionId,
          turnId,
          messageId: event.messageId,
        });
        return;
      case 'working-state':
        if (event.isWorking) {
          this.startStreaming(sessionId, turnId);
        }
        return;
      case 'settings-updated':
        this.refreshSettingsAfterRuntimeEvent(sessionId);
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

  private handleTurnComplete(
    sessionId: string,
    turnId: string,
    event: Extract<RuntimeEvent, { type: 'turn-complete' }>,
  ): void {
    this.interactions.endTurn(sessionId, turnId);
    switch (event.outcome) {
      case 'success':
        this.setTurnStatus(sessionId, turnId, 'completed');
        void this.flushRecoveryCheckpoint();
        this.refreshContextAfterTurn(sessionId);
        return;
      case 'interrupted':
        this.setTurnStatus(sessionId, turnId, 'interrupted');
        void this.flushRecoveryCheckpoint();
        this.refreshContextAfterTurn(sessionId);
        return;
      case 'error_during_execution':
        this.failTurn(sessionId, turnId, 'runtime-execution-failed');
        return;
      case 'error_structured_output':
        this.failTurn(sessionId, turnId, 'runtime-structured-output-failed');
        return;
    }
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

    this.interactions.endTurn(sessionId, turnId);
    this.setTurnStatus(sessionId, turnId, 'stopping');
    const runtimeGeneration = this.runtimeGeneration;
    const turnGeneration = this.turnGeneration;
    void runtime.interrupt().catch(() => {
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

  private handleEditResend(
    sessionId: string,
    turnId: string,
    messageId: string,
    text: string,
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
      return;
    }
    if (typeof runtime.rewind !== 'function') {
      this.emitSessionDiagnostic(
        'edit-resend-unsupported',
        EDIT_RESEND_UNSUPPORTED_MESSAGE,
      );
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
      return;
    }

    this.sessionOperationInProgress = true;
    void this.performEditResend(
      runtime,
      sessionId,
      messageId,
      text,
      truncated,
    ).then((forkedSessionId) => {
      this.sessionOperationInProgress = false;
      if (forkedSessionId === null) {
        return;
      }
      // Send first, then snapshot: the single snapshot then carries the
      // forked session id, the truncated transcript with the edited
      // prompt, and the submitting turn, so the webview adopts the fork
      // atomically.
      this.handleSend(forkedSessionId, turnId, text);
      this.emitSnapshot();
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
    // The continuation session supersedes the compacted one, so the
    // superseded entry leaves the catalog instead of lingering as a
    // second row.
    this.sessions = {
      ...this.sessions,
      items: this.sessions.items.filter(({ id }) => id !== sessionId),
    };
    this.sessionId = compactedSessionId;
    this.turn = null;
    this.clearPendingAttachments();
    this.sessions = this.withActiveSession(this.sessions, {
      id: compactedSessionId,
      title: previousTitle,
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
    });

    let transcript: HostTranscriptState | null = null;
    try {
      const loaded = await this.sessionHistory.loadHistory({
        cwd,
        sessionId: compactedSessionId,
      });
      if (loaded.status === 'available') {
        transcript = loaded.state;
      }
    } catch {
      transcript = null;
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
    });

    // The fork copies the conversation, but message IDs may differ, so
    // reload its history; keep the current transcript if that fails.
    let transcript: HostTranscriptState | null = null;
    try {
      const loaded = await this.sessionHistory.loadHistory({
        cwd,
        sessionId: forkedSessionId,
      });
      if (loaded.status === 'available') {
        transcript = loaded.state;
      }
    } catch {
      transcript = null;
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
    if (
      sessionId !== this.sessionId ||
      runtime === null ||
      this.connection.status !== 'connected' ||
      this.sessionOperationInProgress ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
      return;
    }
    if (typeof runtime.listSkills !== 'function') {
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
    if (
      sessionId !== this.sessionId ||
      runtime === null ||
      this.connection.status !== 'connected' ||
      this.sessionOperationInProgress ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
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

  private handleMcpRefresh(sessionId: string): void {
    const runtime = this.runtime;
    if (
      sessionId !== this.sessionId ||
      runtime === null ||
      this.connection.status !== 'connected' ||
      this.sessionOperationInProgress ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
      return;
    }
    if (typeof runtime.listMcpServers !== 'function') {
      this.emitMcp(sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    this.emitMcp(sessionId, { status: 'loading', items: [] });
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd!;
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
    if (
      sessionId !== this.sessionId ||
      runtime === null ||
      this.connection.status !== 'connected' ||
      this.sessionOperationInProgress ||
      !this.ensureActiveRuntimeWorkspaceCurrent()
    ) {
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

    this.emitMcp(sessionId, { status: 'loading', items: [] });
    const generation = this.runtimeGeneration;
    const cwd = this.activeRuntimeCwd!;
    void runtime
      .setMcpServerEnabled(name, enabled)
      .then(() => runtime.listMcpServers!())
      .then(
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
          this.emitMcp(sessionId, {
            status: 'error',
            items: [],
            message: MCP_TOGGLE_FAILED_MESSAGE,
          });
        },
      );
  }

  private emitMcp(sessionId: string, mcp: SessionMcpState): void {
    this.emit({
      type: 'session.mcp',
      sessionId,
      mcp,
    });
  }

  private canStageAttachments(sessionId: string): boolean {
    return (
      sessionId === this.sessionId &&
      this.runtime !== null &&
      this.connection.status === 'connected' &&
      !this.attachmentOperationInProgress &&
      this.ensureActiveRuntimeWorkspaceCurrent()
    );
  }

  private handleAttachmentPick(sessionId: string): void {
    if (!this.canStageAttachments(sessionId)) {
      return;
    }
    const remaining =
      MAX_PENDING_ATTACHMENTS - this.pendingAttachments.length;
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
            this.stageAttachmentPayloads(outcome.items);
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
    capture: 'editor' | 'selection',
  ): void {
    if (!this.canStageAttachments(sessionId)) {
      return;
    }
    if (this.pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
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
        : this.attachmentSources.readActiveSelection();
    void read.then(
      (outcome) => {
        this.attachmentOperationInProgress = false;
        if (sessionId !== this.sessionId) {
          return;
        }
        switch (outcome.status) {
          case 'captured':
            this.stageAttachmentPayloads([outcome.item], capture);
            return;
          case 'empty':
            this.emitSessionDiagnostic(
              'attachment-empty',
              capture === 'editor'
                ? ATTACHMENT_NO_EDITOR_MESSAGE
                : ATTACHMENT_NO_SELECTION_MESSAGE,
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

  private handleAttachmentRemove(
    sessionId: string,
    attachmentId: string,
  ): void {
    if (sessionId !== this.sessionId) {
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
  ): void {
    let staged = 0;
    for (const payload of payloads) {
      if (this.pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
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
      this.pendingAttachments = [
        ...this.pendingAttachments,
        {
          summary: {
            id: `attachment-${this.attachmentIdCounter}`,
            kind,
            name: boundAttachmentName(payload.name),
            sizeBytes: payload.sizeBytes,
            truncated: payload.truncated,
          },
          runtime,
        },
      ];
      staged += 1;
    }
    if (staged > 0) {
      this.emitAttachments();
    }
  }

  private takePendingRuntimeAttachments():
    | readonly RuntimeAttachment[]
    | undefined {
    if (this.pendingAttachments.length === 0) {
      return undefined;
    }
    const attachments = this.pendingAttachments.map(
      ({ runtime }) => runtime,
    );
    this.pendingAttachments = [];
    this.emitAttachments();
    return attachments;
  }

  private clearPendingAttachments(): void {
    this.pendingAttachments = [];
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
    const settings = this.settings.value;
    if (
      this.modelCatalog.status !== 'ready' ||
      settings === null
    ) {
      return false;
    }
    if (message.field === 'modelId') {
      return this.modelCatalog.items.some(
        ({ id }) => id === message.value,
      );
    }
    const model = this.modelCatalog.items.find(
      ({ id }) => id === settings.modelId,
    );
    return (
      model?.supportedReasoningEfforts.includes(message.value) ?? false
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

    const transcript = await this.prepareActivationTranscript(
      target,
      generation,
    );
    if (transcript === null) {
      if (
        this.isCurrentRuntimeGeneration(generation) &&
        !this.isTargetWorkspaceCurrent(target.cwd)
      ) {
        this.reportWorkspaceChanged(generation);
      }
      return;
    }
    if (
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      if (this.isCurrentRuntimeGeneration(generation)) {
        this.reportWorkspaceChanged(generation);
      }
      return;
    }
    const activation = await this.createInitializedRuntime(
      target,
      generation,
    );
    if (
      !activation ||
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      if (
        this.isCurrentRuntimeGeneration(generation) &&
        !this.isTargetWorkspaceCurrent(target.cwd)
      ) {
        this.reportWorkspaceChanged(generation);
      }
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
  }

  private async activateInitialRuntime(
    target: RuntimeSessionTarget,
    failedResumeId: string | null,
  ): Promise<void> {
    const generation = ++this.runtimeGeneration;
    const transcript = await this.prepareActivationTranscript(
      target,
      generation,
    );
    if (transcript === null) {
      return;
    }
    if (
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      return;
    }
    const activation = await this.createInitializedRuntime(
      target,
      generation,
    );
    if (
      !activation ||
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
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
      return createHostTranscriptState('complete');
    }

    const recovered = this.recoveryStore.readSession(target.sessionId);
    let loaded;
    try {
      loaded = await this.sessionHistory.loadHistory({
        cwd: target.cwd,
        sessionId: target.sessionId,
      });
    } catch {
      loaded = null;
    }
    if (
      !this.isCurrentRuntimeGeneration(generation) ||
      !this.isTargetWorkspaceCurrent(target.cwd)
    ) {
      return null;
    }
    if (loaded?.status === 'available') {
      return reconcileSessionHistory(loaded.state, recovered);
    }
    return recovered ?? createHostTranscriptState('unavailable');
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

    let availability: RuntimeAvailability;
    try {
      availability = await runtime.initialize(target);
    } catch {
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
      await this.closeRuntime(runtime).catch(() => undefined);
      return null;
    }
    if (
      availability.status === 'unavailable' ||
      !isSafeBridgeId(availability.sessionId) ||
      (target.kind === 'resume' &&
        availability.sessionId !== target.sessionId)
    ) {
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
          }
        : undefined,
    );
    this.connection = { status: 'connected' };
    this.recoveryStore.selectSession(sessionId);
    void this.recoveryStore.flush();
    this.emitSnapshot();
    this.loadSessionMetadata(
      runtime,
      generation,
      sessionId,
      target.cwd,
    );
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
    return {
      status: 'ready',
      items: projectCatalogEntries(result.sessions),
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

    this.interactions.endTurn(sessionId, turnId);
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
    const sessions = this.withActiveSession(this.sessions);
    this.emit({
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
    });
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

  private emitModelCatalog(sessionId: string): void {
    this.emit({
      type: 'session.model-catalog',
      sessionId,
      modelCatalog: this.modelCatalog,
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
    this.projectTranscript(withSequence);
    for (const listener of this.listeners) {
      listener(withSequence);
    }
  }

  private projectTranscript(message: HostToWebviewMessage): void {
    if (
      this.sessionId === null ||
      message.sessionId !== this.sessionId ||
      !isTranscriptProjection(message)
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

  private emitSessionDiagnostic(
    code: string,
    message: string,
  ): void {
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
    this.settingsUpdate = null;
    this.settings = { status: 'loading', value: null };
    this.context = { status: 'loading', value: null };
    this.modelCatalog = { status: 'loading', items: [] };
    this.clearPendingAttachments();
  }

  private isCurrentRuntimeGeneration(generation: number): boolean {
    return !this.disposed && this.runtimeGeneration === generation;
  }

  private beginCatalogLoad(cwd: string): number {
    const generation = ++this.catalogGeneration;
    this.catalogCwd = cwd;
    this.sessions = { status: 'loading', items: [] };
    return generation;
  }

  private bindCatalogViewToWorkspace(cwd: string): void {
    if (this.catalogCwd === cwd) {
      return;
    }
    this.catalogGeneration += 1;
    this.catalogCwd = cwd;
    this.sessions = { status: 'idle', items: [] };
  }

  private clearCatalog(): void {
    this.catalogGeneration += 1;
    this.catalogCwd = null;
    this.sessions = { status: 'idle', items: [] };
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
    !isEnumValue(settings.autonomyLevel, SESSION_AUTONOMY_LEVELS)
  ) {
    throw new Error('Invalid runtime session settings.');
  }
  return {
    interactionMode: settings.interactionMode,
    modelId: settings.modelId,
    reasoningEffort: settings.reasoningEffort,
    autonomyLevel: settings.autonomyLevel,
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

function projectMcpServerSummary(
  server: RuntimeMcpServer,
): McpServerSummary {
  return {
    name: server.name,
    status: server.status,
    toolCount: server.toolCount,
    requiresAuth: server.requiresAuth,
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
