import {
  MAX_IMAGES_PER_TURN, MAX_TOOL_ACTIVITIES_PER_TURN,
  type AttachmentSummary, type EditAttachmentSummary, type EditResendRejectReason,
  type HostToWebviewMessage, type McpAuthPhase,
  type GitBranchDiffState, type ModelCatalogState, type RewindFileImpact,
  type SessionArchivedState, type SessionCommandsState,
  type SessionContextState, type SessionMcpState, type SessionMissionSummary,
  type SessionPluginsState, type SessionSearchState, type SessionSettingsState,
  type SessionSkillsState, type SessionTranscriptItem, type TurnStatus,
  type WorkspaceFilesStatus, type ImageMediaType, type WorkspaceImageStatus,
} from '../../shared/bridgeMessages';
import type { MissionControlResultMessage, MissionSnapshotMessage } from '../../shared/missionProtocol';
import { EMPTY_SESSION_QUEUE_STATE, MAX_QUEUED_MESSAGES, type SessionQueueState } from '../../shared/queueProtocol';
import { enforceTranscriptImageBudget, trimTranscriptToLimits } from '../../shared/transcriptLimits';
import { stableTranscriptId } from '../../shared/hostTranscriptState';
import { EMPTY_SESSION_BTW_STATE, type SessionBtwState } from '../../shared/btwProtocol';
import { EMPTY_REVIEW_UI_STATE, reduceReviewUiMessage, type ReviewUiState } from './reviewStore';
import { EMPTY_SESSION_TOKEN_USAGE, type SessionTokenUsageState } from '../../shared/tokenUsage';
import { isTransientRuntimeDiagnostic } from '../../shared/transientDiagnostics';
import { initialGitCommitFlowState, type GitCommitFlowState } from './gitCommitStore';
import {
  reduceInteractionClosed,
  reducePlanDocumentState,
  type PendingInteraction,
} from './interactionStore';
import {
  reduceAttachmentMessage,
  type AttachmentImageEntry,
} from './attachmentImageStore';
export type { AttachmentImageEntry } from './attachmentImageStore';

export { initialGitCommitFlowState } from './gitCommitStore';
export type {
  GitAvailability,
  GitCommitFlowState,
  GitCommitResultState,
} from './gitCommitStore';

export interface AssistantTurn {
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly activity?: 'working' | 'responding';
  readonly error?: string;
}

export type { PendingInteraction } from './interactionStore';
/** One resolved markdown image reference. */
export interface LocalImageEntry {
  readonly status: WorkspaceImageStatus;
  readonly mediaType: ImageMediaType | null;
  /** Pure base64 payload; empty unless status is 'ok'. */
  readonly data: string;
}
export interface AssistantWebviewState {
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly connection: Extract<
    HostToWebviewMessage,
    { type: 'host.connection' }
  >['connection'];
  readonly turn: AssistantTurn | null;
  readonly sessions: Extract<
    HostToWebviewMessage,
    { type: 'host.snapshot' }
  >['sessions'];
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  /** Skills load lazily; 'idle' means not requested yet. */
  readonly skills: SessionSkillsState | { status: 'idle'; items: readonly [] };
  /** MCP servers load lazily; 'idle' means not requested yet. */
  readonly mcp: SessionMcpState | { status: 'idle'; items: readonly [] };
  /** Installed plugins load lazily; 'idle' means not requested yet. */
  readonly plugins:
    | SessionPluginsState
    | { status: 'idle'; items: readonly [] };
  /** Custom slash commands load lazily on the first `/` trigger. */
  readonly commands:
    | SessionCommandsState
    | { status: 'idle'; items: readonly []; recent: readonly [] };
  /** Progress of the one in-flight MCP browser authentication flow. */
  readonly mcpAuth: {
    readonly serverName: string;
    readonly phase: McpAuthPhase;
    readonly message: string | null;
  } | null;
  /** Attachments staged on the host for the next prompt. */
  readonly attachments: readonly AttachmentSummary[];
  /** Host-owned staged image bytes loaded on demand for preview. */
  readonly attachmentImages: Readonly<
    Record<string, AttachmentImageEntry>
  >;
  /** Latest workspace file search result for the `@` mention popup. */
  readonly fileSearch: {
    readonly requestId: string;
    readonly status: WorkspaceFilesStatus;
    readonly files: readonly string[];
  } | null;
  /**
   * Workspace-local images resolved for markdown references, keyed
   * by the path exactly as written in the markdown source.
   */
  readonly localImages: Readonly<Record<string, LocalImageEntry>>;
  /** Archived sessions load lazily; 'idle' means not requested yet. */
  readonly archived:
    | SessionArchivedState
    | { readonly status: 'idle'; readonly items: readonly [] };
  /** Latest daemon content-search result, or null before a search. */
  readonly sessionSearch: SessionSearchState | null;
  /** Latest rewind file-impact info for the edit-resend editor. */
  readonly rewindInfo: RewindFileImpact | null;
  /** Latest branch-versus-base diff, or null before a request. */
  readonly branchDiff: GitBranchDiffState | null;
  readonly review: ReviewUiState;
  /** Edit staging area contents for the message being edited. */
  readonly editAttachments: {
    readonly messageId: string;
    readonly attachments: readonly EditAttachmentSummary[];
  } | null;
  /**
   * Latest structured edit-resend rejection; `sequence` distinguishes
   * consecutive rejections of the same message.
   */
  readonly editResendRejection: {
    readonly messageId: string;
    readonly reason: EditResendRejectReason;
    readonly sequence: number;
  } | null;
  /**
   * Host-advertised capability to create sessions in a daemon-managed
   * git worktree. Workspace-level and snapshot-borne; false hides the
   * drawer entry entirely (fail closed).
   */
  readonly worktreeCreateAvailable: boolean;
  /**
   * Host-advertised `/btw` side-chat capability (process runtime
   * only); false hides every entry point (fail closed).
   */
  readonly btwAvailable: boolean;
  /**
   * Host-advertised daemon-backed background turns: switching away
   * from a running turn detaches it instead of killing it. False
   * keeps session switching blocked while a turn runs (fail closed,
   * process mode).
   */
  readonly backgroundTurnsAvailable: boolean;
  /** Host-projected side-chat card contents (session.btw). */
  readonly btw: SessionBtwState;
  /**
   * Absolute workspace folder from the host snapshot; rebases
   * absolute transcript paths (path-link Preview entry). Null until a
   * snapshot carries it, which hides rebase-dependent affordances.
   */
  readonly workspaceRoot: string | null;
  /**
   * Read-only mission identity of the active session (state and/or
   * decomposition role); null outside mission decompositions.
   */
  readonly mission: SessionMissionSummary | null;
  /** Authoritative bounded Mission setup/control projection. */
  readonly missionSnapshot: MissionSnapshotMessage | null;
  /** Latest correlated Mission operation settlement. */
  readonly missionControlResult: MissionControlResultMessage | null;
  /**
   * Token-usage breakdown of the active session (cumulative totals +
   * last completed turn); empty members until the host reports data.
   */
  readonly tokenUsage: SessionTokenUsageState;
  /**
   * Prompts queued behind the running turn. Mutations apply
   * optimistically and the host's `queue.state` echo reconciles.
   */
  readonly queue: SessionQueueState;
  /**
   * The queued prompt currently loaded into the Composer ("Edit
   * Queued" mode). `seq` distinguishes consecutive edit sessions so
   * the Composer re-prefills when the same prompt is edited again.
   * Cleared whenever the prompt leaves the queue (dispatched,
   * removed, session change).
   */
  readonly queueEditing: {
    readonly queueId: string;
    readonly seq: number;
  } | null;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly historyStatus: Extract<
    HostToWebviewMessage,
    { type: 'host.snapshot' }
  >['historyStatus'] | null;
  readonly truncated: boolean;
  readonly interactions: readonly PendingInteraction[];
  readonly terminalTurnId: string | null;
  /** Inline commit panel state behind the changes-card entry. */
  readonly git: GitCommitFlowState;
}
/**
 * Host messages the store consumes. App handles sequence-free theme
 * pushes and transient Canvas draft commands directly.
 */
