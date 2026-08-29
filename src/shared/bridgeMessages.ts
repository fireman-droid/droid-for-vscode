import {
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  type AskUserAnswer,
  type AskUserInteractionResult,
  type AskUserResultTranscriptItem,
  type AskUserRespondMessage,
  type PlanDocumentOpenMessage,
  type PlanDocumentStateMessage,
  type PermissionConfirmationKind,
  type PermissionRespondMessage,
} from './interactionProtocol';
import {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  TOOL_ACTIVITY_UPDATE_KINDS,
  type ToolActivityUpdateKind,
} from './toolActivity';
import type { SessionTokenUsageState } from './tokenUsage';
import type { SessionContextStats } from './contextState';
import { MAX_SESSION_TRANSCRIPT_ITEMS } from './transcriptLimits';
import type { BtwAskMessage, BtwDismissMessage, BtwPrepareMessage, BtwStopMessage, SessionBtwMessage } from './btwProtocol';
// Type-only on purpose (subagentProtocol imports shared bounds).
import type { SubagentActivityMessage, SubagentOpenMessage, SubagentPanelMessage } from './subagentProtocol';
import type {
  QueueAddMessage,
  QueueClearMessage,
  QueuePromoteMessage,
  QueueRemoveMessage,
  QueueResumeMessage,
  QueueStateMessage,
  QueueUpdateMessage,
  SessionQueueState,
} from './queueProtocol';
import type {
  CanvasFeedbackDraftMessage,
  PreviewInlineHtmlMessage,
} from './canvasProtocol';

export {
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SPEC_PLAN_LENGTH,
  PLAN_DOCUMENT_STATUSES,
  PERMISSION_CONFIRMATION_KINDS,
  type AskUserInteractionResult,
  type AskUserAnswer,
  type AskUserResultAnswer,
  type AskUserResultTranscriptItem,
  type AskUserRespondMessage,
  type PlanDocumentOpenMessage,
  type PlanDocumentStateMessage,
  type PlanDocumentStatus,
  type PermissionConfirmationKind,
  type PermissionRespondMessage,
} from './interactionProtocol';
export {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  TOOL_ACTIVITY_UPDATE_KINDS,
  type ToolActivityUpdateKind,
} from './toolActivity';
export {
  MAX_RENDERED_SESSION_IMAGES,
  MAX_SESSION_IMAGE_DATA_UNITS,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
} from './transcriptLimits';
export {
  BTW_ENTRY_STATES,
  BTW_STATUSES,
  EMPTY_SESSION_BTW_STATE,
  MAX_BTW_ANSWER_LENGTH,
  MAX_BTW_ENTRIES,
  MAX_BTW_MESSAGE_LENGTH,
  MAX_BTW_TEXT_LENGTH,
  type BtwAskMessage,
  type BtwDismissMessage,
  type BtwEntry,
  type BtwEntryState,
  type BtwStatus,
  type SessionBtwMessage,
  type SessionBtwState,
} from './btwProtocol';
// Type-only re-exports: `queueProtocol` imports runtime bounds from
// this module, so runtime constants and parsers (MAX_QUEUED_MESSAGES,
// parse*) must be imported from './queueProtocol' directly.
export type {
  QueueAddMessage,
  QueueClearMessage,
  QueuedMessageSummary,
  QueuePausedReason,
  QueuePromoteMessage,
  QueueRemoveMessage,
  QueueResumeMessage,
  QueueStateMessage,
  QueueUpdateMessage,
  SessionQueueState,
} from './queueProtocol';
export { MAX_TOOL_OUTPUT_TAIL_LENGTH } from './toolOutput';
export {
  GIT_BRANCH_DIFF_UNAVAILABLE_REASONS, GIT_FILE_STATUSES,
  GIT_UNAVAILABLE_REASONS,
  MAX_GIT_BRANCH_DIFF_FILES, MAX_GIT_BRANCH_LENGTH,
  MAX_GIT_COMMIT_ERROR_LENGTH,
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
  MAX_GIT_COMMIT_PATHS,
  MAX_GIT_COMMIT_SUBJECT_LENGTH,
  MAX_GIT_STATUS_FILES,
  isGitCommitHashEcho,
  type GitBranchDiffFile,
  type GitBranchDiffMessage,
  type GitBranchDiffState,
  type GitBranchDiffUnavailableReason,
  type GitCommitRequestMessage,
  type GitCommitResultMessage,
  type GitFileStatus,
  type GitRequestBranchDiffMessage,
  type GitRequestStatusMessage,
  type GitStatusMessage,
  type GitStatusFile,
  type GitUnavailableReason,
} from './gitCommitFlow';
import type {
  GitBranchDiffMessage as GitBranchDiffContract,
  GitCommitRequestMessage as GitCommitRequestContract,
  GitCommitResultMessage as GitCommitResultContract,
  GitRequestBranchDiffMessage as GitRequestBranchDiffContract,
  GitRequestStatusMessage as GitRequestStatusContract, GitStatusMessage as GitStatusContract,
} from './gitCommitFlow';
// Type-only on purpose: the runtime dependency points the other way
// (customModelsProtocol imports shared model bounds from here).
import type { CustomModelsHostMessage, CustomModelsWebviewMessage } from './customModelsProtocol';
import type { ChangesUpdateMessage } from './changesProtocol';
import type {
  MissionHostMessage,
  MissionWebviewMessage,
} from './missionProtocol';
import type {
  ReviewHostMessage,
  ReviewWebviewMessage,
} from './reviewProtocol';
import type {
  AttachmentAddImageMessage,
  AttachmentAddPdfMessage,
  AttachmentAddRemoteImageMessage,
  AttachmentReadImageMessage,
  AttachmentStage,
  SessionAttachmentImageDataMessage,
} from './attachmentImageProtocol';
import type {
  AttachmentAddTextFileMessage,
  AttachmentAddUrisMessage,
} from './attachmentDropProtocol';
export {
  MAX_ATTACHMENT_IMAGE_BASE64_LENGTH,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_PDF_BASE64_LENGTH,
  MAX_ATTACHMENT_PDF_BYTES,
  MAX_ATTACHMENT_REMOTE_URL_LENGTH,
  type AttachmentAddImageMessage,
  type AttachmentAddPdfMessage,
  type AttachmentAddRemoteImageMessage,
  type AttachmentReadImageMessage,
  type AttachmentStage,
  type SessionAttachmentImageDataMessage,
} from './attachmentImageProtocol';
export {
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_LENGTH,
  type AttachmentAddTextFileMessage,
  type AttachmentAddUrisMessage,
} from './attachmentDropProtocol';

