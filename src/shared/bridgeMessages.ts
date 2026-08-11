import {
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  type PermissionConfirmationKind,
} from './interactionProtocol';
import {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  TOOL_ACTIVITY_UPDATE_KINDS,
  type ToolActivityUpdateKind,
} from './toolActivity';
import { MAX_SESSION_TRANSCRIPT_ITEMS } from './transcriptLimits';

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
  PERMISSION_CONFIRMATION_KINDS,
  type PermissionConfirmationKind,
} from './interactionProtocol';
export {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  TOOL_ACTIVITY_UPDATE_KINDS,
  type ToolActivityUpdateKind,
} from './toolActivity';
export {
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
} from './transcriptLimits';

export const BRIDGE_PROTOCOL_VERSION = 2 as const;
export const MAX_TURN_TEXT_LENGTH = 200_000;
export const MAX_ASSISTANT_TEXT_LENGTH = 200_000;
export const MAX_THINKING_TEXT_LENGTH = 32_000;
export const MAX_TOOL_NAME_LENGTH = MAX_PERMISSION_TOOL_NAME_LENGTH;
export const MAX_TOOL_ACTIVITIES_PER_TURN = 100;
export const MAX_INTERACTION_TEXT_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_SESSION_CATALOG_ITEMS = 50;
export const MAX_SESSION_TITLE_LENGTH = 256;
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

export type SessionContextAccuracy = 'exact' | 'estimated';

export interface WebviewReadyMessage {
  readonly type: 'webview.ready';
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
}

