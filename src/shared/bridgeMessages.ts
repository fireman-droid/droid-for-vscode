import type { ModelsOpenMessage } from './protocol/modelManagerProtocol';
import type { SystemPromptRequest, SystemPromptResponse } from './protocol/systemPromptProtocol';
import type { IdeState, HostIdeMessage, IdeReconnectMessage, IdeRefreshMessage } from './protocol/ideProtocol';
import type { ManagementOpenMessage } from './protocol/managementProtocol';
import type { ReviewPanelOpen } from './protocol/reviewPanelProtocol';
import type {
  AttachmentAddTextFileMessage,
  AttachmentAddUrisMessage,
} from './protocol/attachmentDropProtocol';
import type {
  AttachmentAddImageMessage,
  AttachmentAddPdfMessage,
  AttachmentAddRemoteImageMessage,
  AttachmentReadImageMessage,
  SessionAttachmentImageDataMessage,
} from './protocol/attachmentImageProtocol';
import type {
  BtwAskMessage,
  BtwDismissMessage,
  BtwPrepareMessage,
  BtwStopMessage,
  SessionBtwMessage,
} from './protocol/btwProtocol';
import type {
  CanvasFeedbackDraftMessage,
  PreviewInlineHtmlMessage,
} from './protocol/canvasProtocol';
import type { ChangesUpdateMessage } from './protocol/changesProtocol';
import type { FileReadDiffMessage, FileOpenTurnDiffMessage, FileDiffMessage, FileDiffInvalidateMessage } from './protocol/inlineDiffProtocol';
import type {
  CustomModelsHostMessage,
  CustomModelsWebviewMessage,
} from './protocol/customModelsProtocol';
import type {
  GitBranchDiffMessage as GitBranchDiffContract,
  GitCommitRequestMessage as GitCommitRequestContract,
  GitCommitResultMessage as GitCommitResultContract,
  GitRequestBranchDiffMessage as GitRequestBranchDiffContract,
  GitRequestStatusMessage as GitRequestStatusContract,
  GitStatusMessage as GitStatusContract,
} from './protocol/gitCommitFlow';
import {
  type AskUserRespondMessage,
  type PermissionRespondMessage,
  type PlanDocumentOpenMessage,
  type PlanDocumentStateMessage,
} from './protocol/interactionProtocol';
import type {
  MissionHostMessage,
  MissionWebviewMessage,
} from './protocol/missionProtocol';
import type {
  AttachmentAddEditorMessage,
  AttachmentAddGitChangesMessage,
  AttachmentAddPathMessage,
  AttachmentAddProblemsMessage,
  AttachmentAddSelectionMessage,
  AttachmentPickMessage,
  AttachmentRemoveMessage,
  EditStageBeginMessage,
  EditStageCancelMessage,
  SessionAttachmentsStateMessage,
  SessionEditAttachmentsStateMessage,
  TranscriptImageMessage,
  WorkspaceImageDataMessage,
  WorkspaceReadImageMessage,
} from './protocol/attachments';
import type {
  InteractionClosedMessage,
  InteractionRequestMessage,
  PendingInteractionSnapshot,
} from './protocol/interactions';
import type {
  SessionArchivedStateMessage,
  SessionArchiveMessage,
  SessionCatalogState,
  SessionCompactMessage,
  SessionFavoriteMessage,
  SessionForkMessage,
  SessionHistoryStatus,
  SessionMissionSummary,
  SessionNewMessage,
  SessionRenameMessage,
  SessionRunningStateMessage,
  SessionsArchivedRefreshMessage,
  SessionSearchMessage,
  SessionSearchStateMessage,
  SessionSelectMessage,
  SessionsRefreshMessage,
  SessionTokenUsageStateMessage,
  SessionUnarchiveMessage,
  WorktreeCreateSessionMessage,
} from './protocol/sessions';
import type {
  CommandsRefreshMessage,
  McpAuthStateMessage,
  McpRefreshMessage,
  McpServerAddMessage,
  McpServerAuthenticateMessage,
  McpServerRemoveMessage,
  McpServerToggleMessage,
  ModelCatalogState,
  ModelCatalogStateMessage,
  ModelCatalogRefreshMessage,
  PluginsRefreshMessage,
  SessionCommandsStateMessage,
  SessionContextRefreshMessage,
  SessionContextState,
  SessionContextStateMessage,
  SessionMcpStateMessage,
  SessionPluginsStateMessage,
  SessionSettingsState,
  SessionSettingsStateMessage,
  SessionSettingUpdateMessage,
  SessionSkillsStateMessage,
  SkillsRefreshMessage,
  SkillToggleMessage,
} from './protocol/settings';
import type {
  ConnectionState,
  HostConnectionMessage,
  RuntimeRetryMessage,
  UiThemeMessage,
  UiThemeSetMessage,
  UserMessageMetaMessage,
  WebviewReadyMessage,
  WebviewStateAppliedMessage,
} from './protocol/shell';
import type {
  AssistantDeltaMessage,
  LatestConversationChanges,
  RuntimeDiagnosticMessage,
  SessionTranscriptItem,
  SubagentUpdateMessage,
  ThinkingCompleteMessage,
  ThinkingDeltaMessage,
  WebviewDiagnosticMessage,
} from './protocol/transcript';
import type {
  RewindInfoRequestMessage,
  RewindInfoStateMessage,
  TurnEditResendMessage,
  TurnEditResendRejectedMessage,
  TurnErrorMessage,
  TurnSendMessage,
  TurnStateMessage,
  TurnStatus,
  TurnStopMessage,
} from './protocol/turns';
import type {
  FileOpenDiffMessage,
  FilePreviewMessage,
  TerminalOpenMirrorMessage,
  WorkspaceFilesMessage,
  WorkspaceOpenPathMessage,
  WorkspaceSearchFilesMessage,
} from './protocol/workspace';
import type {
  QueueAddMessage,
  QueueClearMessage,
  QueuePromoteMessage,
  QueueRemoveMessage,
  QueueResumeMessage,
  QueueStateMessage,
  QueueUpdateMessage,
  SessionQueueState,
} from './protocol/queueProtocol';
import type { ReviewHostMessage, ReviewWebviewMessage } from './protocol/reviewProtocol';
import type {
  SubagentActivityMessage,
  SubagentOpenMessage,
  SubagentPanelMessage,
} from './protocol/subagentProtocol';
import type { SessionTokenUsageState } from './protocol/tokenUsage';
import type { ToolActivityMessage } from './protocol/toolProtocol';

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
// v35 adds on-demand inline turn diffs and exact-snapshot editor opening.
// v41 exposes the runtime's explicit conversation-compaction phase.
// v46 separates per-file Diff invalidation from the cumulative changes ledger.
// v47 separates operation evidence, execution phases and workspace comparisons.
// v48 reports confirmed native IDE connection and disconnection.
// v49 includes pending interactions in authoritative conversation snapshots.
// v50 adds a session-scoped retry for the runtime model catalog.
// v53 retains read-only result previews from ordinary external files.
export const BRIDGE_PROTOCOL_VERSION = 53 as const;

