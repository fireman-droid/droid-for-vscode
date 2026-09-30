import {
  MAX_MISSION_FEATURES,
  MAX_MISSION_FEATURE_ID_LENGTH,
  MAX_MISSION_TASK_LENGTH,
  MISSION_LIFECYCLES,
  type MissionLifecycle,
} from '../../shared/protocol/missionProtocol';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/validation/strictValidation';
import type {
  MissionProgressSummary,
  MissionRuntimeFeature,
  RuntimeEvent,
} from '../runtimeEvents';

const FEATURE_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const LIFECYCLES = new Set<string>(MISSION_LIFECYCLES);
const MAX_PROGRESS_ENTRIES = 1_000;
const MAX_TIMESTAMP_LENGTH = 64;

export function normalizeMissionEvent(
  value: unknown,
): Extract<RuntimeEvent, { type: `mission-${string}` }> | undefined {
  if (!isStrictRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  switch (value.type) {
    case 'mission_state_changed':
      return normalizeState(value);
    case 'mission_features_changed':
      return normalizeFeatures(value);
    case 'mission_progress_entry':
      return normalizeProgress(value);
    case 'mission_heartbeat':
      return normalizeHeartbeat(value);
    case 'mission_worker_started':
      return normalizeWorkerStarted(value);
    case 'mission_worker_completed':
      return normalizeWorkerCompleted(value);
    default:
      return undefined;
  }
}

function normalizeState(
  value: UnknownRecord,
): Extract<RuntimeEvent, { type: 'mission-state' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'state'], ['updatedAt']) ||
    typeof value.state !== 'string' ||
    !LIFECYCLES.has(value.state) ||
    (value.updatedAt !== undefined && !isTimestamp(value.updatedAt))
  ) {
    return undefined;
  }
  return {
    type: 'mission-state',
    lifecycle: value.state as MissionLifecycle,
  };
}

function normalizeFeatures(
  value: UnknownRecord,
): Extract<RuntimeEvent, { type: 'mission-features' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'features']) ||
    !isExactArray(value.features, 0, MAX_MISSION_FEATURES)
  ) {
    return undefined;
  }
  const features: MissionRuntimeFeature[] = [];
  const ids = new Set<string>();
  for (const candidate of value.features) {
    const feature = readFeature(candidate);
    if (feature === undefined || ids.has(feature.id)) {
      return undefined;
    }
    ids.add(feature.id);
    features.push(feature);
  }
  return { type: 'mission-features', features };
}

function readFeature(value: unknown): MissionRuntimeFeature | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['id', 'description', 'status', 'skillName', 'preconditions', 'expectedBehavior'],
      [
        'fulfills',
        'milestone',
        'workerSessionIds',
        'currentWorkerSessionId',
        'completedWorkerSessionId',
      ],
    ) ||
    !isId(value.id) ||
    !isText(value.description, MAX_MISSION_TASK_LENGTH, true) ||
    typeof value.status !== 'string' ||
    !FEATURE_STATUSES.has(value.status) ||
    !isText(value.skillName, MAX_MISSION_FEATURE_ID_LENGTH) ||
    !isTextArray(value.preconditions, MAX_MISSION_FEATURES, true) ||
    !isTextArray(value.expectedBehavior, MAX_MISSION_FEATURES, true) ||
    (value.fulfills !== undefined &&
      !isTextArray(value.fulfills, MAX_MISSION_FEATURES)) ||
    (value.milestone !== undefined &&
      !isText(value.milestone, MAX_MISSION_FEATURE_ID_LENGTH)) ||
    (value.workerSessionIds !== undefined && !isIdArray(value.workerSessionIds)) ||
    (value.currentWorkerSessionId !== undefined &&
      value.currentWorkerSessionId !== null &&
      !isId(value.currentWorkerSessionId)) ||
    (value.completedWorkerSessionId !== undefined &&
      value.completedWorkerSessionId !== null &&
      !isId(value.completedWorkerSessionId))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    description: value.description,
    status: value.status as MissionRuntimeFeature['status'],
    skillName: value.skillName,
    ...(value.milestone === undefined ? {} : { milestone: value.milestone }),
    ...(value.workerSessionIds === undefined ? {} : { workerSessionIds: value.workerSessionIds }),
    ...(value.currentWorkerSessionId === undefined
      ? {} : { currentWorkerSessionId: value.currentWorkerSessionId }),
    ...(value.completedWorkerSessionId === undefined
      ? {} : { completedWorkerSessionId: value.completedWorkerSessionId }),
  };
}