export type StoreHostMessage = Exclude<
  HostToWebviewMessage,
  { type: 'ui.theme' | 'canvas.feedbackDraft' }
>;
export type AssistantWebviewAction =
  | {
      readonly type: 'host.message';
      readonly message: StoreHostMessage;
    }
  | {
      readonly type: 'turn.send';
      readonly turnId: string;
      readonly text: string;
    }
  | { readonly type: 'turn.stop' }
  | {
      readonly type: 'git.statusRequested';
      readonly turnId: string;
    }
  | {
      readonly type: 'git.commitRequested';
      readonly turnId: string;
    }
  | {
      readonly type: 'queue.add';
      readonly queueId: string;
      readonly text: string;
    }
  | {
      readonly type: 'queue.update';
      readonly queueId: string;
      readonly text: string;
    }
  | { readonly type: 'queue.remove'; readonly queueId: string }
  | { readonly type: 'queue.promote'; readonly queueId: string }
  | { readonly type: 'queue.resume' }
  | { readonly type: 'queue.clear' }
  | { readonly type: 'queue.editBegin'; readonly queueId: string }
  | { readonly type: 'queue.editEnd' };

export const initialAssistantWebviewState: AssistantWebviewState = {
  sequence: -1,
  sessionId: null,
  connection: { status: 'idle' },
  turn: null,
  sessions: { status: 'idle', items: [] },
  settings: { status: 'loading', value: null },
  context: { status: 'loading', value: null },
  modelCatalog: { status: 'loading', items: [] },
  skills: { status: 'idle', items: [] },
  mcp: { status: 'idle', items: [] },
  plugins: { status: 'idle', items: [] },
  commands: { status: 'idle', items: [], recent: [] },
  mcpAuth: null,
  attachments: [],
  attachmentImages: {},
  fileSearch: null,
  localImages: {},
  archived: { status: 'idle', items: [] },
  sessionSearch: null,
  rewindInfo: null,
  branchDiff: null,
  review: EMPTY_REVIEW_UI_STATE,
  editAttachments: null,
  editResendRejection: null,
  worktreeCreateAvailable: false,
  btwAvailable: false,
  backgroundTurnsAvailable: false,
  btw: EMPTY_SESSION_BTW_STATE,
  workspaceRoot: null,
  mission: null,
  missionSnapshot: null,
  missionControlResult: null,
  tokenUsage: EMPTY_SESSION_TOKEN_USAGE,
  queue: EMPTY_SESSION_QUEUE_STATE,
  queueEditing: null,
  transcript: [],
  historyStatus: null,
  truncated: false,
  interactions: [],
  terminalTurnId: null,
  git: initialGitCommitFlowState,
};

const MAX_DIAGNOSTICS = 50;

/** Most markdown-referenced images kept decoded in webview state. */
const MAX_LOCAL_IMAGE_ENTRIES = 24;

