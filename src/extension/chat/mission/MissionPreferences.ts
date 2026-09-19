import type {
  MissionProfile,
  MissionReasoningEffort,
} from '../../../shared/protocol/missionProtocol';
import {
  missionPairError,
  resolveMissionProfile,
} from '../../../shared/protocol/missionProtocol';

const STORAGE_KEY = 'droidvisx.mission.preferences.v1';

export interface MissionPreferencePersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface MissionProfilePair {
  readonly modelId: string;
  readonly reasoningEffort: MissionReasoningEffort;
}

export interface MissionWorkspacePreferences {
  readonly worker: MissionProfile;
  readonly validator: MissionProfile;
  readonly scrutinyEnabled: boolean;
  readonly userTestingEnabled: boolean;
}

export interface MissionCatalogModel {
  readonly id: string;
  readonly supportedReasoningEfforts: readonly string[];
}

export type MissionPreferenceValidation =
  | { readonly valid: true; readonly value: MissionWorkspacePreferences }
  | {
      readonly valid: false;
      readonly reason: 'unavailable-model' | 'unsupported-reasoning';
    };

/**
 * Stores only advisory setup choices. The selected chat's model pair is
 * deliberately supplied at read time, so preferences cannot replace it.
 */
export class MissionPreferenceStore {
  constructor(private readonly persistence: MissionPreferencePersistence) {}

  read(
    workspaceId: string,
    orchestrator: MissionProfilePair,
  ): MissionWorkspacePreferences {
    const stored = this.persistence.get<unknown>(STORAGE_KEY);
    const saved =
      stored !== null && typeof stored === 'object' && !Array.isArray(stored)
        ? parsePreferences((stored as Readonly<Record<string, unknown>>)[workspaceId])
        : undefined;
    return saved === undefined
      ? defaults(orchestrator)
      : applyInheritance(saved, orchestrator);
  }

  async save(
    workspaceId: string,
    preferences: MissionWorkspacePreferences,
  ): Promise<void> {
    await this.persistence.update(STORAGE_KEY, {
      ...this.readAll(),
      [workspaceId]: clonePreferences(preferences),
    });
  }

  validate(
    workspaceId: string,
    orchestrator: MissionProfilePair,
    catalog: readonly MissionCatalogModel[],
  ): MissionPreferenceValidation {
    const value = this.read(workspaceId, orchestrator);
    return validatePreferences(value, catalog);
  }

  private readAll(): Readonly<Record<string, MissionWorkspacePreferences>> {
    const stored = this.persistence.get<unknown>(STORAGE_KEY);
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    const entries: Record<string, MissionWorkspacePreferences> = {};
    for (const [workspaceId, value] of Object.entries(stored)) {
      const parsed = parsePreferences(value);
      if (parsed !== undefined) {
        entries[workspaceId] = parsed;
      }
    }
    return entries;
  }
}

export function validatePreferences(
  preferences: MissionWorkspacePreferences,
  catalog: readonly MissionCatalogModel[],
): MissionPreferenceValidation {
  for (const profile of [preferences.worker, preferences.validator]) {
    const result = validatePair(profile, catalog);
    if (result !== undefined) {
      return result;
    }
  }
  return { valid: true, value: preferences };
}

export function validatePair(
  profile: MissionProfilePair,
  catalog: readonly MissionCatalogModel[],
): Exclude<MissionPreferenceValidation, { readonly valid: true }> | undefined {
  const reason = missionPairError(profile, catalog);
  return reason === undefined ? undefined : { valid: false, reason };
}

function defaults(orchestrator: MissionProfilePair): MissionWorkspacePreferences {
  return {
    worker: { mode: 'same-as-orchestrator', ...orchestrator },
    validator: { mode: 'same-as-orchestrator', ...orchestrator },
    scrutinyEnabled: true,
    userTestingEnabled: true,
  };
}

function clonePreferences(
  value: MissionWorkspacePreferences,
): MissionWorkspacePreferences {
  return {
    worker: { ...value.worker },
    validator: { ...value.validator },
    scrutinyEnabled: value.scrutinyEnabled,
    userTestingEnabled: value.userTestingEnabled,
  };
}

function applyInheritance(
  saved: MissionWorkspacePreferences,
  orchestrator: MissionProfilePair,
): MissionWorkspacePreferences {
  return {
    worker: resolveMissionProfile(saved.worker, orchestrator),
    validator: resolveMissionProfile(saved.validator, orchestrator),
    scrutinyEnabled: saved.scrutinyEnabled,
    userTestingEnabled: saved.userTestingEnabled,
  };
}

function parsePreferences(value: unknown): MissionWorkspacePreferences | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<MissionWorkspacePreferences>;
  const worker = parseProfile(candidate.worker);
  const validator = parseProfile(candidate.validator);
  if (
    worker === undefined ||
    validator === undefined ||
    typeof candidate.scrutinyEnabled !== 'boolean' ||
    typeof candidate.userTestingEnabled !== 'boolean'
  ) {
    return undefined;
  }
  return {
    worker,
    validator,
    scrutinyEnabled: candidate.scrutinyEnabled,
    userTestingEnabled: candidate.userTestingEnabled,
  };
}

function parseProfile(value: unknown): MissionProfile | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<MissionProfile>;
  if (
    (candidate.mode !== 'same-as-orchestrator' && candidate.mode !== 'override') ||
    typeof candidate.modelId !== 'string' ||
    typeof candidate.reasoningEffort !== 'string'
  ) {
    return undefined;
  }
  return {
    mode: candidate.mode,
    modelId: candidate.modelId,
    reasoningEffort: candidate.reasoningEffort as MissionReasoningEffort,
  };
}