// Version 3: git commit flow messages (git.requestStatus/git.commit
// W→H, git.status/git.commitResult H→W).
// Version 4: thinking.delta/thinking.complete carry segmentIndex so
// interleaved thinking segments render as separate transcript rows.
// Version 5: read-only plugins panel messages (plugins.refresh W→H,
// session.plugins H→W).
// Version 6: queued-messages contract (queue.add/update/remove/
// resume/clear W→H, queue.state H→W, snapshot `queue` field).
// Version 8: theme preference pair (ui.theme.set W→H, ui.theme H→W).
// Version 9: BYOK custom-models management (customModels.refresh/
// save/delete W→H, customModels.state H→W; customModelsProtocol.ts).
// Version 10: live changes ledger — `turn.changes` is replaced by
// the streaming `changes.update` (H→W; changesProtocol.ts).
// Version 11: subagent panel — openTranscript/stop/panel W→H,
// transcript/activity H→W; v12–v16; v17 custom-model discovery/import;
// v18 turn-scoped file review; v19 truthful last-call Context window;
// v20 legacy activity; v21 introduces honest cwd-scoped Agent
// activity (`agentActivity.*`; teamProtocol.ts); v22 turn-scopes the
// Git flow and restores latest-turn commit state after Reload; v23
// makes Agent Activity live-only and adds editor-tab open/stop; v24
// retires that custom Agent contract in favor of official Mission and
// Task/Subagent surfaces; v25 adds the bounded Mission setup, control,
// and snapshot contracts; v26 adds Provider-first custom-model management;
// v27 adds bounded semantic trails to inline Subagent activity; v28
// docks AskUser/ExitSpecMode above the Composer, adds durable AskUser
// results, and synchronizes editable Plan documents with Cursor; v29
// adds staged-image preview, replacement, and public HTTPS ingestion;
// v30 adds Host-owned sequential Diff review and safe Turn restore.
export const BRIDGE_PROTOCOL_VERSION = 30 as const;
export const MAX_TURN_TEXT_LENGTH = 200_000;
export const MAX_ASSISTANT_TEXT_LENGTH = 200_000;
export const MAX_THINKING_DELTA_LENGTH = 16_384;
export const MAX_THINKING_TEXT_LENGTH = 512_000;
export const MAX_TOOL_NAME_LENGTH = MAX_PERMISSION_TOOL_NAME_LENGTH;
export const MAX_TOOL_ACTIVITIES_PER_TURN = 100;
export const MAX_SESSION_CATALOG_ITEMS = 50;
export const MAX_SESSION_TITLE_LENGTH = 256;
/** Bounds for the worktree annotation on catalog session rows. */
export const MAX_WORKTREE_BRANCH_LENGTH = 512;
export const MAX_WORKTREE_PATH_LENGTH = 1024;
export const MAX_MODEL_ID_LENGTH = 256;
export const MAX_MODEL_DISPLAY_NAME_LENGTH = 128;
export const MAX_MODEL_CATALOG_ITEMS = 100;
export const MAX_SKILL_ITEMS = 200;
export const MAX_SKILL_NAME_LENGTH = 128;
export const MAX_SKILL_DESCRIPTION_LENGTH = 512;
export const MAX_COMMAND_ITEMS = 200;
export const MAX_COMMAND_NAME_LENGTH = 64;
export const MAX_COMMAND_DESCRIPTION_LENGTH = 512;
export const MAX_COMMAND_ARGUMENT_HINT_LENGTH = 128;
export const MAX_RECENT_COMMANDS = 8;
export const MAX_TOOL_FILE_PATH_LENGTH = 512;
export const MAX_TOOL_DETAIL_LENGTH = 4_000;
export const MAX_TOOL_TARGET_LENGTH = 512;
/**
 * Longest tool_result error excerpt carried on a failed tool row so
 * the user can see why the tool failed (e.g. "Tool execution
 * cancelled by user").
 */
export const MAX_TOOL_ERROR_MESSAGE_LENGTH = 1_000;

/**
 * Extra human-readable context for a tool activity: the shell command
 * an execute tool ran, or the plan text a task-plan tool wrote.
 */
export const TOOL_DETAIL_KINDS = ['command', 'plan'] as const;
export type ToolDetailKind = (typeof TOOL_DETAIL_KINDS)[number];
export const MAX_MCP_SERVERS = 100;
export const MAX_MCP_TOOLS_PER_SERVER = 200;
export const MAX_MCP_NAME_LENGTH = 128;
export const MAX_MCP_TOOL_DESCRIPTION_LENGTH = 512;
export const MAX_MCP_COMMAND_LENGTH = 1024;
export const MAX_MCP_URL_LENGTH = 2048;
export const MAX_MCP_ARGS = 24;
export const MAX_MCP_ARG_LENGTH = 512;

export const MCP_SERVER_TYPES = ['stdio', 'http', 'sse'] as const;
export type McpServerType = (typeof MCP_SERVER_TYPES)[number];

export const MAX_PLUGIN_ITEMS = 100;
export const MAX_PLUGIN_ID_LENGTH = 128;
export const MAX_PLUGIN_VERSION_LENGTH = 64;
/** Upper bound accepted for the daemon-reported marketplace count. */
export const MAX_PLUGIN_MARKETPLACE_COUNT = 1_000;

/**
 * Install scopes the panel displays. Mirrors the droid CLI's
 * `plugin install --scope user|project` surface; rows with any other
 * scope string are dropped at projection (fail closed).
 */
export const PLUGIN_SCOPES = ['user', 'project'] as const;
export type PluginScope = (typeof PLUGIN_SCOPES)[number];