export function assistantWebviewReducer(
  state: AssistantWebviewState,
  action: AssistantWebviewAction,
): AssistantWebviewState {
  if (action.type === 'turn.send') {
    if (state.sessionId === null || isTurnActive(state.turn)) {
      return state;
    }
    return boundTranscript(
      {
        ...state,
        turn: { turnId: action.turnId, status: 'submitting' },
        terminalTurnId: null,
      },
      [
        ...state.transcript,
        {
          id: `user:${action.turnId}`,
          kind: 'user',
          text: action.text,
        },
      ],
    );
  }

  if (action.type === 'git.statusRequested') {
    return {
      ...state,
      git: {
        ...state.git,
        statusPending: true,
        statusTurnId: action.turnId,
      },
    };
  }

  if (action.type === 'git.commitRequested') {
    return {
      ...state,
      git: {
        ...state.git,
        commitPending: true,
        commitTurnId: action.turnId,
        lastResult: null,
      },
    };
  }

  if (action.type === 'queue.add') {
    if (
      state.sessionId === null ||
      state.queue.items.length >= MAX_QUEUED_MESSAGES ||
      state.queue.items.some((item) => item.queueId === action.queueId)
    ) {
      return state;
    }
    return {
      ...state,
      queue: {
        ...state.queue,
        items: [
          ...state.queue.items,
          {
            queueId: action.queueId,
            text: action.text,
            // The host consumes the staged attachments at enqueue
            // time; mirror that projection optimistically.
            attachments: state.attachments.map(
              ({ kind, name, sizeBytes }) => ({ kind, name, sizeBytes }),
            ),
          },
        ],
      },
      attachments: [],
    };
  }

  if (action.type === 'queue.update') {
    return {
      ...state,
      queue: {
        ...state.queue,
        items: state.queue.items.map((item) =>
          item.queueId === action.queueId
            ? { ...item, text: action.text }
            : item,
        ),
      },
    };
  }

  if (action.type === 'queue.remove') {
    const items = state.queue.items.filter(
      (item) => item.queueId !== action.queueId,
    );
    return {
      ...state,
      queue: {
        items,
        paused: items.length === 0 ? null : state.queue.paused,
      },
      queueEditing:
        state.queueEditing?.queueId === action.queueId
          ? null
          : state.queueEditing,
    };
  }

  if (action.type === 'queue.promote') {
    const item = state.queue.items.find(
      (entry) => entry.queueId === action.queueId,
    );
    if (item === undefined) {
      return state;
    }
    // Mirrors the host: send-now reorders to the head and doubles as
    // a resume on a paused queue.
    return {
      ...state,
      queue: {
        items: [
          item,
          ...state.queue.items.filter(
            (entry) => entry.queueId !== action.queueId,
          ),
        ],
        paused: null,
      },
    };
  }

  if (action.type === 'queue.resume') {
    return { ...state, queue: { ...state.queue, paused: null } };
  }

  if (action.type === 'queue.clear') {
    return {
      ...state,
      queue: EMPTY_SESSION_QUEUE_STATE,
      queueEditing: null,
    };
  }

  if (action.type === 'queue.editBegin') {
    if (
      !state.queue.items.some(
        (item) => item.queueId === action.queueId,
      )
    ) {
      return state;
    }
    return {
      ...state,
      queueEditing: {
        queueId: action.queueId,
        seq: (state.queueEditing?.seq ?? 0) + 1,
      },
    };
  }

  if (action.type === 'queue.editEnd') {
    return state.queueEditing === null
      ? state
      : { ...state, queueEditing: null };
  }

  if (action.type === 'turn.stop') {
    if (
      state.turn === null ||
      (state.turn.status !== 'submitting' &&
        state.turn.status !== 'streaming')
    ) {
      return state;
    }
    return boundTranscript(
      { ...state, turn: { ...state.turn, status: 'stopping' } },
      markActivitiesStopping(state.transcript, state.turn.turnId),
    );
  }

  const event = action.message;
  if (!Number.isFinite(event.sequence) || event.sequence <= state.sequence) {
    return state;
  }

  switch (event.type) {
    case 'host.snapshot':
      return {
        sequence: event.sequence,
        sessionId: event.sessionId,
        connection: event.connection,
        turn:
          event.turn === null
            ? null
            : {
                turnId: event.turn.turnId,
                status: event.turn.status,
                ...(event.turn.error === undefined
                  ? {}
                  : { error: event.turn.error }),
              },
        sessions: event.sessions,
        settings: event.settings,
        context: event.context,
        modelCatalog: event.modelCatalog,
        // Snapshots do not carry skills/MCP; keep them for the same session.
        skills:
          event.sessionId === state.sessionId
            ? state.skills
            : { status: 'idle', items: [] },
        mcp:
          event.sessionId === state.sessionId
            ? state.mcp
            : { status: 'idle', items: [] },
        plugins:
          event.sessionId === state.sessionId
            ? state.plugins
            : { status: 'idle', items: [] },
        commands:
          event.sessionId === state.sessionId
            ? state.commands
            : { status: 'idle', items: [], recent: [] },
        mcpAuth:
          event.sessionId === state.sessionId ? state.mcpAuth : null,
        attachments:
          event.sessionId === state.sessionId ? state.attachments : [],
        attachmentImages:
          event.sessionId === state.sessionId
            ? state.attachmentImages
            : {},
        fileSearch:
          event.sessionId === state.sessionId ? state.fileSearch : null,
        localImages:
          event.sessionId === state.sessionId ? state.localImages : {},
        // Archived list and content search are workspace-level, not
        // session-level; they survive session switches.
        archived: state.archived,
        sessionSearch: state.sessionSearch,
        rewindInfo: null,
        branchDiff:
          event.sessionId === state.sessionId ? state.branchDiff : null,
        review: event.sessionId === state.sessionId
          ? state.review : EMPTY_REVIEW_UI_STATE,
        // A snapshot means the session identity may have changed (e.g.
        // an adopted edit-resend fork); any in-progress edit is stale.
        editAttachments:
          event.sessionId === state.sessionId
            ? state.editAttachments
            : null,
        editResendRejection:
          event.sessionId === state.sessionId
            ? state.editResendRejection
            : null,
        worktreeCreateAvailable: event.worktreeCreateAvailable === true,
        btwAvailable: event.btwAvailable === true,
        backgroundTurnsAvailable:
          event.backgroundTurnsAvailable === true,
        btw:
          event.sessionId === state.sessionId
            ? state.btw
            : EMPTY_SESSION_BTW_STATE,
        workspaceRoot: event.workspaceRoot ?? null,
        mission: event.mission ?? null,
        missionSnapshot:
          event.sessionId === state.sessionId ? state.missionSnapshot : null,
        missionControlResult:
          event.sessionId === state.sessionId
            ? state.missionControlResult
            : null,
        tokenUsage: event.tokenUsage ?? EMPTY_SESSION_TOKEN_USAGE,
        queue: event.queue ?? EMPTY_SESSION_QUEUE_STATE,
        queueEditing: reconcileQueueEditing(
          state.queueEditing,
          event.queue ?? EMPTY_SESSION_QUEUE_STATE,
        ),
        transcript: event.transcript,
        historyStatus: event.historyStatus,
        truncated: event.truncated,
        interactions: [],
        terminalTurnId:
          event.turn !== null && isTerminalStatus(event.turn.status)
            ? event.turn.turnId
            : null,
        // Git status is workspace-level; a fresh status arrives on demand.
        git:
          event.sessionId === state.sessionId
            ? state.git
            : initialGitCommitFlowState,
      };
    case 'host.connection': {
      const changed = event.sessionId !== state.sessionId;
      return {
        ...state,
        sequence: event.sequence,
        sessionId: event.sessionId,
        connection: event.connection,
        ...(changed
          ? {
              turn: null,
              mission: null,
              missionSnapshot: null,
              missionControlResult: null,
              btw: EMPTY_SESSION_BTW_STATE,
              tokenUsage: EMPTY_SESSION_TOKEN_USAGE,
              queue: EMPTY_SESSION_QUEUE_STATE,
              queueEditing: null,
              transcript: [],
              historyStatus: null,
              truncated: false,
              settings: { status: 'loading', value: null },
              context: { status: 'loading', value: null },
              modelCatalog: { status: 'loading', items: [] },
              skills: { status: 'idle', items: [] },
              mcp: { status: 'idle', items: [] },
              plugins: { status: 'idle', items: [] },
              commands: { status: 'idle', items: [], recent: [] },
              mcpAuth: null,
              attachments: [],
              attachmentImages: {},
              editAttachments: null,
              editResendRejection: null,
              interactions: [],
              terminalTurnId: null,
              review: EMPTY_REVIEW_UI_STATE,
            }
          : {}),
      };
    }
    case 'session.settings':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            settings: event.settings,
          }
        : advance(state, event.sequence);
    case 'session.context':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            context: event.context,
          }
        : advance(state, event.sequence);
    case 'session.tokenUsage':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            tokenUsage: event.tokenUsage,
          }
        : advance(state, event.sequence);
    case 'session.btw':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            btw: event.btw,
          }
        : advance(state, event.sequence);
    case 'session.model-catalog':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            modelCatalog: event.modelCatalog,
          }
        : advance(state, event.sequence);
    case 'session.skills': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // A toggle/refresh in flight sends 'loading' with no items, and a
      // failed operation may arrive with an empty error payload; keep
      // showing the current list in both cases instead of blanking it.
      const skills =
        event.skills.status === 'loading' &&
        event.skills.items.length === 0 &&
        state.skills.items.length > 0
          ? { status: 'loading' as const, items: state.skills.items }
          : event.skills.status === 'error' &&
              event.skills.items.length === 0 &&
              state.skills.items.length > 0
            ? {
                status: 'error' as const,
                items: state.skills.items,
                message: event.skills.message,
              }
            : event.skills;
      return { ...state, sequence: event.sequence, skills };
    }
    case 'session.plugins': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // A refresh in flight sends 'loading' with no items, and a failed
      // refresh arrives with an empty payload; keep showing the current
      // list in both cases instead of blanking it.
      const plugins =
        event.plugins.status === 'loading' &&
        event.plugins.items.length === 0 &&
        state.plugins.items.length > 0
          ? { status: 'loading' as const, items: state.plugins.items }
          : event.plugins.status === 'error' &&
              event.plugins.items.length === 0 &&
              state.plugins.items.length > 0
            ? {
                status: 'error' as const,
                items: state.plugins.items,
                message: event.plugins.message,
              }
            : event.plugins;
      return { ...state, sequence: event.sequence, plugins };
    }
    case 'session.mcp': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const mcp =
        event.mcp.status === 'loading' &&
        event.mcp.items.length === 0 &&
        state.mcp.items.length > 0
          ? { status: 'loading' as const, items: state.mcp.items }
          : event.mcp.status === 'error' &&
              event.mcp.items.length === 0 &&
              state.mcp.items.length > 0
            ? {
                status: 'error' as const,
                items: state.mcp.items,
                message: event.mcp.message,
              }
            : event.mcp;
      return { ...state, sequence: event.sequence, mcp };
    }
    case 'session.commands': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // A refresh in flight sends 'loading' with no items; keep showing
      // the current list until the fresh one arrives.
      const commands =
        event.commands.status === 'loading' &&
        event.commands.items.length === 0 &&
        state.commands.items.length > 0
          ? {
              status: 'loading' as const,
              items: state.commands.items,
              recent: event.commands.recent,
            }
          : event.commands;
      return { ...state, sequence: event.sequence, commands };
    }
    case 'customModels.state':
    case 'customModels.discovery':
    case 'providerModels.state':
      // Panel-scoped masked state: the CustomModelsPanel flow hook
      // consumes it off its own window listener (on-demand pull, not
      // snapshot-resident); the store only advances the sequence.
      return advance(state, event.sequence);
    case 'mcp.auth':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            mcpAuth: {
              serverName: event.serverName,
              phase: event.phase,
              message: event.message,
            },
          }
        : advance(state, event.sequence);
    case 'session.attachments':
    case 'session.attachmentImageData':
    case 'session.editAttachments':
      return reduceAttachmentMessage(state, event);
    case 'turn.editResendRejected':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            editResendRejection: {
              messageId: event.messageId,
              reason: event.reason,
              sequence: event.sequence,
            },
          }
        : advance(state, event.sequence);
    case 'session.running': {
      // Incremental running flag of one catalog row (detached daemon
      // turn); flips the drawer spinner without a catalog refresh.
      if (state.sessions.status !== 'ready') {
        return advance(state, event.sequence);
      }
      const items = state.sessions.items.map((item) =>
        item.id === event.sessionId
          ? event.running
            ? { ...item, running: true }
            : (({ running: _running, ...rest }) => rest)(item)
          : item,
      );
      return {
        ...state,
        sequence: event.sequence,
        sessions: { ...state.sessions, items },
      };
    }
    case 'session.archived': {
      // A refresh in flight sends 'loading' with no items; keep the
      // current list visible until the fresh one arrives.
      const archived =
        event.archived.status === 'loading' &&
        state.archived.items.length > 0
          ? { status: 'loading' as const, items: state.archived.items }
          : event.archived;
      return { ...state, sequence: event.sequence, archived };
    }
    case 'session.searchResults':
      return {
        ...state,
        sequence: event.sequence,
        sessionSearch: event.search,
      };
    case 'workspace.files':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            fileSearch: {
              requestId: event.requestId,
              status: event.status,
              files: event.files,
            },
          }
        : advance(state, event.sequence);
    case 'workspace.imageData': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const entries = Object.entries(state.localImages).filter(
        ([path]) => path !== event.path,
      );
      // Insertion order doubles as recency for the byte budget.
      entries.push([
        event.path,
        {
          status: event.status,
          mediaType: event.mediaType,
          data: event.data,
        },
      ]);
      while (entries.length > MAX_LOCAL_IMAGE_ENTRIES) {
        entries.shift();
      }
      return {
        ...state,
        sequence: event.sequence,
        localImages: Object.fromEntries(entries),
      };
    }
    case 'git.branchDiff': {
      const { type: _type, sequence, sessionId, ...branchDiff } = event;
      return sessionId === state.sessionId
        ? { ...state, sequence, branchDiff } : advance(state, sequence);
    }
    case 'review.state': case 'review.restorePreview':
    case 'review.operationResult': case 'review.agentReviewState':
      return { ...state, sequence: event.sequence,
        review: reduceReviewUiMessage(state.review, event, state.sessionId) };
    case 'rewind.info': {
      const { type: _type, sequence, sessionId, ...rewindInfo } = event;
      return sessionId === state.sessionId
        ? { ...state, sequence, rewindInfo }
        : advance(state, sequence);
    }
    case 'assistant.delta':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'responding',
          },
        },
        appendAssistantDelta(
          state.transcript,
          event.turnId,
          event.delta,
          event.sequence,
        ),
      );
    case 'thinking.delta':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'working',
          },
        },
        appendThinkingDelta(
          state.transcript,
          event.turnId,
          event.delta,
          event.truncated,
          event.segmentIndex,
        ),
      );
    case 'thinking.complete':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        state.transcript.map((item) =>
          item.kind === 'thinking' &&
          item.id === thinkingSegmentItemId(event.turnId, event.segmentIndex)
            ? {
                ...item,
                status: 'complete',
                ...(event.durationMs === null
                  ? {}
                  : { durationMs: event.durationMs }),
              }
            : item,
        ),
      );
    case 'tool.activity':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'working',
          },
        },
        upsertTool(state.transcript, event),
      );
    case 'subagent.activity':
      return advance(state, event.sequence);
    case 'subagent.update':
      // Out-of-band settlement of a background delegation: lands
      // after its turn reached a terminal state, so it deliberately
      // bypasses acceptsActiveTurn. Only the addressed row's
      // subagent field may change; everything else is immutable.
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      return {
        ...advance(state, event.sequence),
        transcript: state.transcript.map((item) =>
          item.kind === 'tool' &&
          item.turnId === event.turnId &&
          item.toolUseId === event.toolUseId &&
          item.subagent !== undefined
            ? { ...item, subagent: event.subagent }
            : item,
        ),
      };
    case 'transcript.image': {
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      if (
        state.transcript.some((item) => item.id === event.item.id) ||
        state.transcript.filter(
          (item) =>
            item.kind === 'image' && item.turnId === event.turnId,
        ).length >= MAX_IMAGES_PER_TURN
      ) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        [...state.transcript, event.item],
      );
    }
    case 'changes.update': {
      // `writing` frames belong to the live turn only; the `settled`
      // reconciliation lands after the turn reached a terminal state
      // and therefore only gates on the session.
      if (
        event.state === 'writing'
          ? !acceptsActiveTurn(state, event.sessionId, event.turnId)
          : event.sessionId !== state.sessionId
      ) {
        return advance(state, event.sequence);
      }
      // The ledger keeps its first-appearance position and id: later
      // frames replace files in place so DOM keys stay stable and
      // rows never replay their entry animation.
      const index = state.transcript.findIndex(
        (item) =>
          item.kind === 'changes' && item.turnId === event.turnId,
      );
      const existing = state.transcript[index];
      const item: SessionTranscriptItem = {
        id: existing?.id ?? `changes:${event.turnId}`,
        kind: 'changes',
        turnId: event.turnId,
        files: event.files,
        ...(event.state === 'writing' ? { writing: true } : {}),
      };
      return boundTranscript(
        { ...state, sequence: event.sequence },
        existing === undefined
          ? [...state.transcript, item]
          : state.transcript.map((entry, entryIndex) =>
              entryIndex === index ? item : entry,
            ),
      );
    }
    case 'runtime.diagnostic':
      if (!acceptsDiagnostic(state, event.sessionId, event.turnId) ||
        isTransientRuntimeDiagnostic(event.code)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        appendDiagnostic(state.transcript, {
          id: `diagnostic:${event.sequence}`,
          kind: 'diagnostic',
          turnId: event.turnId,
          severity: event.severity,
          code: event.code,
          message: event.message,
          ...(event.relatedSessionId === undefined
            ? {}
            : { relatedSessionId: event.relatedSessionId }),
        }),
      );
    case 'user.message-meta': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // The prompt item id depends on its origin: optimistic sends use
      // `user:<turnId>`, host snapshots use the stable transcript id.
      const promptIds = new Set([
        `user:${event.turnId}`,
        stableTranscriptId('user', event.turnId),
      ]);
      const index = state.transcript.findIndex(
        (item) => item.kind === 'user' && promptIds.has(item.id),
      );
      const item = state.transcript[index];
      if (
        item === undefined ||
        item.kind !== 'user' ||
        item.messageId === event.messageId
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        transcript: state.transcript.map((entry, entryIndex) =>
          entryIndex === index
            ? { ...item, messageId: event.messageId }
            : entry,
        ),
      };
    }
    case 'turn.state':
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const turnStateBase: AssistantWebviewState = {
        ...state,
        sequence: event.sequence,
        terminalTurnId: isTerminalStatus(event.status)
          ? event.turnId
          : state.terminalTurnId === event.turnId
            ? state.terminalTurnId
            : null,
        interactions: isTerminalStatus(event.status)
          ? state.interactions.filter(
              (interaction) => interaction.turnId !== event.turnId,
            )
          : state.interactions,
      };
      if (!matchesTurn(state, event.sessionId, event.turnId)) {
        return turnStateBase;
      }
      if (
        (state.turn.status === 'stopping' ||
          isTerminalStatus(state.turn.status)) &&
        !isTerminalStatus(event.status)
      ) {
        return turnStateBase;
      }
      return boundTranscript(
        {
          ...turnStateBase,
          turn: { ...state.turn, status: event.status },
        },
        isTerminalStatus(event.status)
          ? finalizeActivities(
              state.transcript,
              event.turnId,
              event.status,
            )
          : state.transcript,
      );
    case 'turn.error':
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const turnErrorBase: AssistantWebviewState = {
        ...state,
        sequence: event.sequence,
        terminalTurnId: event.turnId,
        interactions: state.interactions.filter(
          (interaction) => interaction.turnId !== event.turnId,
        ),
      };
      if (!acceptsTurnError(state, event.sessionId, event.turnId)) {
        return turnErrorBase;
      }
      return boundTranscript(
        {
          ...turnErrorBase,
          turn: {
            turnId: event.turnId,
            status: 'failed',
            error: event.message,
          },
        },
        appendDiagnostic(
          finalizeActivities(state.transcript, event.turnId, 'failed'),
          {
            id: `diagnostic:${event.sequence}`,
            kind: 'diagnostic',
            turnId: event.turnId,
            severity: 'error',
            code: event.code,
            message: event.message,
          },
        ),
      );
    case 'interaction.request':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId === state.terminalTurnId ||
        state.interactions.some(
          ({ request }) => request.requestId === event.request.requestId,
        )
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        interactions: [
          ...state.interactions,
          {
            sessionId: event.sessionId,
            turnId: event.turnId,
            request: event.request,
          },
        ],
      };
    case 'interaction.closed':
      return reduceInteractionClosed(state, event);
    case 'plan.document.state':
      return reducePlanDocumentState(state, event);
    case 'git.status':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId !== state.git.statusTurnId
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        git: {
          ...state.git,
          availability:
            event.unavailableReason === undefined
              ? 'available'
              : 'unavailable',
          unavailableReason: event.unavailableReason ?? null,
          statusPending: false,
          branch: event.branch,
          files: event.files,
          committedHash: event.committedHash ?? null,
        },
      };
    case 'git.commitResult':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId !== state.git.commitTurnId
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        git: {
          ...state.git,
          commitPending: false,
          lastResult: event.ok
            ? { ok: true, hash: event.hash, subject: event.subject }
            : { ok: false, error: event.error },
        },
      };
    case 'queue.state':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            queue: { items: event.items, paused: event.paused },
            queueEditing: reconcileQueueEditing(state.queueEditing, {
              items: event.items,
              paused: event.paused,
            }),
          }
        : advance(state, event.sequence);
    case 'mission.snapshot':
      return {
        ...state,
        sequence: event.sequence,
        missionSnapshot: event,
      };
    case 'mission.controlResult':
      return {
        ...state,
        sequence: event.sequence,
        missionControlResult: event,
      };
  }
}

