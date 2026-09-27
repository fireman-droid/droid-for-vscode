import { MAX_PERMISSION_TOOL_NAME_LENGTH } from './interactionProtocol';

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

export const MAX_MCP_SERVERS = 100;

export const MAX_MCP_TOOLS_PER_SERVER = 200;

export const MAX_MCP_NAME_LENGTH = 128;

export const MAX_MCP_TOOL_DESCRIPTION_LENGTH = 512;

export const MAX_MCP_COMMAND_LENGTH = 1024;

export const MAX_MCP_URL_LENGTH = 2048;

export const MAX_MCP_ARGS = 24;

export const MAX_MCP_ARG_LENGTH = 512;

export const MCP_SERVER_TYPES = ['stdio', 'http', 'sse'] as const;

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

export const CONNECTION_STATUSES = [
  'idle',
  'connecting',
  'connected',
  'unavailable',
] as const;

export const TURN_STATUSES = [
  'idle',
  'submitting',
  'streaming',
  'stopping',
  'completed',
  'interrupted',
  'failed',
] as const;

export const TOOL_ACTIVITY_STATUSES = ['running', 'completed', 'failed'] as const;

export const DIAGNOSTIC_SEVERITIES = ['info', 'warning', 'error'] as const;

export const SESSION_CATALOG_STATUSES = ['idle', 'loading', 'ready', 'error'] as const;

export const SESSION_HISTORY_STATUSES = ['complete', 'partial', 'unavailable'] as const;

export const TRANSCRIPT_THINKING_STATUSES = [
  'active',
  'complete',
  'stopping',
  'stopped',
] as const;

export const TRANSCRIPT_TOOL_STATUSES = [
  ...TOOL_ACTIVITY_STATUSES,
  'stopping',
  'stopped',
] as const;

export const SESSION_INTERACTION_MODES = ['auto', 'spec', 'mission'] as const;

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

/** Longest subagent type name shown on a delegated Task row. */
export const MAX_SUBAGENT_TYPE_LENGTH = 64;

/** Longest subagent description shown under a delegated Task row. */
export const MAX_SUBAGENT_DESCRIPTION_LENGTH = 512;

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

/** Role of a session in a mission decomposition. */
export const MISSION_SESSION_ROLES = ['orchestrator', 'worker'] as const;

export const SESSION_AUTONOMY_LEVELS = ['off', 'low', 'medium', 'high'] as const;

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

export const MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH = 2_048;

/** Longest accepted cross-session content search query. */
export const MAX_SESSION_SEARCH_QUERY_LENGTH = 256;

/** Most sessions returned for one content search. */
export const MAX_SESSION_SEARCH_RESULTS = 20;

/** Longest snippet excerpt shown for one search hit. */
export const MAX_SESSION_SEARCH_SNIPPET_LENGTH = 240;

/** Most archived sessions listed in the drawer. */
export const MAX_ARCHIVED_SESSION_ITEMS = 50;

/**
 * File extensions eligible for the sandboxed prototype preview panel.
 * Only self-contained HTML documents are previewable; build-dependent
 * sources (.tsx/.jsx/.vue) are deliberately excluded so the UI never
 * offers a preview it cannot render.
 */
export const PREVIEWABLE_FILE_EXTENSIONS = ['.html', '.htm'] as const;

/** Longest accepted path in a `workspace.openPath` request. */
export const MAX_OPEN_PATH_LENGTH = 1024;

/** Largest accepted 1-based line or column in an open request. */
export const MAX_OPEN_PATH_POSITION = 1_000_000;

/** Longest accepted workspace file search query. */
export const MAX_FILE_SEARCH_QUERY_LENGTH = 128;

/** Most file paths returned for one workspace search. */
export const MAX_FILE_SEARCH_RESULTS = 20;

/** Longest accepted local image path in a markdown reference. */
export const MAX_IMAGE_PATH_LENGTH = 1024;

/**
 * UI theme preference for the Droid shell. 'auto' follows the
 * editor's current color theme kind; 'light'/'dark' pin the shell.
 * Persisted host-side as the `droidvisx.theme` user setting.
 */
export const THEME_PREFERENCES = ['auto', 'light', 'dark'] as const;

export const SKILL_LOCATIONS = ['project', 'personal', 'builtin', 'automation'] as const;

export const MAX_PENDING_ATTACHMENTS = 8;

/** Most file URIs accepted from one drop onto the composer. */
export const MAX_ATTACHMENT_URI_COUNT = MAX_PENDING_ATTACHMENTS;

export const MAX_ATTACHMENT_NAME_LENGTH = 128;

export const ATTACHMENT_KINDS = ['image', 'pdf', 'text', 'editor', 'selection'] as const;

export const MCP_SERVER_STATUSES = [
  'connecting',
  'connected',
  'disconnected',
  'failed',
  'disabled',
] as const;

export const MCP_AUTH_PHASES = [
  'started',
  'browser',
  'success',
  'cancelled',
  'failed',
  'error',
] as const;

/** Longest accepted `mcp.auth` progress message. */
export const MAX_MCP_AUTH_MESSAGE_LENGTH = 256;

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

/** Who produced an image: the user's prompt, the assistant, or a tool. */
export const IMAGE_ORIGINS = ['user', 'assistant', 'tool-result'] as const;

/**
 * Longest base64 payload one image transcript item may carry
 * (~2.1 MB binary). Larger images cross the Bridge as placeholder
 * rows with `data: ''` and their true `byteLength`.
 */
export const MAX_IMAGE_DATA_LENGTH = 2_800_000;

/** Most image items projected for one turn. */
export const MAX_IMAGES_PER_TURN = 8;

/** Why the host declined an edit-and-resend request. */
export const EDIT_RESEND_REJECT_REASONS = ['busy', 'unsupported', 'failed', 'resume-failed', 'rewind-pending'] as const;

export const MAX_REWIND_INFO_FILES = 40;

export const MAX_REWIND_EVICTED_REASON_LENGTH = 120;

export const WORKSPACE_FILES_STATUSES = ['ok', 'no-workspace'] as const;

export const WORKSPACE_IMAGE_STATUSES = [
  'ok',
  'not-found',
  'too-large',
  'unsupported',
] as const;