export const CONNECTION_STATUSES = [
  'idle',
  'connecting',
  'connected',
  'unavailable',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const TURN_STATUSES = [
  'idle',
  'submitting',
  'streaming',
  'stopping',
  'completed',
  'interrupted',
  'failed',
] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export const TOOL_ACTIVITY_STATUSES = [
  'running',
  'completed',
  'failed',
] as const;
export type ToolActivityStatus =
  (typeof TOOL_ACTIVITY_STATUSES)[number];

export const DIAGNOSTIC_SEVERITIES = [
  'info',
  'warning',
  'error',
] as const;
export type DiagnosticSeverity =
  (typeof DIAGNOSTIC_SEVERITIES)[number];

export const SESSION_CATALOG_STATUSES = [
  'idle',
  'loading',
  'ready',
  'error',
] as const;
export type SessionCatalogStatus =
  (typeof SESSION_CATALOG_STATUSES)[number];

export const SESSION_HISTORY_STATUSES = [
  'complete',
  'partial',
  'unavailable',
] as const;
export type SessionHistoryStatus =
  (typeof SESSION_HISTORY_STATUSES)[number];

export const TRANSCRIPT_THINKING_STATUSES = [
  'active',
  'complete',
  'stopping',
  'stopped',
] as const;
export type TranscriptThinkingStatus =
  (typeof TRANSCRIPT_THINKING_STATUSES)[number];

export const TRANSCRIPT_TOOL_STATUSES = [
  ...TOOL_ACTIVITY_STATUSES,
  'stopping',
  'stopped',
] as const;
export type TranscriptToolStatus =
  (typeof TRANSCRIPT_TOOL_STATUSES)[number];

export const SESSION_INTERACTION_MODES = [
  'auto',
  'spec',
  'mission',
] as const;
export type SessionInteractionMode =
  (typeof SESSION_INTERACTION_MODES)[number];

/**
 * Lifecycle of one Task-delegated subagent, mirroring the SDK's
 * durable invocation ledger (`TaskInvocationStatus`).
 */
export const SUBAGENT_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type SubagentStatus = (typeof SUBAGENT_STATUSES)[number];

/** Longest subagent type name shown on a delegated Task row. */
export const MAX_SUBAGENT_TYPE_LENGTH = 64;
/** Longest subagent description shown under a delegated Task row. */
export const MAX_SUBAGENT_DESCRIPTION_LENGTH = 512;

/**
 * Marks an Execute tool call the CLI launched as a detached
 * background process (`fireAndForget: true` in the tool input;
 * probed on CLI 0.193.0). Read fail-soft: the field is absent from
 * the SDK type surface, so a missing or malformed value simply means
 * no hint. The GUI never gets a process handle — this is display
 * metadata only (background-process design §2.3 keeps kill
 * fail-closed).
 */
export interface ToolBackgroundHint {
  readonly fireAndForget: boolean;
}

/**
 * Summary of the subagent one Task tool call delegated to. Data
 * comes from the `child_session_available` notification (live) and
 * `loadSession().subagentInvocations` (final/history); the child
 * session id stays in the host and never crosses the bridge.
 */
export interface ToolSubagentSummary {
  readonly type: string;
  readonly description: string;
  /** Absent until the SDK reports a lifecycle status. */
  readonly status?: SubagentStatus;
  /** Tools the subagent used; only when the SDK reported it. */
  readonly toolUseCount?: number;
  /** Subagent run duration; only when the SDK reported it. */
  readonly durationMs?: number;
}

/** Mission lifecycle states, mirroring the SDK `MissionState` enum. */
export const MISSION_STATES = [
  'planning',
  'awaiting_input',
  'initializing',
  'running',
  'paused',
  'orchestrator_turn',
  'completed',
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** Role of a session in a mission decomposition. */
export const MISSION_SESSION_ROLES = [
  'orchestrator',
  'worker',
] as const;
export type MissionSessionRole =
  (typeof MISSION_SESSION_ROLES)[number];

/**
 * Read-only mission identity of the active session, projected once
 * per history load from `loadSession()` (`mission.state`,
 * `decompSessionType`). Display only: the public SDK exposes no
 * mission control surface (no pause/resume/start RPC).
 */
export interface SessionMissionSummary {
  readonly state: MissionState | null;
  readonly role: MissionSessionRole | null;
}

export const SESSION_AUTONOMY_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
] as const;
export type SessionAutonomyLevel =
  (typeof SESSION_AUTONOMY_LEVELS)[number];

export const SESSION_REASONING_EFFORTS = [
  'none',
  'dynamic',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type SessionReasoningEffort =
  (typeof SESSION_REASONING_EFFORTS)[number];

export type {
  SessionContextStats,
  SessionContextUnavailableReason,
} from './contextState';

export interface WebviewReadyMessage {
  readonly type: 'webview.ready';
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
}

export const WEBVIEW_DIAGNOSTIC_KINDS = [
  'boot-ok',
  'render-ok',
  'boot-timeout',
  'handshake-timeout',
  'error',
  'unhandledrejection',
  'perf-longtask',
  'perf-batch',
] as const;
export type WebviewDiagnosticKind =
  (typeof WEBVIEW_DIAGNOSTIC_KINDS)[number];
export const MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH = 2_048;

/**
 * Boot and failure beacons from the webview. They exist so a blank or
 * frozen webview leaves a trace in the local diagnostics log instead of
 * failing silently.
 */
export interface WebviewDiagnosticMessage {
  readonly type: 'webview.diagnostic';
  readonly kind: WebviewDiagnosticKind;
  readonly detail: string;
}

export interface TurnSendMessage {
  readonly type: 'turn.send';
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
}

export interface TurnStopMessage {
  readonly type: 'turn.stop';
  readonly sessionId: string;
  readonly turnId: string;
}

/**
 * Rewinds the session to the user message identified by `messageId`
 * (SDK message id), then resends `text` as a fresh turn in the forked
 * session.
 */
export interface TurnEditResendMessage {
  readonly type: 'turn.editResend';
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly text: string;
  /**
   * When true, the rewind also restores files Droid changed after the
   * anchor message and deletes files it created since then.
   */
  readonly restoreFiles?: boolean;
}

/**
 * Asks how rewinding to `messageId` would affect workspace files.
 * The host answers with a `rewind.info` message carrying counts.
 */
export interface RewindInfoRequestMessage {
  readonly type: 'rewind.info';
  readonly sessionId: string;
  readonly messageId: string;
}

export interface RuntimeRetryMessage {
  readonly type: 'runtime.retry';
  readonly sessionId: string | null;
}

export interface SessionsRefreshMessage {
  readonly type: 'sessions.refresh';
}

export interface SessionSelectMessage {
  readonly type: 'session.select';
  readonly sessionId: string;
}

export interface SessionNewMessage {
  readonly type: 'session.new';
}

/**
 * Creates a new session inside a daemon-managed git worktree
 * (`sessions.create({ worktree: true })`). Carries no branch name:
 * probe evidence (artifacts/probe-worktree-create.mjs) shows the
 * daemon owns branch and directory naming (`<currentBranch>-wt`, an
 * 8-char session-id suffix on collision) and its RPC accepts none.
 * Only actionable when the host snapshot advertised
 * `worktreeCreateAvailable`; the host re-checks and answers with a
 * session diagnostic otherwise (fail closed).
 */
export interface WorktreeCreateSessionMessage {
  readonly type: 'worktree.createSession';
}

/** Renames the currently active session. */
export interface SessionRenameMessage {
  readonly type: 'session.rename';
  readonly sessionId: string;
  readonly title: string;
}

/**
 * Marks or unmarks a catalog session as favorite. Favorites persist
 * through the droid CLI's private `.favorites` file (there is no
 * official write API); the readback loop is the public
 * `listSessions()` `isFavorite` flag.
 */
export interface SessionFavoriteMessage {
  readonly type: 'session.favorite';
  readonly sessionId: string;
  readonly favorite: boolean;
}

/**
 * Archives a non-active catalog session through the local droid
 * daemon (`daemon.archive_session`). Archived sessions leave the
 * regular catalog and appear in the drawer's Archived section.
 */
export interface SessionArchiveMessage {
  readonly type: 'session.archive';
  readonly sessionId: string;
}

/**
 * Restores an archived session through the local droid daemon
 * (`daemon.unarchive_session`) so it reappears in the catalog.
 */
export interface SessionUnarchiveMessage {
  readonly type: 'session.unarchive';
  readonly sessionId: string;
}

/**
 * Asks the host for the archived sessions of the current workspace.
 * The host answers with a `session.archived` state message.
 */
export interface SessionsArchivedRefreshMessage {
  readonly type: 'sessions.archivedRefresh';
}

/** Longest accepted cross-session content search query. */
export const MAX_SESSION_SEARCH_QUERY_LENGTH = 256;
/** Most sessions returned for one content search. */
export const MAX_SESSION_SEARCH_RESULTS = 20;
/** Longest snippet excerpt shown for one search hit. */
export const MAX_SESSION_SEARCH_SNIPPET_LENGTH = 240;
/** Most archived sessions listed in the drawer. */
export const MAX_ARCHIVED_SESSION_ITEMS = 50;

/**
 * Searches message content across local sessions through the daemon
 * (`daemon.search_sessions`). Results return via a
 * `session.searchResults` state message.
 */
export interface SessionSearchMessage {
  readonly type: 'session.search';
  readonly query: string;
}

export interface SessionContextRefreshMessage {
  readonly type: 'session.context.refresh';
  readonly sessionId: string;
}

/**
 * Compacts the active session's context: Droid summarizes older
 * messages into a continuation session and the host adopts it.
 */
export interface SessionCompactMessage {
  readonly type: 'session.compact';
  readonly sessionId: string;
}

/**
 * Forks the active session: Droid copies the conversation into a new
 * session that the host adopts, leaving the original untouched.
 */
export interface SessionForkMessage {
  readonly type: 'session.fork';
  readonly sessionId: string;
}

/**
 * Asks the host to open a native diff (or the file itself when no
 * comparison base exists) for a workspace-relative file path that a
 * tool activity reported.
 */
export interface FileOpenDiffMessage {
  readonly type: 'file.openDiff';
  readonly sessionId: string;
  readonly turnId: string;
  readonly path: string;
}

/**
 * File extensions eligible for the sandboxed prototype preview panel.
 * Only self-contained HTML documents are previewable; build-dependent
 * sources (.tsx/.jsx/.vue) are deliberately excluded so the UI never
 * offers a preview it cannot render.
 */
export const PREVIEWABLE_FILE_EXTENSIONS = ['.html', '.htm'] as const;

/**
 * Asks the host to open the sandboxed prototype preview panel for a
 * workspace-relative `.html`/`.htm` file that a tool activity or turn
 * changes summary reported. The host re-validates containment and the
 * extension whitelist before rendering.
 */
export interface FilePreviewMessage {
  readonly type: 'file.preview';
  readonly sessionId: string;
  readonly path: string;
}

/**
 * Asks the host to reveal the read-only terminal mirror of the
 * active session's execute-command output (native-terminal design
 * slice A), creating the terminal lazily on first use. The mirrored
 * output itself never crosses the bridge: the host feeds the
 * pseudoterminal straight from runtime events, so no H→W reply
 * exists for this message.
 */
export interface TerminalOpenMirrorMessage {
  readonly type: 'terminal.openMirror';
  readonly sessionId: string;
}

/** Longest accepted path in a `workspace.openPath` request. */
export const MAX_OPEN_PATH_LENGTH = 1024;
/** Largest accepted 1-based line or column in an open request. */
export const MAX_OPEN_PATH_POSITION = 1_000_000;

/**
 * Asks the host to open a path the user clicked in transcript
 * markdown. Absolute paths outside the workspace are allowed because
 * only an explicit user click produces this message; the host still
 * verifies the path exists before opening it.
 */
export interface WorkspaceOpenPathMessage {
  readonly type: 'workspace.openPath';
  readonly sessionId: string;
  readonly path: string;
  /** 1-based line to reveal when the target opens as text. */
  readonly line?: number;
  /** 1-based column; only accepted together with `line`. */
  readonly column?: number;
}

/** Requests the current Droid skill catalog for the session. */
export interface SkillsRefreshMessage {
  readonly type: 'skills.refresh';
  readonly sessionId: string;
}

/**
 * Requests the installed Droid plugin list and marketplace count for
 * the session. Served by the host's daemon sidecar (`plugins` and
 * `marketplaces` are daemon-only resources), not the session runtime.
 */
export interface PluginsRefreshMessage {
  readonly type: 'plugins.refresh';
  readonly sessionId: string;
}

/** Enables or disables a Droid skill by name. */
export interface SkillToggleMessage {
  readonly type: 'skill.toggle';
  readonly sessionId: string;
  readonly name: string;
  readonly disabled: boolean;
}

/** Requests the custom Droid command catalog for the session. */
export interface CommandsRefreshMessage {
  readonly type: 'commands.refresh';
  readonly sessionId: string;
}

/**
 * Which staging area an attachment operation targets: the composer
 * staging area (default, field absent) or the per-message edit
 * staging area opened by `editStage.begin`.
 */
/**
 * Asks the host to open a native file picker and stage the chosen
 * files as pending attachments for the next prompt.
 */
export interface AttachmentPickMessage {
  readonly type: 'attachment.pick';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/** Stages the active editor document as a pending text attachment. */
export interface AttachmentAddEditorMessage {
  readonly type: 'attachment.addEditor';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/** Stages the active editor selection as a pending text attachment. */
export interface AttachmentAddSelectionMessage {
  readonly type: 'attachment.addSelection';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/** Stages current workspace diagnostics as a pending text attachment. */
export interface AttachmentAddProblemsMessage {
  readonly type: 'attachment.addProblems';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/**
 * Stages uncommitted git changes (working tree vs HEAD) as a pending
 * text attachment.
 */
export interface AttachmentAddGitChangesMessage {
  readonly type: 'attachment.addGitChanges';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/**
 * Longest accepted base64 payload for one dropped or pasted image:
 * the base64 encoding of the 4 MB original-file cap shared with the
 * host file picker (`MAX_IMAGE_ATTACHMENT_BYTES`).
 */

/**
 * Stages one image dropped or pasted into the composer as a pending
 * attachment. This is the only webview-to-host message carrying
 * binary content; both validators bound its media type, name, and
 * base64 length.
 */
/**
 * Stages files dropped onto the composer from an editor explorer drag
 * (`text/uri-list`). The host resolves each `file://` URI, keeps only
 * files inside the workspace, and reads them through the same reader
 * as the attach-files picker.
 */
/** Removes one staged attachment by its host-assigned id. */
export interface AttachmentRemoveMessage {
  readonly type: 'attachment.remove';
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly stage?: AttachmentStage;
}

/** Longest accepted workspace file search query. */
export const MAX_FILE_SEARCH_QUERY_LENGTH = 128;
/** Most file paths returned for one workspace search. */
export const MAX_FILE_SEARCH_RESULTS = 20;

/**
 * Asks the host to match workspace files against a Composer `@`
 * mention query. Results return via `workspace.files` with the same
 * request id.
 */
export interface WorkspaceSearchFilesMessage {
  readonly type: 'workspace.searchFiles';
  readonly sessionId: string;
  readonly requestId: string;
  readonly query: string;
}

/** Longest accepted local image path in a markdown reference. */
export const MAX_IMAGE_PATH_LENGTH = 1024;

/**
 * Asks the host to read a workspace-local image referenced by
 * transcript markdown so the webview can display it. The reply is a
 * `workspace.imageData` message keyed by the same path.
 */
export interface WorkspaceReadImageMessage {
  readonly type: 'workspace.readImage';
  readonly sessionId: string;
  readonly path: string;
}

/**
 * Stages one workspace file, named by its validated relative path, as
 * a pending attachment for the next prompt.
 */
export interface AttachmentAddPathMessage {
  readonly type: 'attachment.addPath';
  readonly sessionId: string;
  readonly path: string;
  readonly stage?: AttachmentStage;
}

/**
 * Enters edit mode for one sent user message: the host initializes
 * the edit staging area, prefilled with the retained payloads of the
 * attachments that message was sent with.
 */
export interface EditStageBeginMessage {
  readonly type: 'editStage.begin';
  readonly sessionId: string;
  readonly messageId: string;
}

/** Leaves edit mode: the host discards the edit staging area. */
export interface EditStageCancelMessage {
  readonly type: 'editStage.cancel';
  readonly sessionId: string;
}

/** Requests the current MCP server and tool catalog for the session. */
export interface McpRefreshMessage {
  readonly type: 'mcp.refresh';
  readonly sessionId: string;
}

/** Enables or disables an MCP server by name. */
export interface McpServerToggleMessage {
  readonly type: 'mcp.server.toggle';
  readonly sessionId: string;
  readonly name: string;
  readonly enabled: boolean;
}

/**
 * Registers a new MCP server at the user settings level. Stdio
 * servers carry a launch command with optional arguments; http and
 * sse servers carry an endpoint URL.
 */
export interface McpServerAddMessage {
  readonly type: 'mcp.server.add';
  readonly sessionId: string;
  readonly name: string;
  readonly serverType: McpServerType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
}

/** Removes an MCP server by name at the user settings level. */
export interface McpServerRemoveMessage {
  readonly type: 'mcp.server.remove';
  readonly sessionId: string;
  readonly name: string;
}

/**
 * Starts browser OAuth authentication for an MCP server. The host
 * reports progress via `mcp.auth` messages.
 */
export interface McpServerAuthenticateMessage {
  readonly type: 'mcp.server.authenticate';
  readonly sessionId: string;
  readonly name: string;
}

/**
 * UI theme preference for the DroidVisX shell. 'auto' follows the
 * editor's current color theme kind; 'light'/'dark' pin the shell.
 * Persisted host-side as the `droidvisx.theme` user setting.
 */
export const THEME_PREFERENCES = ['auto', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Webview → Host: persist a new theme preference. Handled by the
 * view provider (writes user settings); never reaches the session
 * controller.
 */
export interface UiThemeSetMessage {
  readonly type: 'ui.theme.set';
  readonly preference: ThemePreference;
}

/**
 * Host → Webview: current preference plus its editor-resolved theme.
 * Sent on ready and preference/editor-theme changes. Carries no
 * `sequence` on purpose: it bypasses the
 * session store (which enforces one monotonic sequence across all
 * controller-emitted messages) and is applied directly by the shell.
 */
export interface UiThemeMessage {
  readonly type: 'ui.theme';
  readonly preference: ThemePreference;
  readonly resolved: 'light' | 'dark';
}
export type SessionSettingUpdateMessage =
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'interactionMode';
      readonly value: SessionInteractionMode;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'modelId';
      readonly value: string;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'reasoningEffort';
      readonly value: SessionReasoningEffort;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      readonly field: 'autonomyLevel';
      readonly value: SessionAutonomyLevel;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      /** Model used while drafting in Spec mode; null resets to the session model. */
      readonly field: 'specModeModelId';
      readonly value: string | null;
    }
  | {
      readonly type: 'session.setting.update';
      readonly sessionId: string;
      /** Reasoning effort while drafting in Spec mode; null resets to the model default. */
      readonly field: 'specModeReasoningEffort';
      readonly value: SessionReasoningEffort | null;
    };

export type WebviewToHostMessage =
  | WebviewReadyMessage
  | WebviewDiagnosticMessage
  | TurnSendMessage
  | TurnStopMessage
  | TurnEditResendMessage
  | RuntimeRetryMessage
  | PermissionRespondMessage
  | AskUserRespondMessage
  | PlanDocumentOpenMessage
  | SessionsRefreshMessage
  | SessionSelectMessage
  | SessionNewMessage
  | WorktreeCreateSessionMessage
  | SessionRenameMessage
  | SessionFavoriteMessage
  | SessionArchiveMessage
  | SessionUnarchiveMessage
  | SessionsArchivedRefreshMessage
  | SessionSearchMessage
  | SessionContextRefreshMessage
  | SessionCompactMessage
  | SessionForkMessage
  | FileOpenDiffMessage
  | FilePreviewMessage
  | PreviewInlineHtmlMessage
  | GitRequestStatusContract
  | GitRequestBranchDiffContract
  | GitCommitRequestContract
  | TerminalOpenMirrorMessage
  | WorkspaceOpenPathMessage
  | SkillsRefreshMessage
  | SkillToggleMessage
  | PluginsRefreshMessage
  | CommandsRefreshMessage
  | McpRefreshMessage
  | McpServerToggleMessage
  | McpServerAddMessage
  | McpServerRemoveMessage
  | McpServerAuthenticateMessage
  | AttachmentPickMessage
  | AttachmentAddEditorMessage
  | AttachmentAddSelectionMessage
  | AttachmentAddProblemsMessage
  | AttachmentAddGitChangesMessage
  | AttachmentAddImageMessage
  | AttachmentAddPdfMessage
  | AttachmentAddRemoteImageMessage
  | AttachmentReadImageMessage
  | AttachmentAddUrisMessage
  | AttachmentAddTextFileMessage
  | AttachmentRemoveMessage
  | AttachmentAddPathMessage
  | EditStageBeginMessage
  | EditStageCancelMessage
  | WorkspaceSearchFilesMessage
  | WorkspaceReadImageMessage
  | RewindInfoRequestMessage
  | SessionSettingUpdateMessage
  | UiThemeSetMessage
  | CustomModelsWebviewMessage
  | BtwPrepareMessage | BtwAskMessage
  | BtwDismissMessage | BtwStopMessage
  | SubagentPanelMessage
  | SubagentOpenMessage
  | QueueAddMessage
  | QueueUpdateMessage
  | QueueRemoveMessage
  | QueuePromoteMessage
  | QueueResumeMessage
  | QueueClearMessage
  | MissionWebviewMessage
  | ReviewWebviewMessage;

export interface ConnectionState {
  readonly status: ConnectionStatus;
  readonly message?: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly modifiedTime: string;
  readonly active: boolean;
  /** True when the CLI's `.favorites` file lists this session. */
  readonly isFavorite: boolean;
  /**
   * Present when the session catalog marks this session as part of a
   * mission decomposition (`decompSessionType`).
   */
  readonly missionRole?: MissionSessionRole;
  /**
   * Present when the session runs in a daemon-managed git worktree.
   * `branch` may be '' when git branch recovery failed; the row then
   * shows the worktree marker without a branch name.
   */
  readonly worktree?: SessionWorktreeInfo;
  /**
   * True when a turn of this session is still running on the daemon
   * (detached from this window, driven by another window, or by the
   * CLI). Hosts omit the flag instead of sending false; the drawer
   * row shows a quiet spinner while it is true. Updates stream via
   * `session.running`.
   */
  readonly running?: boolean;
}

/** Worktree binding of a catalog session (host-recovered from git). */
export interface SessionWorktreeInfo {
  readonly branch: string;
  readonly path: string;
}

export interface SessionCatalogState {
  readonly status: SessionCatalogStatus;
  readonly items: readonly SessionSummary[];
  readonly message?: string;
}

/** One archived session as reported by the daemon list. */
export interface ArchivedSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string;
  readonly archivedTime: string;
}

export type SessionArchivedState =
  | {
      readonly status: 'loading';
      readonly items: readonly ArchivedSessionSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly ArchivedSessionSummary[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly ArchivedSessionSummary[];
      readonly message: string;
    };

/** One session matched by a cross-session content search. */
export interface SessionSearchHit {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string | null;
  readonly snippet: string | null;
}

export type SessionSearchState =
  | {
      readonly status: 'ready';
      readonly query: string;
      readonly items: readonly SessionSearchHit[];
    }
  | {
      readonly status: 'error';
      readonly query: string;
      readonly items: readonly [];
      readonly message: string;
    };

export interface ConfirmedSessionSettings {
  readonly interactionMode: SessionInteractionMode;
  readonly modelId: string;
  readonly reasoningEffort: SessionReasoningEffort;
  readonly autonomyLevel: SessionAutonomyLevel;
  /** Spec-mode drafting model; null when the session model is used. */
  readonly specModeModelId: string | null;
  /** Spec-mode reasoning effort; null when the model default is used. */
  readonly specModeReasoningEffort: SessionReasoningEffort | null;
}

export type SessionSettingsState =
  | {
      readonly status: 'loading';
      readonly value: ConfirmedSessionSettings | null;
    }
  | {
      readonly status: 'ready';
      readonly value: ConfirmedSessionSettings;
    }
  | {
      readonly status: 'updating';
      readonly value: ConfirmedSessionSettings;
    }
  | {
      readonly status: 'error';
      readonly value: ConfirmedSessionSettings | null;
      readonly message: string;
    };

export type SessionContextState =
  | {
      readonly status: 'loading';
      readonly value: SessionContextStats | null;
    }
  | {
      readonly status: 'ready';
      readonly value: SessionContextStats;
    }
  | {
      readonly status: 'error';
      readonly value: SessionContextStats | null;
      readonly message: string;
    };

export interface ModelCatalogItem {
  readonly id: string;
  readonly displayName: string;
  readonly supportedReasoningEfforts: readonly SessionReasoningEffort[];
}

export type ModelCatalogState =
  | {
      readonly status: 'loading';
      readonly items: readonly [];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly ModelCatalogItem[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly [];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

export const SKILL_LOCATIONS = [
  'project',
  'personal',
  'builtin',
  'automation',
] as const;
export type SkillLocation = (typeof SKILL_LOCATIONS)[number];

export interface SkillSummary {
  readonly name: string;
  readonly description: string | null;
  readonly location: SkillLocation;
  readonly enabled: boolean;
  readonly userInvocable: boolean;
}

export type SessionSkillsState =
  | {
      readonly status: 'loading';
      readonly items: readonly SkillSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly SkillSummary[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly SkillSummary[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

/**
 * One installed Droid plugin, projected from the daemon's
 * `plugins.listInstalled` RPC. Display metadata only: install paths
 * and timestamps stay on the host.
 */
export interface PluginSummary {
  readonly id: string;
  readonly scope: PluginScope;
  /** Short content hash of the installed plugin version. */
  readonly version: string;
  /** Whether the plugin is currently enabled for new sessions. */
  readonly active: boolean;
}

/**
 * Read-only plugins panel state. `marketplaceCount` is the number of
 * registered plugin marketplaces (`marketplaces.list`); it only
 * exists on `ready` because the two RPCs resolve together.
 */
export type SessionPluginsState =
  | {
      readonly status: 'loading';
      readonly items: readonly PluginSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly PluginSummary[];
      readonly marketplaceCount: number;
    }
  | {
      readonly status: 'error';
      readonly items: readonly PluginSummary[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

/**
 * One custom slash command discovered from `.factory/commands`.
 * Names are file-slug identifiers; hints and descriptions come from
 * the command file's frontmatter.
 */
export interface CommandSummary {
  readonly name: string;
  readonly description: string | null;
  readonly argumentHint: string | null;
  readonly isExecutable: boolean;
}

export type SessionCommandsState =
  | {
      readonly status: 'loading';
      readonly items: readonly CommandSummary[];
      readonly recent: readonly string[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly CommandSummary[];
      readonly recent: readonly string[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly CommandSummary[];
      readonly recent: readonly string[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly recent: readonly [];
      readonly message: string;
    };

export const MAX_PENDING_ATTACHMENTS = 8;
/** Most file URIs accepted from one drop onto the composer. */
export const MAX_ATTACHMENT_URI_COUNT = MAX_PENDING_ATTACHMENTS;
export const MAX_ATTACHMENT_NAME_LENGTH = 128;

export const ATTACHMENT_KINDS = [
  'image',
  'pdf',
  'text',
  'editor',
  'selection',
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * Safe metadata about one staged attachment. Content bytes stay on the
 * host; the webview only renders and removes chips.
 */
export interface AttachmentSummary {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
}

export const MCP_SERVER_STATUSES = [
  'connecting',
  'connected',
  'disconnected',
  'failed',
  'disabled',
] as const;
export type McpServerStatus = (typeof MCP_SERVER_STATUSES)[number];

export interface McpToolSummary {
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly readOnly: boolean;
}

export interface McpServerSummary {
  readonly name: string;
  readonly status: McpServerStatus;
  readonly toolCount: number | null;
  readonly requiresAuth: boolean;
  /**
   * True when Droid already holds OAuth tokens for this server. A
   * server needs authentication only when `requiresAuth` is true and
   * this is false; dropping this field made signed-in servers render
   * a misleading "needs auth" badge.
   */
  readonly hasAuthTokens: boolean;
  readonly tools: readonly McpToolSummary[];
}

export const MCP_AUTH_PHASES = [
  'started',
  'browser',
  'success',
  'cancelled',
  'failed',
  'error',
] as const;
export type McpAuthPhase = (typeof MCP_AUTH_PHASES)[number];

/** Longest accepted `mcp.auth` progress message. */
export const MAX_MCP_AUTH_MESSAGE_LENGTH = 256;

export type SessionMcpState =
  | {
      readonly status: 'loading';
      readonly items: readonly McpServerSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly McpServerSummary[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly McpServerSummary[];
      readonly message: string;
    }
  | {
      readonly status: 'unsupported';
      readonly items: readonly [];
      readonly message: string;
    };

/**
 * Metadata about one attachment a sent user message carried. Only
 * metadata crosses the bridge; image attachments are represented by
 * their own image transcript items instead of entries here.
 */
export interface SentAttachmentSummary {
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeBytes: number;
}

export interface UserTranscriptItem {
  readonly id: string;
  readonly kind: 'user';
  readonly text: string;
  /** SDK message id; present when this message can anchor a rewind. */
  readonly messageId?: string;
  /** Attachments this message was sent with; metadata only. */
  readonly attachments?: readonly SentAttachmentSummary[];
}

export interface AssistantTranscriptItem {
  readonly id: string;
  readonly kind: 'assistant';
  readonly turnId: string;
  readonly text: string;
}

export interface ThinkingTranscriptItem {
  readonly id: string;
  readonly kind: 'thinking';
  readonly turnId: string;
  readonly text: string;
  readonly status: TranscriptThinkingStatus;
  readonly durationMs?: number;
  readonly truncated: boolean;
}

export interface ToolTranscriptItem {
  readonly id: string;
  readonly kind: 'tool';
  readonly turnId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly action: string;
  readonly status: TranscriptToolStatus;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
  readonly durationMs?: number;
  /** First safe workspace-relative path changed by this tool. */
  readonly filePath?: string;
  /** Remaining changed paths, present only when positive. */
  readonly additionalFileCount?: number;
  /** Command/plan detail and the kind that determines its rendering. */
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
  readonly target?: string;
  /** Error excerpt from a failed tool_result, for the expanded row. */
  readonly errorMessage?: string;
  /**
   * Trailing command output of an execute-class tool (sanitized,
   * ≤ `MAX_TOOL_OUTPUT_TAIL_LENGTH` chars, line-bounded). Streams
   * while the tool runs and keeps the final tail on completion.
   * Live-session display only: history and recovery replays stay
   * outputless, and the text never enters diagnostics logs.
   */
  readonly outputTail?: string;
  /** Present when the CLI backgrounded this Execute call. */
  readonly backgroundHint?: ToolBackgroundHint;
  /** Present when this Task tool call delegated to a subagent. */
  readonly subagent?: ToolSubagentSummary;
}

export interface DiagnosticTranscriptItem {
  readonly id: string;
  readonly kind: 'diagnostic';
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  /** See `RuntimeDiagnosticMessage.relatedSessionId`. */
  readonly relatedSessionId?: string;
}

export const MAX_CHANGED_FILES_PER_TURN = 24;

/**
 * Media types an image transcript item may carry. Mirrors the SDK's
 * `Base64ImageSource` enum; the webview builds `data:` URIs only from
 * these whitelisted values, never from transported strings.
 */
export const IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** Who produced an image: the user's prompt, the assistant, or a tool. */
export const IMAGE_ORIGINS = [
  'user',
  'assistant',
  'tool-result',
] as const;
export type ImageOrigin = (typeof IMAGE_ORIGINS)[number];

/**
 * Longest base64 payload one image transcript item may carry
 * (~2.1 MB binary). Larger images cross the Bridge as placeholder
 * rows with `data: ''` and their true `byteLength`.
 */
export const MAX_IMAGE_DATA_LENGTH = 2_800_000;
/** Most image items projected for one turn. */
export const MAX_IMAGES_PER_TURN = 8;

/**
 * One image rendered inline in the transcript. `data` is the pure
 * base64 payload (no data-URI prefix); an empty string marks a
 * placeholder whose bytes were dropped (oversized or evicted by the
 * session image budget) while `byteLength` keeps the original size.
 */
export interface ImageTranscriptItem {
  readonly id: string;
  readonly kind: 'image';
  readonly turnId: string;
  readonly origin: ImageOrigin;
  readonly mediaType: ImageMediaType;
  readonly data: string;
  /** True for images the assistant generated (shows a badge). */
  readonly generated: boolean;
  /** Decoded binary size in bytes; kept for placeholder rows. */
  readonly byteLength: number;
}

/**
 * One workspace-relative file a turn changed. Line counts are measured
 * against the captured before-turn content, with git HEAD as the
 * history fallback; null when no textual comparison is available.
 */
export interface ChangedFileSummary {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

/**
 * Per-turn ledger of the files its tools created or modified.
 * `writing` is a live-turn display flag; the host transcript and
 * replays only hold settled items (flag absent), so history replays
 * never animate a "writing" header.
 */
export interface ChangesTranscriptItem {
  readonly id: string;
  readonly kind: 'changes';
  readonly turnId: string;
  readonly files: readonly ChangedFileSummary[];
  readonly writing?: boolean;
}

export type SessionTranscriptItem =
  | UserTranscriptItem
  | AssistantTranscriptItem
  | ThinkingTranscriptItem
  | ToolTranscriptItem
  | ChangesTranscriptItem
  | AskUserResultTranscriptItem
  | DiagnosticTranscriptItem
  | ImageTranscriptItem;

export interface HostSnapshotMessage {
  readonly type: 'host.snapshot';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly connection: ConnectionState;
  readonly turn: {
    readonly turnId: string;
    readonly status: TurnStatus;
    readonly error?: string;
  } | null;
  readonly sessions: SessionCatalogState;
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly historyStatus: SessionHistoryStatus;
  readonly truncated: boolean;
  /**
   * Absolute workspace folder the host is bound to. The webview uses
   * it to rebase absolute transcript paths into workspace-relative
   * ones (e.g. the path-link Preview entry); absent when no usable
   * workspace exists, which fail-closes every rebase-dependent
   * affordance.
   */
  readonly workspaceRoot?: string;
  /**
   * Read-only mission identity of the active session; absent when
   * the session is not part of a mission decomposition.
   */
  readonly mission?: SessionMissionSummary;
  /**
   * True when the drawer may offer "New session in a worktree":
   * daemon runtime mode and a git-worktree workspace. Absent means
   * unavailable and the entry must not render (fail closed).
   */
  readonly worktreeCreateAvailable?: boolean;
  /**
   * True when `/btw` side chat is available (both runtime modes: the
   * hidden fork rides a public process client in process mode and the
   * shared daemon connection in daemon mode). Absent means unavailable
   * and every `/btw` entry point must stay hidden (fail closed).
   */
  readonly btwAvailable?: boolean;
  /**
   * Session/turn token-usage breakdown. Absent when the host has no
   * usage data for the active session (fail quiet; the popover
   * section must not render).
   */
  readonly tokenUsage?: SessionTokenUsageState;
  /**
   * Queued prompts of the active session (queued-messages design).
   * Absent when the queue is empty, which the webview treats as the
   * empty state; queue state also streams via `queue.state`.
   */
  readonly queue?: SessionQueueState;
  /**
   * True when the active runtime keeps detached turns running in the
   * background (daemon mode), so the drawer may allow switching away
   * from a running turn. Absent means unavailable (process mode) and
   * switching stays blocked while a turn runs (fail closed).
   */
  readonly backgroundTurnsAvailable?: boolean;
}

export interface HostConnectionMessage {
  readonly type: 'host.connection';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly connection: ConnectionState;
}

export interface SessionSettingsStateMessage {
  readonly type: 'session.settings';
  readonly sequence: number;
  readonly sessionId: string;
  readonly settings: SessionSettingsState;
}

export interface SessionContextStateMessage {
  readonly type: 'session.context';
  readonly sequence: number;
  readonly sessionId: string;
  readonly context: SessionContextState;
}

/**
 * Token-usage breakdown of the active session: cumulative totals
 * (live `token_usage_update` stream or `loadSession` history seed)
 * plus the last turn completed in this window. Tokens only; the
 * Droid SDK exposes no USD cost.
 */
export interface SessionTokenUsageStateMessage {
  readonly type: 'session.tokenUsage';
  readonly sequence: number;
  readonly sessionId: string;
  readonly tokenUsage: SessionTokenUsageState;
}

export interface ModelCatalogStateMessage {
  readonly type: 'session.model-catalog';
  readonly sequence: number;
  readonly sessionId: string;
  readonly modelCatalog: ModelCatalogState;
}

export interface SessionSkillsStateMessage {
  readonly type: 'session.skills';
  readonly sequence: number;
  readonly sessionId: string;
  readonly skills: SessionSkillsState;
}

/**
 * Installed plugins and marketplace count of the active session,
 * answered through the daemon sidecar for a `plugins.refresh`
 * request.
 */
export interface SessionPluginsStateMessage {
  readonly type: 'session.plugins';
  readonly sequence: number;
  readonly sessionId: string;
  readonly plugins: SessionPluginsState;
}

export interface SessionMcpStateMessage {
  readonly type: 'session.mcp';
  readonly sequence: number;
  readonly sessionId: string;
  readonly mcp: SessionMcpState;
}

export interface SessionCommandsStateMessage {
  readonly type: 'session.commands';
  readonly sequence: number;
  readonly sessionId: string;
  readonly commands: SessionCommandsState;
}

/**
 * Archived sessions of the current workspace, listed through the
 * daemon sidecar. Answers a `sessions.archivedRefresh` request and
 * follows archive/unarchive operations.
 */
export interface SessionArchivedStateMessage {
  readonly type: 'session.archived';
  readonly sequence: number;
  readonly archived: SessionArchivedState;
}

/**
 * Incremental update of one catalog session's background running
 * flag (`SessionSummary.running`). Emitted when a detached daemon
 * turn starts being tracked or stops running, so the drawer spinner
 * appears and disappears without a full catalog refresh.
 */
export interface SessionRunningStateMessage {
  readonly type: 'session.running';
  readonly sequence: number;
  readonly sessionId: string;
  readonly running: boolean;
}

/**
 * Result of one cross-session content search through the daemon
 * sidecar. `query` echoes the request so the webview can drop stale
 * responses.
 */
export interface SessionSearchStateMessage {
  readonly type: 'session.searchResults';
  readonly sequence: number;
  readonly search: SessionSearchState;
}

/** Current staged attachments for the active session. */
export interface SessionAttachmentsStateMessage {
  readonly type: 'session.attachments';
  readonly sequence: number;
  readonly sessionId: string;
  readonly attachments: readonly AttachmentSummary[];
}

/**
 * One entry of the edit staging area: attachment chip metadata plus
 * whether the original payload is still available to resend.
 * `restorable: false` entries (evicted from the retention area or
 * predating this window) can only be removed, not kept.
 */
export interface EditAttachmentSummary extends AttachmentSummary {
  readonly restorable: boolean;
}

/** Current edit staging area contents for one message being edited. */
export interface SessionEditAttachmentsStateMessage {
  readonly type: 'session.editAttachments';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly attachments: readonly EditAttachmentSummary[];
}

/** Why the host declined an edit-and-resend request. */
export const EDIT_RESEND_REJECT_REASONS = [
  'busy',
  'unsupported',
  'failed',
] as const;
export type EditResendRejectReason =
  (typeof EDIT_RESEND_REJECT_REASONS)[number];

/**
 * Structured rejection of one `turn.editResend` request so the
 * editing card returns to its edit state deterministically instead
 * of waiting out a recovery timer.
 */
export interface TurnEditResendRejectedMessage {
  readonly type: 'turn.editResendRejected';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly reason: EditResendRejectReason;
}

/**
 * Progress of one browser OAuth authentication flow for an MCP
 * server. `started` means the host accepted the request; `browser`
 * means the OAuth URL was opened (or Droid reported none) and the
 * host is waiting for the outcome; the remaining phases are terminal.
 */
export interface McpAuthStateMessage {
  readonly type: 'mcp.auth';
  readonly sequence: number;
  readonly sessionId: string;
  readonly serverName: string;
  readonly phase: McpAuthPhase;
  readonly message: string | null;
}

export const MAX_REWIND_INFO_FILES = 40;
export const MAX_REWIND_EVICTED_REASON_LENGTH = 120;

/** A file a rewind cannot restore, with the backend's reason. */
export interface RewindEvictedFile {
  readonly path: string;
  readonly reason: string;
}

/**
 * How rewinding to `messageId` would affect workspace files. The path
 * lists are capped at `MAX_REWIND_INFO_FILES` and omit files outside
 * the workspace, so they can be shorter than the counts.
 */
export interface RewindFileImpact {
  readonly messageId: string;
  /** Files Droid changed after the anchor that a rewind can restore. */
  readonly restorableCount: number;
  /** Files Droid created after the anchor that a rewind can delete. */
  readonly createdCount: number;
  readonly restorablePaths: readonly string[];
  readonly createdPaths: readonly string[];
  /**
   * Files Droid changed after the anchor but can no longer restore, so
   * a rewind leaves them at their current contents.
   */
  readonly evictedFiles: readonly RewindEvictedFile[];
}

/** Answers a webview `rewind.info` request. */
export interface RewindInfoStateMessage extends RewindFileImpact {
  readonly type: 'rewind.info';
  readonly sequence: number;
  readonly sessionId: string;
}

export const WORKSPACE_FILES_STATUSES = [
  'ok',
  'no-workspace',
] as const;
export type WorkspaceFilesStatus =
  (typeof WORKSPACE_FILES_STATUSES)[number];

/**
 * Workspace files matching one `workspace.searchFiles` request. Paths
 * are workspace-relative with forward slashes. `no-workspace` marks an
 * empty result caused by no folder being open, so the mention popup
 * can say so instead of showing a misleading "no matching files".
 */
export interface WorkspaceFilesMessage {
  readonly type: 'workspace.files';
  readonly sequence: number;
  readonly sessionId: string;
  readonly requestId: string;
  readonly status: WorkspaceFilesStatus;
  readonly files: readonly string[];
}

export const WORKSPACE_IMAGE_STATUSES = [
  'ok',
  'not-found',
  'too-large',
  'unsupported',
] as const;
export type WorkspaceImageStatus =
  (typeof WORKSPACE_IMAGE_STATUSES)[number];

/**
 * Bytes for one `workspace.readImage` request. `data` is the pure
 * base64 payload (no data-URI prefix) and is empty unless `status` is
 * `ok`; non-ok statuses let the markdown renderer degrade to a
 * clickable path link with an accurate reason.
 */
export interface WorkspaceImageDataMessage {
  readonly type: 'workspace.imageData';
  readonly sequence: number;
  readonly sessionId: string;
  readonly path: string;
  readonly status: WorkspaceImageStatus;
  readonly mediaType: ImageMediaType | null;
  readonly data: string;
}

export interface AssistantDeltaMessage {
  readonly type: 'assistant.delta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly delta: string;
}

export interface ThinkingDeltaMessage {
  readonly type: 'thinking.delta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly delta: string;
  readonly truncated: boolean;
  /**
   * 0-based thinking segment ordinal within the turn (monotonic;
   * think→tool→think turns produce segments 0 and 1). The webview
   * keys transcript items per segment so interleaved thinking keeps
   * its timeline position.
   */
  readonly segmentIndex: number;
}

export interface ThinkingCompleteMessage {
  readonly type: 'thinking.complete';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly durationMs: number | null;
  /** Segment this completion targets; other segments stay intact. */
  readonly segmentIndex: number;
}

export interface ToolActivityMessage {
  readonly type: 'tool.activity';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly action: string;
  readonly status: ToolActivityStatus;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
  readonly durationMs?: number;
  readonly filePath?: string;
  readonly additionalFileCount?: number;
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
  readonly target?: string;
  readonly errorMessage?: string;
  readonly outputTail?: string;
  /** Present when the CLI backgrounded this Execute call. */
  readonly backgroundHint?: ToolBackgroundHint;
  /** Present when this Task tool call delegated to a subagent. */
  readonly subagent?: ToolSubagentSummary;
}

/**
 * Settles one delegation's subagent summary out of band — after the
 * parent turn already reached a terminal state. Background Task
 * dispatches outlive their turn (probed 2026-08-12: the invocation
 * ledger keeps them `running` for minutes after the turn ends, and
 * no session notification announces the change), so the Host's
 * post-turn ledger reconcile pushes settlements through this message
 * instead of `tool.activity`, which the webview rightly drops once
 * the turn is over. Only the `subagent` field of the addressed tool
 * row may change.
 */
export interface SubagentUpdateMessage {
  readonly type: 'subagent.update';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly subagent: ToolSubagentSummary;
}

/**
 * Appends one image transcript item during a live turn: an image the
 * user attached to the prompt, an image block the assistant created,
 * or an image embedded in a tool result.
 */
export interface TranscriptImageMessage {
  readonly type: 'transcript.image';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly item: ImageTranscriptItem;
}

export interface RuntimeDiagnosticMessage {
  readonly type: 'runtime.diagnostic';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  /**
   * Another session this diagnostic points at. Currently used by
   * `session-compacted` to carry the pre-compaction session id, which
   * the webview offers as a "View full history" jump.
   */
  readonly relatedSessionId?: string;
}

export interface TurnStateMessage {
  readonly type: 'turn.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly status: TurnStatus;
}

/**
 * Announces the SDK message id assigned to the user prompt of a live
 * turn so the webview can enable edit-and-resend for it.
 */
export interface UserMessageMetaMessage {
  readonly type: 'user.message-meta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
}

export interface TurnErrorMessage {
  readonly type: 'turn.error';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface PermissionToolSummary {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly confirmationKind: PermissionConfirmationKind;
  readonly title: string;
  readonly detail?: string;
  readonly riskNote?: string;
}

export interface PermissionOption {
  readonly label: string;
  readonly value: string;
  readonly requiresEditedSpec: boolean;
}

export interface PermissionInteractionRequest {
  readonly requestId: string;
  readonly kind: 'permission';
  readonly tools: readonly PermissionToolSummary[];
  readonly options: readonly PermissionOption[];
  readonly editableSpecContent?: string;
}

export interface AskUserQuestion {
  readonly index: number;
  readonly topic: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

export interface AskUserInteractionRequest {
  readonly requestId: string;
  readonly kind: 'ask-user';
  readonly toolCallId: string;
  readonly questions: readonly AskUserQuestion[];
}

export type InteractionRequest =
  | PermissionInteractionRequest
  | AskUserInteractionRequest;

export interface InteractionRequestMessage {
  readonly type: 'interaction.request';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly request: InteractionRequest;
}

export interface InteractionClosedMessage {
  readonly type: 'interaction.closed';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly result?: AskUserInteractionResult;
}

export type HostToWebviewMessage =
  | HostSnapshotMessage
  | HostConnectionMessage
  | SessionSettingsStateMessage
  | SessionContextStateMessage
  | SessionTokenUsageStateMessage
  | ModelCatalogStateMessage
  | SessionSkillsStateMessage
  | SessionPluginsStateMessage
  | SessionMcpStateMessage
  | SessionCommandsStateMessage
  | McpAuthStateMessage
  | SessionArchivedStateMessage
  | SessionRunningStateMessage
  | SessionSearchStateMessage
  | SessionAttachmentsStateMessage
  | SessionAttachmentImageDataMessage
  | SessionEditAttachmentsStateMessage
  | TurnEditResendRejectedMessage
  | WorkspaceFilesMessage
  | WorkspaceImageDataMessage
  | RewindInfoStateMessage
  | AssistantDeltaMessage
  | ThinkingDeltaMessage
  | ThinkingCompleteMessage
  | ToolActivityMessage
  | SubagentUpdateMessage
  | TranscriptImageMessage
  | ChangesUpdateMessage
  | GitStatusContract
  | GitBranchDiffContract
  | GitCommitResultContract
  | RuntimeDiagnosticMessage
  | TurnStateMessage
  | UserMessageMetaMessage
  | TurnErrorMessage
  | InteractionRequestMessage
  | InteractionClosedMessage
  | PlanDocumentStateMessage
  | SessionBtwMessage
  | QueueStateMessage
  | UiThemeMessage
  | CustomModelsHostMessage
  | SubagentActivityMessage
  | CanvasFeedbackDraftMessage
  | MissionHostMessage
  | ReviewHostMessage;

export type {
  CanvasFeedbackDraftMessage,
  CanvasInlineArtifact,
  CanvasPanelMessage,
  CanvasSelectionDescriptor,
  CanvasView,
  CanvasViewport,
  PreviewInlineHtmlMessage,
} from './canvasProtocol';
export { MAX_INLINE_PREVIEW_HTML_LENGTH } from './canvasProtocol';
export type {
  MissionControlMessage,
  MissionControlAction,
  MissionControlResultMessage,
  MissionDisclosureMessage,
  MissionFeatureSnapshot,
  MissionHostMessage,
  MissionLifecycle,
  MissionProfile,
  MissionProfileMode,
  MissionReasoningEffort,
  MissionSnapshotMessage,
  MissionStartMessage,
  MissionViewerOpenMessage,
  MissionWebviewMessage,
} from './missionProtocol';
export type * from './reviewProtocol';