/**
 * An edit session only makes sense while its prompt is still queued;
 * authoritative echoes that drop the prompt (dispatched, removed in
 * another view) end the edit.
 */
function reconcileQueueEditing(
  editing: AssistantWebviewState['queueEditing'],
  queue: SessionQueueState,
): AssistantWebviewState['queueEditing'] {
  if (editing === null) {
    return null;
  }
  return queue.items.some((item) => item.queueId === editing.queueId)
    ? editing
    : null;
}
export function isTurnActive(turn: AssistantTurn | null): boolean {
  return (
    turn?.status === 'submitting' ||
    turn?.status === 'streaming' ||
    turn?.status === 'stopping'
  );
}
function advance(
  state: AssistantWebviewState,
  sequence: number,
): AssistantWebviewState {
  return { ...state, sequence };
}

function boundTranscript(
  state: AssistantWebviewState,
  transcript: readonly SessionTranscriptItem[],
): AssistantWebviewState {
  const bounded = trimTranscriptToLimits(transcript);
  // Image byte eviction degrades old images to placeholder rows; it
  // does not make the history partial.
  const imageBudget = enforceTranscriptImageBudget(bounded.transcript);
  if (!bounded.trimmed) {
    return { ...state, transcript: imageBudget.transcript };
  }
  return {
    ...state,
    transcript: imageBudget.transcript,
    historyStatus: 'partial',
    truncated: true,
  };
}