function normalizeProgress(
  value: UnknownRecord,
): Extract<RuntimeEvent, { type: 'mission-progress' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'progressLog']) ||
    !isExactArray(value.progressLog, 0, MAX_PROGRESS_ENTRIES)
  ) {
    return undefined;
  }
  const entries: MissionProgressSummary[] = [];
  for (const candidate of value.progressLog) {
    const entry = readProgressEntry(candidate);
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }
  return { type: 'mission-progress', entries };
}

function readProgressEntry(value: unknown): MissionProgressSummary | undefined {
  if (
    !isStrictRecord(value) ||
    typeof value.type !== 'string' ||
    !isTimestamp(value.timestamp)
  ) {
    return undefined;
  }
  const base = { type: value.type, timestamp: value.timestamp };
  switch (value.type) {
    case 'mission_accepted':
      return hasExactKeys(value, ['type', 'timestamp', 'title']) &&
        isText(value.title, MAX_MISSION_TASK_LENGTH)
        ? { ...base, type: value.type, title: value.title }
        : undefined;
    case 'mission_paused':
      return hasExactKeys(value, ['type', 'timestamp'], ['pauseReason'])
        ? { ...base, type: value.type }
        : undefined;
    case 'mission_resumed':
      return hasExactKeys(value, ['type', 'timestamp'], ['resumeWorkerSessionId']) &&
        (value.resumeWorkerSessionId === undefined || isId(value.resumeWorkerSessionId))
        ? {
            ...base, type: value.type,
            ...(value.resumeWorkerSessionId === undefined
              ? {} : { resumeWorkerSessionId: value.resumeWorkerSessionId }),
          }
        : undefined;
    case 'mission_run_started':
      return hasExactKeys(value, ['type', 'timestamp'], ['message']) &&
        (value.message === undefined || isText(value.message, MAX_MISSION_TASK_LENGTH))
        ? { ...base, type: value.type }
        : undefined;
    case 'worker_started':
      return hasExactKeys(
        value,
        ['type', 'timestamp', 'workerSessionId', 'spawnId'],
        ['featureId', 'modelId', 'substitutedFromModelId'],
      ) &&
        isId(value.workerSessionId) &&
        isId(value.spawnId) &&
        (value.featureId === undefined || isId(value.featureId)) &&
        (value.modelId === undefined || typeof value.modelId === 'string') &&
        (value.substitutedFromModelId === undefined || typeof value.substitutedFromModelId === 'string')
        ? {
            ...base,
            type: value.type,
            workerSessionId: value.workerSessionId,
            ...(value.featureId === undefined ? {} : { featureId: value.featureId }),
          }
        : undefined;
    case 'worker_selected_feature':
      return hasExactKeys(value, ['type', 'timestamp', 'workerSessionId', 'featureId']) &&
        isId(value.workerSessionId) &&
        isId(value.featureId)
        ? {
            ...base,
            type: value.type,
            workerSessionId: value.workerSessionId,
            featureId: value.featureId,
          }
        : undefined;
    case 'worker_completed':
      return hasExactKeys(
        value,
        [
          'type',
          'timestamp',
          'workerSessionId',
          'featureId',
          'successState',
          'returnToOrchestrator',
          'exitCode',
        ],
        ['commitId', 'repoPath', 'validatorsPassed', 'handoff'],
      ) &&
        isId(value.workerSessionId) &&
        isId(value.featureId) &&
        (value.successState === 'success' ||
          value.successState === 'partial' ||
          value.successState === 'failure') &&
        typeof value.returnToOrchestrator === 'boolean' &&
        Number.isSafeInteger(value.exitCode) &&
        (value.handoff === undefined || isStrictRecord(value.handoff))
        ? {
            ...base,
            type: value.type,
            workerSessionId: value.workerSessionId,
            featureId: value.featureId,
            exitCode: value.exitCode as number,
          }
        : undefined;
    case 'worker_failed':
      return hasExactKeys(
        value,
        ['type', 'timestamp', 'spawnId', 'reason'],
        ['workerSessionId', 'exitCode', 'failureReason'],
      ) &&
        isId(value.spawnId) &&
        isText(value.reason, MAX_MISSION_TASK_LENGTH, true) &&
        (value.workerSessionId === undefined || isId(value.workerSessionId)) &&
        (value.exitCode === undefined || Number.isSafeInteger(value.exitCode))
        ? {
            ...base,
            type: value.type,
            ...(value.workerSessionId === undefined
              ? {}
              : { workerSessionId: value.workerSessionId }),
            ...(value.exitCode === undefined
              ? {}
              : { exitCode: value.exitCode as number }),
          }
        : undefined;
    case 'worker_paused':
      return hasExactKeys(
        value,
        ['type', 'timestamp', 'workerSessionId'],
        ['featureId'],
      ) &&
        isId(value.workerSessionId) &&
        (value.featureId === undefined || isId(value.featureId))
        ? {
            ...base,
            type: value.type,
            workerSessionId: value.workerSessionId,
            ...(value.featureId === undefined ? {} : { featureId: value.featureId }),
          }
        : undefined;
    case 'handoff_items_dismissed':
      return hasExactKeys(value, ['type', 'timestamp'], ['dismissals']) &&
        (value.dismissals === undefined ||
          isExactArray(value.dismissals, 0, MAX_MISSION_FEATURES))
        ? { ...base, type: value.type }
        : undefined;
    case 'milestone_validation_triggered':
      return hasExactKeys(value, ['type', 'timestamp', 'milestone', 'featureId']) &&
        isText(value.milestone, MAX_MISSION_FEATURE_ID_LENGTH) &&
        isId(value.featureId)
        ? { ...base, type: value.type, featureId: value.featureId }
        : undefined;
    default:
      return undefined;
  }
}