export type WebviewToHostMessage =
  | SystemPromptRequest
  | IdeReconnectMessage
  | IdeRefreshMessage
  | ReviewPanelOpen
  | ModelsOpenMessage
  | ManagementOpenMessage
  | WebviewReadyMessage
  | WebviewStateAppliedMessage
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
  | ModelCatalogRefreshMessage
  | SessionCompactMessage
  | SessionForkMessage
  | FileOpenDiffMessage
  | FileReadDiffMessage
  | FileOpenTurnDiffMessage
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
  | BtwPrepareMessage
  | BtwAskMessage
  | BtwDismissMessage
  | BtwStopMessage
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

export interface HostSnapshotMessage {
  readonly type: 'host.snapshot';
  readonly sequence: number;
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly connection: ConnectionState;
  readonly ide?: IdeState;
  readonly turn: {
    readonly turnId: string;
    readonly status: TurnStatus;
    readonly compacting?: boolean;
    readonly error?: string;
  } | null;
  readonly sessions: SessionCatalogState;
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly transcript: readonly SessionTranscriptItem[];
  /** Authoritative pending input requests; absent means none. */
  readonly interactions?: readonly PendingInteractionSnapshot[];
  readonly historyStatus: SessionHistoryStatus;
  readonly truncated: boolean;
  readonly latestChanges?: LatestConversationChanges;
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

export type HostToWebviewMessage =
  | SystemPromptResponse
  | HostIdeMessage
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
  | FileDiffMessage
  | FileDiffInvalidateMessage
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

export {
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_LENGTH,
  type AttachmentAddTextFileMessage,
  type AttachmentAddUrisMessage,
} from './protocol/attachmentDropProtocol';
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
} from './protocol/attachmentImageProtocol';
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
} from './protocol/btwProtocol';
export { MAX_INLINE_PREVIEW_HTML_LENGTH } from './protocol/canvasProtocol';
export type {
  CanvasFeedbackDraftMessage,
  CanvasInlineArtifact,
  CanvasPanelMessage,
  CanvasSelectionDescriptor,
  CanvasView,
  CanvasViewport,
  PreviewInlineHtmlMessage,
} from './protocol/canvasProtocol';
export type {
  SessionContextStats,
  SessionContextUnavailableReason,
} from './protocol/contextState';
export {
  GIT_BRANCH_DIFF_UNAVAILABLE_REASONS,
  GIT_FILE_STATUSES,
  GIT_UNAVAILABLE_REASONS,
  isGitCommitHashEcho,
  MAX_GIT_BRANCH_DIFF_FILES,
  MAX_GIT_BRANCH_LENGTH,
  MAX_GIT_COMMIT_ERROR_LENGTH,
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
  MAX_GIT_COMMIT_PATHS,
  MAX_GIT_COMMIT_SUBJECT_LENGTH,
  MAX_GIT_STATUS_FILES,
  type GitBranchDiffFile,
  type GitBranchDiffMessage,
  type GitBranchDiffState,
  type GitBranchDiffUnavailableReason,
  type GitCommitRequestMessage,
  type GitCommitResultMessage,
  type GitFileStatus,
  type GitRequestBranchDiffMessage,
  type GitRequestStatusMessage,
  type GitStatusFile,
  type GitStatusMessage,
  type GitUnavailableReason,
} from './protocol/gitCommitFlow';
export {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_SPEC_PLAN_LENGTH,
  PERMISSION_CONFIRMATION_KINDS,
  PLAN_DOCUMENT_STATUSES,
  type AskUserAnswer,
  type AskUserInteractionResult,
  type AskUserRespondMessage,
  type AskUserResultAnswer,
  type AskUserResultTranscriptItem,
  type PermissionConfirmationKind,
  type PermissionRespondMessage,
  type PlanDocumentOpenMessage,
  type PlanDocumentStateMessage,
  type PlanDocumentStatus,
} from './protocol/interactionProtocol';
export type {
  MissionControlAction,
  MissionControlMessage,
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
} from './protocol/missionProtocol';
export type {
  AttachmentAddEditorMessage,
  AttachmentAddGitChangesMessage,
  AttachmentAddPathMessage,
  AttachmentAddProblemsMessage,
  AttachmentAddSelectionMessage,
  AttachmentKind,
  AttachmentPickMessage,
  AttachmentRemoveMessage,
  AttachmentSummary,
  EditAttachmentSummary,
  EditStageBeginMessage,
  EditStageCancelMessage,
  ImageMediaType,
  ImageOrigin,
  ImageTranscriptItem,
  SentAttachmentSummary,
  SessionAttachmentsStateMessage,
  SessionEditAttachmentsStateMessage,
  TranscriptImageMessage,
  WorkspaceImageDataMessage,
  WorkspaceImageStatus,
  WorkspaceReadImageMessage,
} from './protocol/attachments';
export {
  ATTACHMENT_KINDS,
  CONNECTION_STATUSES,
  DIAGNOSTIC_SEVERITIES,
  EDIT_RESEND_REJECT_REASONS,
  IMAGE_MEDIA_TYPES,
  IMAGE_ORIGINS,
  MAX_ARCHIVED_SESSION_ITEMS,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENT_URI_COUNT,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_COMMAND_ARGUMENT_HINT_LENGTH,
  MAX_COMMAND_DESCRIPTION_LENGTH,
  MAX_COMMAND_ITEMS,
  MAX_COMMAND_NAME_LENGTH,
  MAX_FILE_SEARCH_QUERY_LENGTH,
  MAX_FILE_SEARCH_RESULTS,
  MAX_IMAGE_DATA_LENGTH,
  MAX_IMAGE_PATH_LENGTH,
  MAX_IMAGES_PER_TURN,
  MAX_MCP_ARG_LENGTH,
  MAX_MCP_ARGS,
  MAX_MCP_AUTH_MESSAGE_LENGTH,
  MAX_MCP_COMMAND_LENGTH,
  MAX_MCP_NAME_LENGTH,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOL_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_URL_LENGTH,
  MAX_MODEL_CATALOG_ITEMS,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_OPEN_PATH_LENGTH,
  MAX_OPEN_PATH_POSITION,
  MAX_PENDING_ATTACHMENTS,
  MAX_PLUGIN_ID_LENGTH,
  MAX_PLUGIN_ITEMS,
  MAX_PLUGIN_MARKETPLACE_COUNT,
  MAX_PLUGIN_VERSION_LENGTH,
  MAX_RECENT_COMMANDS,
  MAX_REWIND_EVICTED_REASON_LENGTH,
  MAX_REWIND_INFO_FILES,
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  MAX_SESSION_SEARCH_RESULTS,
  MAX_SESSION_SEARCH_SNIPPET_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_ITEMS,
  MAX_SKILL_NAME_LENGTH,
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  MAX_THINKING_DELTA_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  MAX_TOOL_FILE_PATH_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TOOL_TARGET_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH,
  MAX_WORKTREE_BRANCH_LENGTH,
  MAX_WORKTREE_PATH_LENGTH,
  MCP_AUTH_PHASES,
  MCP_SERVER_STATUSES,
  MCP_SERVER_TYPES,
  MISSION_SESSION_ROLES,
  MISSION_STATES,
  PLUGIN_SCOPES,
  PREVIEWABLE_FILE_EXTENSIONS,
  SESSION_AUTONOMY_LEVELS,
  SESSION_CATALOG_STATUSES,
  SESSION_HISTORY_STATUSES,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
  SKILL_LOCATIONS,
  SUBAGENT_STATUSES,
  THEME_PREFERENCES,
  TOOL_ACTIVITY_STATUSES,
  TOOL_DETAIL_KINDS,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TURN_STATUSES,
  WEBVIEW_DIAGNOSTIC_KINDS,
  WORKSPACE_FILES_STATUSES,
  WORKSPACE_IMAGE_STATUSES,
} from './protocol/bounds';
export type {
  AskUserInteractionRequest,
  AskUserQuestion,
  InteractionClosedMessage,
  InteractionRequest,
  InteractionRequestMessage,
  PermissionInteractionRequest,
  PermissionOption,
  PermissionToolSummary,
} from './protocol/interactions';
export type {
  ArchivedSessionSummary,
  MissionSessionRole,
  MissionState,
  SessionArchivedState,
  SessionArchivedStateMessage,
  SessionArchiveMessage,
  SessionCatalogState,
  SessionCatalogStatus,
  SessionCompactMessage,
  SessionFavoriteMessage,
  SessionForkMessage,
  SessionHistoryStatus,
  SessionMissionSummary,
  SessionNewMessage,
  SessionRenameMessage,
  SessionRunningStateMessage,
  SessionsArchivedRefreshMessage,
  SessionSearchHit,
  SessionSearchMessage,
  SessionSearchState,
  SessionSearchStateMessage,
  SessionSelectMessage,
  SessionsRefreshMessage,
  SessionSummary,
  SessionTokenUsageStateMessage,
  SessionUnarchiveMessage,
  SessionWorktreeInfo,
  WorktreeCreateSessionMessage,
} from './protocol/sessions';
export type {
  CommandsRefreshMessage,
  CommandSummary,
  ConfirmedSessionSettings,
  McpAuthPhase,
  McpAuthStateMessage,
  McpRefreshMessage,
  McpServerAddMessage,
  McpServerAuthenticateMessage,
  McpServerRemoveMessage,
  McpServerStatus,
  McpServerSummary,
  McpServerToggleMessage,
  McpServerType,
  McpToolSummary,
  ModelCatalogItem,
  ModelCatalogState,
  ModelCatalogStateMessage,
  PluginScope,
  PluginsRefreshMessage,
  PluginSummary,
  SessionAutonomyLevel,
  SessionCommandsState,
  SessionCommandsStateMessage,
  SessionContextRefreshMessage,
  SessionContextState,
  SessionContextStateMessage,
  SessionInteractionMode,
  SessionMcpState,
  SessionMcpStateMessage,
  SessionPluginsState,
  SessionPluginsStateMessage,
  SessionReasoningEffort,
  SessionSettingsState,
  SessionSettingsStateMessage,
  SessionSettingUpdateMessage,
  SessionSkillsState,
  SessionSkillsStateMessage,
  SkillLocation,
  SkillsRefreshMessage,
  SkillSummary,
  SkillToggleMessage,
} from './protocol/settings';
export type {
  ConnectionState,
  ConnectionStatus,
  HostConnectionMessage,
  RuntimeRetryMessage,
  ThemePreference,
  UiThemeMessage,
  UiThemeSetMessage,
  UserMessageMetaMessage,
  WebviewReadyMessage,
} from './protocol/shell';
export type {
  AssistantDeltaMessage,
  AssistantTranscriptItem,
  ChangedFileSummary,
  ChangesTranscriptItem,
  DiagnosticSeverity,
  DiagnosticTranscriptItem,
  LatestConversationChanges,
  RuntimeDiagnosticMessage,
  SessionTranscriptItem,
  SubagentStatus,
  SubagentUpdateMessage,
  ThinkingCompleteMessage,
  ThinkingDeltaMessage,
  ThinkingTranscriptItem,
  ToolActivityStatus,
  ToolBackgroundHint,
  ToolDetailKind,
  ToolSubagentSummary,
  TranscriptThinkingStatus,
  TranscriptToolStatus,
  UserTranscriptItem,
  WebviewDiagnosticKind,
  WebviewDiagnosticMessage,
} from './protocol/transcript';
export type {
  EditResendRejectReason,
  RewindEvictedFile,
  RewindFileImpact,
  RewindInfoRequestMessage,
  RewindInfoStateMessage,
  TurnEditResendMessage,
  TurnEditResendRejectedMessage,
  TurnErrorMessage,
  TurnSendMessage,
  TurnStateMessage,
  TurnStatus,
  TurnStopMessage,
} from './protocol/turns';
export type {
  FileOpenDiffMessage,
  FilePreviewMessage,
  TerminalOpenMirrorMessage,
  WorkspaceFilesMessage,
  WorkspaceFilesStatus,
  WorkspaceOpenPathMessage,
  WorkspaceSearchFilesMessage,
} from './protocol/workspace';
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
} from './protocol/queueProtocol';
export type * from './protocol/reviewProtocol';
export {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  TOOL_ACTIVITY_UPDATE_KINDS,
  type ToolActivityUpdateKind,
} from './transcript/toolActivity';
export { MAX_TOOL_OUTPUT_TAIL_LENGTH } from './transcript/toolOutput';
export type { ToolActivityMessage, ToolTranscriptItem } from './protocol/toolProtocol';
export {
  MAX_RENDERED_SESSION_IMAGES,
  MAX_SESSION_IMAGE_DATA_UNITS,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
} from './transcript/transcriptLimits';