function matchesTurn(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    state.sessionId === sessionId &&
    state.turn !== null &&
    state.turn.turnId === turnId
  );
}

function acceptsActiveTurn(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    matchesTurn(state, sessionId, turnId) &&
    (state.turn.status === 'submitting' ||
      state.turn.status === 'streaming')
  );
}

function acceptsTurnError(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    matchesTurn(state, sessionId, turnId) &&
    (state.turn.status === 'submitting' ||
      state.turn.status === 'streaming' ||
      state.turn.status === 'stopping')
  );
}

function acceptsDiagnostic(
  state: AssistantWebviewState,
  sessionId: string | null,
  turnId: string | null,
): boolean {
  if (sessionId !== null && sessionId !== state.sessionId) {
    return false;
  }
  if (turnId === null) {
    return true;
  }
  return (
    state.turn?.turnId === turnId &&
    state.turn.status !== 'stopping' &&
    state.turn.status !== 'interrupted'
  );
}

function isTerminalStatus(
  status: TurnStatus,
): status is 'completed' | 'interrupted' | 'failed' {
  return (
    status === 'completed' ||
    status === 'interrupted' ||
    status === 'failed'
  );
}

function appendAssistantDelta(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  delta: string,
  sequence: number,
): readonly SessionTranscriptItem[] {
  const last = transcript.at(-1);
  if (last?.kind !== 'assistant' || last.turnId !== turnId) {
    return [
      ...transcript,
      {
        id: `assistant:${turnId}:${sequence}`,
        kind: 'assistant',
        turnId,
        text: delta,
      },
    ];
  }
  return [
    ...transcript.slice(0, -1),
    { ...last, text: last.text + delta },
  ];
}