export const WEBVIEW_DIAGNOSTIC_KINDS = [
  'boot-ok',
  'render-ok',
  'boot-timeout',
  'error',
  'unhandledrejection',
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

export interface PermissionRespondMessage {
  readonly type: 'permission.respond';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly selectedOption: string;
  readonly editedSpecContent?: string;
}

export interface AskUserAnswer {
  readonly index: number;
  readonly answer: string;
}

export interface AskUserRespondMessage {
  readonly type: 'ask-user.respond';
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly cancelled: boolean;
  readonly answers: readonly AskUserAnswer[];
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

/** Renames the currently active session. */
export interface SessionRenameMessage {
  readonly type: 'session.rename';
  readonly sessionId: string;
  readonly title: string;
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
  readonly path: string;
}

/** Requests the current Droid skill catalog for the session. */
export interface SkillsRefreshMessage {
  readonly type: 'skills.refresh';
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
 * Asks the host to open a native file picker and stage the chosen
 * files as pending attachments for the next prompt.
 */
export interface AttachmentPickMessage {
  readonly type: 'attachment.pick';
  readonly sessionId: string;
}

/** Stages the active editor document as a pending text attachment. */
export interface AttachmentAddEditorMessage {
  readonly type: 'attachment.addEditor';
  readonly sessionId: string;
}

/** Stages the active editor selection as a pending text attachment. */
export interface AttachmentAddSelectionMessage {
  readonly type: 'attachment.addSelection';
  readonly sessionId: string;
}

/** Stages current workspace diagnostics as a pending text attachment. */
export interface AttachmentAddProblemsMessage {
  readonly type: 'attachment.addProblems';
  readonly sessionId: string;
}

/**
 * Stages uncommitted git changes (working tree vs HEAD) as a pending
 * text attachment.
 */
export interface AttachmentAddGitChangesMessage {
  readonly type: 'attachment.addGitChanges';
  readonly sessionId: string;
}

/** Removes one staged attachment by its host-assigned id. */
export interface AttachmentRemoveMessage {
  readonly type: 'attachment.remove';
  readonly sessionId: string;
  readonly attachmentId: string;
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

/**
 * Stages one workspace file, named by its validated relative path, as
 * a pending attachment for the next prompt.
 */
export interface AttachmentAddPathMessage {
  readonly type: 'attachment.addPath';
  readonly sessionId: string;
  readonly path: string;
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
  | SessionsRefreshMessage
  | SessionSelectMessage
  | SessionNewMessage
  | SessionRenameMessage
  | SessionContextRefreshMessage
  | SessionCompactMessage
  | SessionForkMessage
  | FileOpenDiffMessage
  | SkillsRefreshMessage
  | SkillToggleMessage
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
  | AttachmentRemoveMessage
  | AttachmentAddPathMessage
  | WorkspaceSearchFilesMessage
  | RewindInfoRequestMessage
  | SessionSettingUpdateMessage;

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
}

export interface SessionCatalogState {
  readonly status: SessionCatalogStatus;
  readonly items: readonly SessionSummary[];
  readonly message?: string;
}

export interface ConfirmedSessionSettings {
  readonly interactionMode: SessionInteractionMode;
  readonly modelId: string;
  readonly reasoningEffort: SessionReasoningEffort;
  readonly autonomyLevel: SessionAutonomyLevel;
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

export interface SessionContextStats {
  readonly used: number;
  readonly remaining: number;
  readonly limit: number;
  readonly accuracy: SessionContextAccuracy;
}

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

export interface UserTranscriptItem {
  readonly id: string;
  readonly kind: 'user';
  readonly text: string;
  /** SDK message id; present when this message can anchor a rewind. */
  readonly messageId?: string;
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
  /**
   * Workspace-relative path (forward slashes) of the file this tool
   * changed. Only present for file-modifying tools whose target stays
   * inside the workspace.
   */
  readonly filePath?: string;
  /** Present together with `detail`; says how to render it. */
  readonly detailKind?: ToolDetailKind;
  /** Command text or plan text extracted from the tool input. */
  readonly detail?: string;
}

export interface DiagnosticTranscriptItem {
  readonly id: string;
  readonly kind: 'diagnostic';
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
}

export const MAX_CHANGED_FILES_PER_TURN = 24;

/**
 * One workspace-relative file a turn changed. Line counts are measured
 * against git HEAD when the turn completes; null when unavailable
 * (no git, binary file, or untracked file).
 */
export interface ChangedFileSummary {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

/** Per-turn summary of the files its tools created or modified. */
export interface ChangesTranscriptItem {
  readonly id: string;
  readonly kind: 'changes';
  readonly turnId: string;
  readonly files: readonly ChangedFileSummary[];
}

export type SessionTranscriptItem =
  | UserTranscriptItem
  | AssistantTranscriptItem
  | ThinkingTranscriptItem
  | ToolTranscriptItem
  | ChangesTranscriptItem
  | DiagnosticTranscriptItem;

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

/** Current staged attachments for the active session. */
export interface SessionAttachmentsStateMessage {
  readonly type: 'session.attachments';
  readonly sequence: number;
  readonly sessionId: string;
  readonly attachments: readonly AttachmentSummary[];
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

/**
 * How rewinding to `messageId` would affect workspace files, as
 * counts only. Answers a webview `rewind.info` request.
 */
export interface RewindInfoStateMessage {
  readonly type: 'rewind.info';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  /** Files Droid changed after the anchor that a rewind can restore. */
  readonly restorableCount: number;
  /** Files Droid created after the anchor that a rewind can delete. */
  readonly createdCount: number;
}

/**
 * Workspace files matching one `workspace.searchFiles` request. Paths
 * are workspace-relative with forward slashes.
 */
export interface WorkspaceFilesMessage {
  readonly type: 'workspace.files';
  readonly sequence: number;
  readonly sessionId: string;
  readonly requestId: string;
  readonly files: readonly string[];
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
}

export interface ThinkingCompleteMessage {
  readonly type: 'thinking.complete';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly durationMs: number | null;
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
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
}

/** Announces the changed-files summary for a finished turn. */
export interface TurnChangesMessage {
  readonly type: 'turn.changes';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly files: readonly ChangedFileSummary[];
}

export interface RuntimeDiagnosticMessage {
  readonly type: 'runtime.diagnostic';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
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
}

export type HostToWebviewMessage =
  | HostSnapshotMessage
  | HostConnectionMessage
  | SessionSettingsStateMessage
  | SessionContextStateMessage
  | ModelCatalogStateMessage
  | SessionSkillsStateMessage
  | SessionMcpStateMessage
  | SessionCommandsStateMessage
  | McpAuthStateMessage
  | SessionAttachmentsStateMessage
  | WorkspaceFilesMessage
  | RewindInfoStateMessage
  | AssistantDeltaMessage
  | ThinkingDeltaMessage
  | ThinkingCompleteMessage
  | ToolActivityMessage
  | TurnChangesMessage
  | RuntimeDiagnosticMessage
  | TurnStateMessage
  | UserMessageMetaMessage
  | TurnErrorMessage
  | InteractionRequestMessage
  | InteractionClosedMessage;
