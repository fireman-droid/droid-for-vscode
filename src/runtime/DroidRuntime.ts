import type { RuntimeAvailability, RuntimeEvent } from './runtimeEvents';

export const RUNTIME_INTERACTION_MODES = [
  'auto',
  'spec',
  'mission',
] as const;
export type RuntimeInteractionMode =
  (typeof RUNTIME_INTERACTION_MODES)[number];

export const RUNTIME_AUTONOMY_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
] as const;
export type RuntimeAutonomyLevel =
  (typeof RUNTIME_AUTONOMY_LEVELS)[number];

export const RUNTIME_REASONING_EFFORTS = [
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
export type RuntimeReasoningEffort =
  (typeof RUNTIME_REASONING_EFFORTS)[number];

export const MAX_RUNTIME_MODEL_ID_LENGTH = 256;
export const MAX_RUNTIME_MODEL_DISPLAY_NAME_LENGTH = 128;
export const MAX_RUNTIME_MODEL_CATALOG_ITEMS = 100;

export interface RuntimeSessionSettings {
  readonly interactionMode: RuntimeInteractionMode;
  readonly modelId: string;
  readonly reasoningEffort: RuntimeReasoningEffort;
  readonly autonomyLevel: RuntimeAutonomyLevel;
  /** Spec-mode drafting model; null when unset (session model is used). */
  readonly specModeModelId: string | null;
  /** Spec-mode reasoning effort; null when unset (model default is used). */
  readonly specModeReasoningEffort: RuntimeReasoningEffort | null;
}

export type RuntimeSessionSettingUpdate =
  | {
      readonly field: 'interactionMode';
      readonly value: RuntimeInteractionMode;
    }
  | {
      readonly field: 'modelId';
      readonly value: string;
    }
  | {
      readonly field: 'reasoningEffort';
      readonly value: RuntimeReasoningEffort;
    }
  | {
      readonly field: 'autonomyLevel';
      readonly value: RuntimeAutonomyLevel;
    }
  | {
      /** null resets Spec drafting to the session model. */
      readonly field: 'specModeModelId';
      readonly value: string | null;
    }
  | {
      /** null resets Spec drafting to the model's default effort. */
      readonly field: 'specModeReasoningEffort';
      readonly value: RuntimeReasoningEffort | null;
    };

/**
 * Backend-side working state of the active session, independent of any
 * turn this runtime is streaming locally. Daemon sessions keep running
 * across a window reload, so after a resume the session may already be
 * `running` (agent loop active) or `waiting-for-user` (a pending
 * permission/ask-user blocks the loop). `unknown` means the backend
 * could not attribute a state to the session (fail closed: callers must
 * not treat it as idle).
 */
export const RUNTIME_SESSION_WORKING_STATES = [
  'idle',
  'running',
  'waiting-for-user',
  'unknown',
] as const;
export type RuntimeSessionWorkingState =
  (typeof RUNTIME_SESSION_WORKING_STATES)[number];

export type RuntimeContextAccuracy = 'exact' | 'estimated';

export interface RuntimeContextStats {
  readonly used: number;
  readonly remaining: number;
  readonly limit: number;
  readonly accuracy: RuntimeContextAccuracy;
}

export interface RuntimeModelCatalogUnavailable {
  readonly status: 'unavailable';
}

export interface RuntimeModelCatalogAvailable {
  readonly status: 'available';
  readonly items: readonly RuntimeModelCatalogItem[];
}

export interface RuntimeModelCatalogItem {
  readonly id: string;
  readonly displayName: string;
  readonly supportedReasoningEfforts: readonly RuntimeReasoningEffort[];
}

export type RuntimeModelCatalog =
  | RuntimeModelCatalogUnavailable
  | RuntimeModelCatalogAvailable;

export type RuntimeSessionTarget =
  | {
      readonly kind: 'new';
      readonly cwd: string;
      /**
       * Asks the daemon to create (or reuse) a git worktree rooted at
       * `cwd` and run the session there. Daemon runtime mode only; the
       * process-mode session factory rejects it (fail closed). Probe
       * evidence (artifacts/probe-worktree-create.mjs): the daemon
       * derives the branch name itself (`<currentBranch>-wt`, plus an
       * 8-char session-id suffix on collision) and silently falls back
       * to a plain session when `cwd` is not a git repository.
       */
      readonly worktree?: boolean;
    }
  | {
      readonly kind: 'resume';
      readonly cwd: string;
      readonly sessionId: string;
    };

export const MAX_RUNTIME_SKILL_ITEMS = 200;
export const MAX_RUNTIME_SKILL_NAME_LENGTH = 128;
export const MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH = 512;

export const RUNTIME_SKILL_LOCATIONS = [
  'project',
  'personal',
  'builtin',
  'automation',
] as const;
export type RuntimeSkillLocation =
  (typeof RUNTIME_SKILL_LOCATIONS)[number];

export interface RuntimeSkill {
  readonly name: string;
  readonly description: string | null;
  readonly location: RuntimeSkillLocation;
  readonly enabled: boolean;
  readonly userInvocable: boolean;
}

export const MAX_RUNTIME_COMMAND_ITEMS = 200;
export const MAX_RUNTIME_COMMAND_NAME_LENGTH = 64;
export const MAX_RUNTIME_COMMAND_DESCRIPTION_LENGTH = 512;
export const MAX_RUNTIME_COMMAND_ARGUMENT_HINT_LENGTH = 128;

/**
 * One custom slash command discovered by Droid from the workspace or
 * personal `.factory/commands` directories, projected to safe display
 * fields.
 */
export interface RuntimeCommand {
  readonly name: string;
  readonly description: string | null;
  readonly argumentHint: string | null;
  readonly isExecutable: boolean;
}

export const MAX_RUNTIME_MCP_SERVERS = 100;
export const MAX_RUNTIME_MCP_TOOLS_PER_SERVER = 200;
export const MAX_RUNTIME_MCP_NAME_LENGTH = 128;
export const MAX_RUNTIME_MCP_TOOL_DESCRIPTION_LENGTH = 512;

export const RUNTIME_MCP_SERVER_STATUSES = [
  'connecting',
  'connected',
  'disconnected',
  'failed',
  'disabled',
] as const;
export type RuntimeMcpServerStatus =
  (typeof RUNTIME_MCP_SERVER_STATUSES)[number];

export interface RuntimeMcpTool {
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly readOnly: boolean;
}

export interface RuntimeMcpServer {
  readonly name: string;
  readonly status: RuntimeMcpServerStatus;
  readonly toolCount: number | null;
  readonly requiresAuth: boolean;
  /** True when Droid already holds OAuth tokens for this server. */
  readonly hasAuthTokens: boolean;
  readonly tools: readonly RuntimeMcpTool[];
}

export const RUNTIME_MCP_SERVER_TYPES = [
  'stdio',
  'http',
  'sse',
] as const;
export type RuntimeMcpServerType =
  (typeof RUNTIME_MCP_SERVER_TYPES)[number];

export interface RuntimeMcpServerAddParams {
  readonly name: string;
  readonly serverType: RuntimeMcpServerType;
  /** Launch command for stdio servers. */
  readonly command?: string;
  readonly args?: readonly string[];
  /** Endpoint URL for http and sse servers. */
  readonly url?: string;
}

export const RUNTIME_MCP_AUTH_OUTCOMES = [
  'success',
  'cancelled',
  'failed',
] as const;
export type RuntimeMcpAuthOutcome =
  (typeof RUNTIME_MCP_AUTH_OUTCOMES)[number];

/** Longest accepted OAuth URL for an MCP authentication flow. */
export const MAX_RUNTIME_MCP_AUTH_URL_LENGTH = 2048;

export interface RuntimeMcpAuthStart {
  /**
   * Browser URL the user must visit to finish authentication, or null
   * when Droid reported no OAuth step for this server.
   */
  readonly authUrl: string | null;
}

export const MAX_RUNTIME_ATTACHMENTS = 8;
/** Base64 payload cap for one image attachment (~4 MiB decoded). */
export const MAX_RUNTIME_IMAGE_BASE64_LENGTH = 6 * 1024 * 1024;
/** Base64 payload cap for one PDF attachment (~6 MiB decoded). */
export const MAX_RUNTIME_PDF_BASE64_LENGTH = 8 * 1024 * 1024;
/** Character cap for one text attachment. */
export const MAX_RUNTIME_TEXT_ATTACHMENT_LENGTH = 256 * 1024;

export const RUNTIME_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
export type RuntimeImageMediaType =
  (typeof RUNTIME_IMAGE_MEDIA_TYPES)[number];

export type RuntimeAttachment =
  | {
      readonly kind: 'image';
      readonly data: string;
      readonly mediaType: RuntimeImageMediaType;
    }
  | {
      readonly kind: 'pdf';
      readonly data: string;
      readonly name: string;
    }
  | {
      readonly kind: 'text';
      readonly data: string;
      readonly name: string;
    };

export interface RuntimeRewindParams {
  readonly messageId: string;
  readonly forkTitle: string;
  /**
   * When true, restores files Droid changed after the anchor message
   * and deletes files it created, returning the workspace to that
   * point. Defaults to keeping the current workspace untouched.
   */
  readonly restoreFiles?: boolean;
}

export interface RuntimeRewindResult {
  readonly sessionId: string;
}

/** How a rewind would affect workspace files, as counts only. */
export interface RuntimeRewindInfo {
  /** Files Droid changed after the anchor that a rewind can restore. */
  readonly restorableCount: number;
  /** Files Droid created after the anchor that a rewind can delete. */
  readonly createdCount: number;
}

export interface RuntimeCompactResult {
  readonly sessionId: string;
  readonly removedCount: number;
}

export interface RuntimeForkResult {
  readonly sessionId: string;
}

export interface DroidRuntime {
  initialize(
    target: RuntimeSessionTarget | string,
  ): Promise<RuntimeAvailability>;
  /**
   * Actual working directory of the active session as reported by the
   * session backend, or null when unknown. For daemon worktree
   * sessions this is the worktree path (differing from the target
   * cwd); the SDK facade exposes no other worktree metadata, so the
   * host recovers the branch from git using this path.
   */
  getSessionCwd?(): string | null;
  readSessionSettings(): Promise<RuntimeSessionSettings>;
  readContextStats(): Promise<RuntimeContextStats>;
  readModelCatalog(): Promise<RuntimeModelCatalog>;
  updateSessionSetting(
    update: RuntimeSessionSettingUpdate,
  ): Promise<RuntimeSessionSettings>;
  sendTurn(
    text: string,
    attachments?: readonly RuntimeAttachment[],
  ): AsyncIterable<RuntimeEvent>;
  interrupt(): Promise<void>;
  /**
   * Reads the backend-side working state of the active session (see
   * `RuntimeSessionWorkingState`). Throws when the session backend
   * cannot report one (process mode, where a turn can only run inside
   * this window). Reload reconciliation polls this to know when a
   * daemon-side in-flight turn has finished.
   */
  readSessionWorkingState?(): Promise<RuntimeSessionWorkingState>;
  /**
   * Interrupts the session's backend-side turn even when this runtime
   * has no locally streaming turn. `interrupt()` deliberately no-ops
   * without an active local turn; this is the Stop entry point for a
   * daemon-side turn recovered after a reload.
   */
  interruptSession?(): Promise<void>;
  /**
   * Rewinds the active session to the given user message, forking a new
   * session that this runtime then targets. Optional: absent when the
   * runtime cannot rewind.
   */
  rewind?(params: RuntimeRewindParams): Promise<RuntimeRewindResult>;
  /**
   * Reports how rewinding to the given user message would affect
   * workspace files. Optional: absent when the runtime cannot rewind.
   */
  getRewindInfo?(messageId: string): Promise<RuntimeRewindInfo>;
  /**
   * Compacts the active session's context: Droid summarizes older
   * messages into a continuation session that this runtime then
   * targets. Optional: absent when the runtime cannot compact.
   */
  compact?(): Promise<RuntimeCompactResult>;
  /**
   * Forks the active session: Droid copies the conversation into a
   * new session that this runtime then targets, while the original
   * session stays untouched on disk. Optional: absent when the
   * runtime cannot fork.
   */
  fork?(title: string): Promise<RuntimeForkResult>;
  /**
   * Renames the active session. Optional: absent when the runtime
   * cannot rename sessions.
   */
  rename?(title: string): Promise<void>;
  /**
   * Lists the Droid skills visible to the active session, projected to
   * safe display fields. Optional: absent when unsupported.
   */
  listSkills?(): Promise<readonly RuntimeSkill[]>;
  /**
   * Enables or disables a skill by name. Optional: absent when
   * unsupported.
   */
  setSkillDisabled?(name: string, disabled: boolean): Promise<void>;
  /**
   * Lists the custom slash commands visible to the active session,
   * projected to safe display fields. Optional: absent when
   * unsupported.
   */
  listCommands?(): Promise<readonly RuntimeCommand[]>;
  /**
   * Lists MCP servers with their tools, projected to safe display
   * fields. Optional: absent when unsupported.
   */
  listMcpServers?(): Promise<readonly RuntimeMcpServer[]>;
  /**
   * Enables or disables an MCP server by name at the user settings
   * level. Optional: absent when unsupported.
   */
  setMcpServerEnabled?(name: string, enabled: boolean): Promise<void>;
  /**
   * Registers a new MCP server at the user settings level. Optional:
   * absent when unsupported.
   */
  addMcpServer?(params: RuntimeMcpServerAddParams): Promise<void>;
  /**
   * Removes an MCP server by name at the user settings level.
   * Optional: absent when unsupported.
   */
  removeMcpServer?(name: string): Promise<void>;
  /**
   * Starts OAuth authentication for an MCP server. Resolves with the
   * browser URL once Droid reports it (or null when no OAuth step is
   * needed). `onCompleted` fires at most once when Droid later reports
   * the flow's outcome. Optional: absent when unsupported.
   */
  authenticateMcpServer?(
    name: string,
    onCompleted: (outcome: RuntimeMcpAuthOutcome) => void,
  ): Promise<RuntimeMcpAuthStart>;
  dispose(): Promise<void>;
}