/**
 * Per-segment thinking item id. Segments key by their bridge
 * segmentIndex so interleaved thinking renders one row per segment
 * at its arrival position; legacy single-block `thinking:${turnId}`
 * ids from old recovery checkpoints never collide with these.
 */
function thinkingSegmentItemId(
  turnId: string,
  segmentIndex: number,
): string {
  return `thinking:${turnId}:${segmentIndex}`;
}

function appendThinkingDelta(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  delta: string,
  truncated: boolean,
  segmentIndex: number,
): readonly SessionTranscriptItem[] {
  const id = thinkingSegmentItemId(turnId, segmentIndex);
  const index = transcript.findIndex((item) => item.id === id);
  if (index === -1) {
    return [
      ...transcript,
      {
        id,
        kind: 'thinking',
        turnId,
        text: delta,
        status: 'active',
        truncated,
      },
    ];
  }
  return transcript.map((item, itemIndex) =>
    itemIndex === index && item.kind === 'thinking'
      ? {
          ...item,
          text: item.text + delta,
          truncated: item.truncated || truncated,
        }
      : item,
  );
}

function upsertTool(
  transcript: readonly SessionTranscriptItem[],
  event: Extract<HostToWebviewMessage, { type: 'tool.activity' }>,
): readonly SessionTranscriptItem[] {
  const index = transcript.findIndex(
    (item) =>
      item.kind === 'tool' &&
      item.turnId === event.turnId &&
      item.toolUseId === event.toolUseId,
  );
  if (index !== -1) {
    return transcript.map((item, itemIndex) => {
      if (itemIndex !== index || item.kind !== 'tool') {
        return item;
      }
      if (
        event.status === 'running' &&
        (item.status === 'completed' ||
          item.status === 'failed' ||
          item.status === 'stopped')
      ) {
        return item;
      }
      return {
        ...item,
        toolName: event.toolName,
        action: event.action,
        status: event.status,
        progressCount: event.progressCount,
        latestUpdateKind: event.latestUpdateKind,
        ...(event.durationMs === undefined
          ? {}
          : { durationMs: event.durationMs }),
        ...(event.filePath === undefined
          ? {}
          : { filePath: event.filePath }),
        ...(event.additionalFileCount === undefined
          ? {}
          : { additionalFileCount: event.additionalFileCount }),
        ...(event.detailKind === undefined || event.detail === undefined
          ? {}
          : { detailKind: event.detailKind, detail: event.detail }),
        ...(event.target === undefined ? {} : { target: event.target }),
        ...(event.errorMessage === undefined
          ? {}
          : { errorMessage: event.errorMessage }),
        ...(event.outputTail === undefined
          ? {}
          : { outputTail: event.outputTail }),
        ...(event.backgroundHint === undefined
          ? {}
          : { backgroundHint: event.backgroundHint }),
        ...(event.subagent === undefined
          ? {}
          : { subagent: event.subagent }),
      };
    });
  }
  const count = transcript.filter(
    (item) => item.kind === 'tool' && item.turnId === event.turnId,
  ).length;
  if (count >= MAX_TOOL_ACTIVITIES_PER_TURN) {
    return transcript;
  }
  return [
    ...transcript,
    {
      id: `tool:${event.turnId}:${event.toolUseId}`,
      kind: 'tool',
      turnId: event.turnId,
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      action: event.action,
      status: event.status,
      progressCount: event.progressCount,
      latestUpdateKind: event.latestUpdateKind,
      ...(event.durationMs === undefined
        ? {}
        : { durationMs: event.durationMs }),
      ...(event.filePath === undefined
        ? {}
        : { filePath: event.filePath }),
      ...(event.additionalFileCount === undefined
        ? {}
        : { additionalFileCount: event.additionalFileCount }),
      ...(event.detailKind === undefined || event.detail === undefined
        ? {}
        : { detailKind: event.detailKind, detail: event.detail }),
      ...(event.target === undefined ? {} : { target: event.target }),
      ...(event.errorMessage === undefined
        ? {}
        : { errorMessage: event.errorMessage }),
      ...(event.outputTail === undefined
        ? {}
        : { outputTail: event.outputTail }),
      ...(event.backgroundHint === undefined
        ? {}
        : { backgroundHint: event.backgroundHint }),
      ...(event.subagent === undefined
        ? {}
        : { subagent: event.subagent }),
    },
  ];
}
function markActivitiesStopping(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
): readonly SessionTranscriptItem[] {
  return transcript.map((item) => {
    if (
      item.kind === 'thinking' &&
      item.turnId === turnId &&
      item.status === 'active'
    ) {
      return { ...item, status: 'stopping' };
    }
    if (
      item.kind === 'tool' &&
      item.turnId === turnId &&
      item.status === 'running'
    ) {
      return { ...item, status: 'stopping' };
    }
    return item;
  });
}

