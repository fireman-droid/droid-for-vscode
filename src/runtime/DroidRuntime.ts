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
    };

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
  readonly tools: readonly RuntimeMcpTool[];
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
}

export interface RuntimeRewindResult {
  readonly sessionId: string;
}

export interface RuntimeCompactResult {
  readonly sessionId: string;
  readonly removedCount: number;
}

export interface DroidRuntime {
  initialize(
    target: RuntimeSessionTarget | string,
  ): Promise<RuntimeAvailability>;
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
   * Rewinds the active session to the given user message, forking a new
   * session that this runtime then targets. Optional: absent when the
   * runtime cannot rewind.
   */
  rewind?(params: RuntimeRewindParams): Promise<RuntimeRewindResult>;
  /**
   * Compacts the active session's context: Droid summarizes older
   * messages into a continuation session that this runtime then
   * targets. Optional: absent when the runtime cannot compact.
   */
  compact?(): Promise<RuntimeCompactResult>;
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
   * Lists MCP servers with their tools, projected to safe display
   * fields. Optional: absent when unsupported.
   */
  listMcpServers?(): Promise<readonly RuntimeMcpServer[]>;
  /**
   * Enables or disables an MCP server by name at the user settings
   * level. Optional: absent when unsupported.
   */
  setMcpServerEnabled?(name: string, enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}
