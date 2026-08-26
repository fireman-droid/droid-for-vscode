import {
  MISSION_REASONING_EFFORTS,
  isMissionTaskDraftText,
  parseMissionSetupCapabilities,
  type MissionProfile,
  type MissionReasoningEffort,
  type MissionSetupCapabilities,
} from './missionProtocol';
import { hasExactKeys, isStrictRecord } from './strictValidation';
import { isSafeModelId } from './validateMessage';

import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from './missionControlProtocolVersion';

export const MISSION_CONTROL_SETUP_PHASES = [
  'draft',
  'inspecting',
  'advisory',
  'starting',
  'indeterminate',
] as const;
export type MissionControlSetupPhase =
  (typeof MISSION_CONTROL_SETUP_PHASES)[number];

export const MISSION_CONTROL_SETUP_AVAILABILITIES = [
  'ready',
  'unavailable',
  'loading',
  'error',
  'busy',
] as const;
export type MissionControlSetupAvailability =
  (typeof MISSION_CONTROL_SETUP_AVAILABILITIES)[number];

export const MISSION_CONTROL_SETUP_REASONS = [
  'gateway-unavailable',
  'workspace-unavailable',
  'connection-unavailable',
  'selected-chat-unavailable',
  'settings-loading',
  'settings-error',
  'model-catalog-loading',
  'model-catalog-error',
  'model-catalog-unsupported',
  'chat-busy',
] as const;
export type MissionControlSetupReason =
  (typeof MISSION_CONTROL_SETUP_REASONS)[number];

export interface MissionControlSetupDraft {
  readonly task: string;
  readonly orchestrator: Omit<MissionProfile, 'mode'> | null;
  readonly worker: MissionProfile | null;
  readonly validator: MissionProfile | null;
  readonly scrutinyEnabled: boolean;
  readonly userTestingEnabled: boolean;
}

export interface MissionControlSetupUpdateMessage {
  readonly type: 'missionControl.setup.update';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly setupRevision: number;
  readonly workspaceAuthorityRevision: number;
  readonly chatOwnerRevision: number;
  readonly draft: MissionControlSetupDraft;
}

export const MISSION_READINESS_WARNINGS = [
  'no_git',
  'no_remote',
  'no_report',
  'low_score',
] as const;
export type MissionReadinessWarning =
  (typeof MISSION_READINESS_WARNINGS)[number];

export interface MissionControlSetupContinueMessage {
  readonly type: 'missionControl.setup.continue';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly setupRevision: number;
}

export interface MissionControlSetupSnapshotMessage {
  readonly type: 'missionControl.setup.snapshot';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly setupRevision: number;
  readonly workspaceAuthorityRevision: number;
  readonly chatOwnerRevision: number;
  readonly phase: MissionControlSetupPhase;
  readonly availability: MissionControlSetupAvailability;
  readonly reason: MissionControlSetupReason | null;
  readonly readiness: {
    readonly warning: MissionReadinessWarning;
    readonly level: number | null;
  } | null;
  readonly draft: MissionControlSetupDraft;
  readonly capabilities: MissionSetupCapabilities | null;
}

const PHASES = new Set<string>(MISSION_CONTROL_SETUP_PHASES);
const AVAILABILITIES = new Set<string>(
  MISSION_CONTROL_SETUP_AVAILABILITIES,
);
const REASONS = new Set<string>(MISSION_CONTROL_SETUP_REASONS);
const EFFORTS = new Set<string>(MISSION_REASONING_EFFORTS);
const READINESS_WARNINGS = new Set<string>(MISSION_READINESS_WARNINGS);

export function parseMissionControlSetupWebviewMessage(
  value: unknown,
): MissionControlSetupUpdateMessage | MissionControlSetupContinueMessage | undefined {
  if (
    isStrictRecord(value) &&
    hasExactKeys(value, [
      'type',
      'protocolVersion',
      'requestId',
      'setupRevision',
    ]) &&
    value.type === 'missionControl.setup.continue' &&
    value.protocolVersion === MISSION_CONTROL_PANEL_PROTOCOL_VERSION &&
    isRequestId(value.requestId) &&
    isRevision(value.setupRevision)
  ) {
    return {
      type: 'missionControl.setup.continue',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: value.requestId,
      setupRevision: value.setupRevision,
    };
  }
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'requestId',
      'setupRevision',
      'workspaceAuthorityRevision',
      'chatOwnerRevision',
      'draft',
    ]) ||
    value.type !== 'missionControl.setup.update' ||
    value.protocolVersion !== MISSION_CONTROL_PANEL_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    !isRevision(value.setupRevision) ||
    !isRevision(value.workspaceAuthorityRevision) ||
    !isRevision(value.chatOwnerRevision)
  ) {
    return undefined;
  }
  const draft = parseMissionControlSetupDraft(value.draft);
  return draft === undefined
    ? undefined
    : {
        type: 'missionControl.setup.update',
        protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        requestId: value.requestId,
        setupRevision: value.setupRevision,
        workspaceAuthorityRevision: value.workspaceAuthorityRevision,
        chatOwnerRevision: value.chatOwnerRevision,
        draft,
      };
}