function finalizeActivities(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  outcome: 'completed' | 'interrupted' | 'failed',
): readonly SessionTranscriptItem[] {
  return transcript.map((item) => {
    if (
      item.kind === 'thinking' &&
      item.turnId === turnId &&
      (item.status === 'active' || item.status === 'stopping')
    ) {
      return {
        ...item,
        status: outcome === 'completed' ? 'complete' : 'stopped',
      };
    }
    if (
      item.kind === 'tool' &&
      item.turnId === turnId &&
      (item.status === 'running' || item.status === 'stopping')
    ) {
      return {
        ...item,
        status:
          outcome === 'completed'
            ? 'completed'
            : 'stopped',
      };
    }
    if (
      item.kind === 'changes' &&
      item.turnId === turnId &&
      item.writing === true
    ) {
      // Settle the ledger header at once; failed turns get no
      // settled reconciliation frame at all.
      const { writing: _writing, ...settled } = item;
      return settled;
    }
    return item;
  });
}

function appendDiagnostic(
  transcript: readonly SessionTranscriptItem[],
  next: Extract<SessionTranscriptItem, { kind: 'diagnostic' }>,
): readonly SessionTranscriptItem[] {
  // Repeats with nothing in between (e.g. clicking a dead file chip
  // six times) collapse into the one visible card; the same
  // diagnostic recurring after other content still appends.
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item === undefined || item.kind !== 'diagnostic') {
      break;
    }
    if (
      item.turnId === next.turnId &&
      item.severity === next.severity &&
      item.code === next.code &&
      item.message === next.message
    ) {
      return transcript;
    }
  }
  const current =
    next.code === 'runtime-execution-failed' && next.turnId !== null
      ? transcript.filter(
          (item) =>
            item.kind !== 'diagnostic' ||
            item.turnId !== next.turnId ||
            item.severity !== 'error',
        )
      : transcript;
  const count = current.filter(
    (item) => item.kind === 'diagnostic',
  ).length;
  if (count < MAX_DIAGNOSTICS) {
    return [...current, next];
  }
  const oldest = current.findIndex(
    (item) => item.kind === 'diagnostic',
  );
  return [
    ...current.slice(0, oldest),
    ...current.slice(oldest + 1),
    next,
  ];
}