function normalizeHeartbeat(
  value: UnknownRecord,
): Extract<RuntimeEvent, { type: 'mission-heartbeat' }> | undefined {
  return hasExactKeys(value, ['type', 'timestamp']) && isTimestamp(value.timestamp)
    ? { type: 'mission-heartbeat', timestamp: value.timestamp }
    : undefined;
}

function normalizeWorkerStarted(
  value: UnknownRecord,
): Extract<RuntimeEvent, { type: 'mission-worker-started' }> | undefined {
  return hasExactKeys(value, ['type', 'workerSessionId']) && isId(value.workerSessionId)
    ? { type: 'mission-worker-started', workerSessionId: value.workerSessionId }
    : undefined;
}

function normalizeWorkerCompleted(
  value: UnknownRecord,
): Extract<RuntimeEvent, { type: 'mission-worker-completed' }> | undefined {
  return hasExactKeys(value, ['type', 'workerSessionId', 'exitCode']) &&
    isId(value.workerSessionId) &&
    Number.isSafeInteger(value.exitCode)
    ? {
        type: 'mission-worker-completed',
        workerSessionId: value.workerSessionId,
        exitCode: value.exitCode as number,
      }
    : undefined;
}

function isText(value: unknown, maximum: number, multiline = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
      : /[\u0000-\u001f\u007f-\u009f]/).test(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    isText(value, MAX_TIMESTAMP_LENGTH) &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MISSION_FEATURE_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isIdArray(value: unknown): value is string[] {
  return (
    isExactArray(value, 0, MAX_MISSION_FEATURES) && value.every((item) => isId(item))
  );
}

function isTextArray(value: unknown, maximum: number, multiline = false): value is string[] {
  return (
    isExactArray(value, 0, maximum) &&
    value.every((item) => isText(item, MAX_MISSION_TASK_LENGTH, multiline))
  );
}
