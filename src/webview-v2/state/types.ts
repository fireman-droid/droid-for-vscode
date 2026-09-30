import {
  type GitBranchDiffState,
  type HostToWebviewMessage,
} from '../../shared/bridgeMessages';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import {
  type AttachmentSummary,
  type EditAttachmentSummary,
  type ImageMediaType,
  type WorkspaceImageStatus,
} from '../../shared/protocol/attachments';
import { type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type {
  MissionControlResultMessage,
  MissionSnapshotMessage,
} from '../../shared/protocol/missionProtocol';
import { type SessionQueueState } from '../../shared/protocol/queueProtocol';
import {
  type SessionArchivedState,
  type SessionMissionSummary,
  type SessionSearchState,
} from '../../shared/protocol/sessions';
import {
  type McpAuthPhase,
  type ModelCatalogState,
  type SessionCommandsState,
  type SessionContextState,
  type SessionMcpState,
  type SessionPluginsState,
  type SessionSettingsState,
  type SessionSkillsState,
} from '../../shared/protocol/settings';
import { type SessionTokenUsageState } from '../../shared/protocol/tokenUsage';
import { type SessionTranscriptItem } from '../../shared/protocol/transcript';
import {
  type EditResendRejectReason,
  type RewindFileImpact,
  type TurnStatus,
} from '../../shared/protocol/turns';
import { type WorkspaceFilesStatus } from '../../shared/protocol/workspace';
import { type AttachmentImageEntry } from '../chat/attachments/attachmentImageStore';
import { type GitCommitFlowState } from '../review/gitCommitStore';
import { type ReviewUiState } from '../review/reviewStore';
import { type PendingInteraction } from '../chat/interactions/interactionStore';

export interface AssistantTurn {
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly activity?: 'working' | 'responding';
  readonly compacting?: boolean;
  readonly error?: string;
}

/** One resolved markdown image reference. */
export interface LocalImageEntry {
  readonly status: WorkspaceImageStatus;
  readonly mediaType: ImageMediaType | null;
  /** Pure base64 payload; empty unless status is 'ok'. */
  readonly data: string;
}

export interface AssistantWebviewState {
  readonly ide: IdeState;
  readonly sequence: number;
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly latestChanges: NonNullable<
    Extract<HostToWebviewMessage, { type: 'host.snapshot' }>['latestChanges']
  > | null;
  readonly connection: Extract<
    HostToWebviewMessage,
    { type: 'host.connection' }
  >['connection'];
  readonly turn: AssistantTurn | null;
  /** A local send remains owned by the composer until the Host confirms its identity. */
  readonly pendingTurnId: string | null;
  readonly sessions: Extract<HostToWebviewMessage, { type: 'host.snapshot' }>['sessions'];
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  /** Skills load lazily; 'idle' means not requested yet. */
  readonly skills: SessionSkillsState | { status: 'idle'; items: readonly [] };
  /** MCP servers load lazily; 'idle' means not requested yet. */
  readonly mcp: SessionMcpState | { status: 'idle'; items: readonly [] };
  /** Installed plugins load lazily; 'idle' means not requested yet. */
  readonly plugins: SessionPluginsState | { status: 'idle'; items: readonly [] };
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
  readonly attachmentImages: Readonly<Record<string, AttachmentImageEntry>>;
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
  readonly historyStatus:
    | Extract<HostToWebviewMessage, { type: 'host.snapshot' }>['historyStatus']
    | null;
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
      readonly type: 'host.batch';
      readonly messages: readonly StoreHostMessage[];
    }
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
