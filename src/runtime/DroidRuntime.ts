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

export interface RuntimeRewindParams {
  readonly messageId: string;
  readonly forkTitle: string;
}

export interface RuntimeRewindResult {
  readonly sessionId: string;
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
  sendTurn(text: string): AsyncIterable<RuntimeEvent>;
  interrupt(): Promise<void>;
  /**
   * Rewinds the active session to the given user message, forking a new
   * session that this runtime then targets. Optional: absent when the
   * runtime cannot rewind.
   */
  rewind?(params: RuntimeRewindParams): Promise<RuntimeRewindResult>;
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
  dispose(): Promise<void>;
}