export function parseMissionControlSetupHostMessage(
  value: unknown,
): MissionControlSetupSnapshotMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'sequence',
      'setupRevision',
      'workspaceAuthorityRevision',
      'chatOwnerRevision',
      'phase',
      'availability',
      'reason',
      'readiness',
      'draft',
      'capabilities',
    ]) ||
    value.type !== 'missionControl.setup.snapshot' ||
    value.protocolVersion !== MISSION_CONTROL_PANEL_PROTOCOL_VERSION ||
    !isRevision(value.sequence) ||
    !isRevision(value.setupRevision) ||
    !isRevision(value.workspaceAuthorityRevision) ||
    !isRevision(value.chatOwnerRevision) ||
    typeof value.phase !== 'string' ||
    !PHASES.has(value.phase) ||
    typeof value.availability !== 'string' ||
    !AVAILABILITIES.has(value.availability) ||
    !isSetupReason(value.reason)
  ) {
    return undefined;
  }
  const readiness = parseReadiness(value.readiness);
  const draft = parseMissionControlSetupDraft(value.draft);
  const capabilities =
    value.capabilities === null
      ? null
      : parseMissionSetupCapabilities(value.capabilities);
  if (
    readiness === undefined ||
    draft === undefined ||
    capabilities === undefined ||
    (value.availability === 'ready'
      ? value.reason !== null || capabilities === null
      : value.reason === null)
  ) {
    return undefined;
  }
  return {
    type: 'missionControl.setup.snapshot',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    sequence: value.sequence,
    setupRevision: value.setupRevision,
    workspaceAuthorityRevision: value.workspaceAuthorityRevision,
    chatOwnerRevision: value.chatOwnerRevision,
    phase: value.phase as MissionControlSetupPhase,
    availability: value.availability as MissionControlSetupAvailability,
    reason: value.reason as MissionControlSetupReason | null,
    readiness,
    draft,
    capabilities,
  };
}

function parseReadiness(
  value: unknown,
): MissionControlSetupSnapshotMessage['readiness'] | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['warning', 'level']) ||
    typeof value.warning !== 'string' ||
    !READINESS_WARNINGS.has(value.warning) ||
    !(
      value.level === null ||
      (Number.isSafeInteger(value.level) &&
        (value.level as number) >= 1 &&
        (value.level as number) <= 5)
    )
  ) {
    return undefined;
  }
  return {
    warning: value.warning as MissionReadinessWarning,
    level: value.level as number | null,
  };
}

export function parseMissionControlSetupDraft(
  value: unknown,
): MissionControlSetupDraft | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'task',
      'orchestrator',
      'worker',
      'validator',
      'scrutinyEnabled',
      'userTestingEnabled',
    ]) ||
    !isMissionTaskDraftText(value.task) ||
    typeof value.scrutinyEnabled !== 'boolean' ||
    typeof value.userTestingEnabled !== 'boolean'
  ) {
    return undefined;
  }
  if (
    value.orchestrator === null &&
    value.worker === null &&
    value.validator === null
  ) {
    return {
      task: value.task,
      orchestrator: null,
      worker: null,
      validator: null,
      scrutinyEnabled: value.scrutinyEnabled,
      userTestingEnabled: value.userTestingEnabled,
    };
  }
  const orchestrator = parsePair(value.orchestrator);
  const worker = parseProfile(value.worker, orchestrator);
  const validator = parseProfile(value.validator, orchestrator);
  if (
    orchestrator === undefined ||
    worker === undefined ||
    validator === undefined
  ) {
    return undefined;
  }
  return {
    task: value.task,
    orchestrator,
    worker,
    validator,
    scrutinyEnabled: value.scrutinyEnabled,
    userTestingEnabled: value.userTestingEnabled,
  };
}

function parsePair(
  value: unknown,
): Omit<MissionProfile, 'mode'> | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['modelId', 'reasoningEffort']) ||
    !isSafeModelId(value.modelId) ||
    !isEffort(value.reasoningEffort)
  ) {
    return undefined;
  }
  return {
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
  };
}

function parseProfile(
  value: unknown,
  orchestrator: Omit<MissionProfile, 'mode'> | undefined,
): MissionProfile | undefined {
  if (
    orchestrator === undefined ||
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['mode', 'modelId', 'reasoningEffort']) ||
    (value.mode !== 'same-as-orchestrator' && value.mode !== 'override') ||
    !isSafeModelId(value.modelId) ||
    !isEffort(value.reasoningEffort) ||
    (value.mode === 'same-as-orchestrator' &&
      (value.modelId !== orchestrator.modelId ||
        value.reasoningEffort !== orchestrator.reasoningEffort))
  ) {
    return undefined;
  }
  return {
    mode: value.mode,
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
  };
}

function isEffort(value: unknown): value is MissionReasoningEffort {
  return typeof value === 'string' && EFFORTS.has(value);
}

function isSetupReason(
  value: unknown,
): value is MissionControlSetupReason | null {
  return value === null || (typeof value === 'string' && REASONS.has(value));
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
