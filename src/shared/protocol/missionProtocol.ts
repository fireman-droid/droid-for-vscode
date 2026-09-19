import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../validation/strictValidation';

/**
 * Mission messages were added after Bridge v24. They intentionally use a
 * fixed version so stale Webviews cannot turn an unknown payload into a
 * Mission operation.
 */
export const MISSION_BRIDGE_PROTOCOL_VERSION = 25 as const;
export const MAX_MISSION_TASK_LENGTH = 20_000;
export const MAX_MISSION_FEATURES = 200;
export const MAX_MISSION_FEATURE_ID_LENGTH = 128;
export const MAX_MISSION_FEATURE_TEXT_LENGTH = 512;
export const MAX_MISSION_SNAPSHOT_TITLE_LENGTH = 256;

export const MISSION_REASONING_EFFORTS = [
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
export type MissionReasoningEffort = (typeof MISSION_REASONING_EFFORTS)[number];

export const MISSION_LIFECYCLES = [
  'planning',
  'awaiting_input',
  'initializing',
  'running',
  'paused',
  'orchestrator_turn',
  'completed',
] as const;
export type MissionLifecycle = (typeof MISSION_LIFECYCLES)[number];

export type MissionProfileMode = 'same-as-orchestrator' | 'override';

export interface MissionProfile {
  readonly mode: MissionProfileMode;
  readonly modelId: string;
  readonly reasoningEffort: MissionReasoningEffort;
}

export function resolveMissionProfile(
  profile: MissionProfile,
  orchestrator: Omit<MissionProfile, 'mode'>,
): MissionProfile {
  return profile.mode === 'same-as-orchestrator'
    ? { mode: 'same-as-orchestrator', ...orchestrator }
    : profile;
}

export function missionPairError(
  pair: Omit<MissionProfile, 'mode'>,
  catalog: readonly {
    readonly id: string;
    readonly supportedReasoningEfforts: readonly string[];
  }[],
): 'unavailable-model' | 'unsupported-reasoning' | undefined {
  const model = catalog.find((candidate) => candidate.id === pair.modelId);
  if (model === undefined) {
    return 'unavailable-model';
  }
  return model.supportedReasoningEfforts.includes(pair.reasoningEffort)
    ? undefined
    : 'unsupported-reasoning';
}

export function isMissionTaskText(value: unknown): value is string {
  return isMissionTaskDraftText(value) && value.length > 0 && value.trim() === value;
}

export function isMissionTaskDraftText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_MISSION_TASK_LENGTH &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)
  );
}

export function normalizeMissionTaskText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return isMissionTaskText(normalized) ? normalized : undefined;
}

export interface MissionStartMessage {
  readonly type: 'mission.start';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  /** Deliberately not a Session ID. Host resolves the selected chat. */
  readonly scope: 'selected-chat';
  readonly task: string;
  readonly orchestrator: Omit<MissionProfile, 'mode'>;
  readonly worker: MissionProfile;
  readonly validator: MissionProfile;
  readonly scrutinyEnabled: boolean;
  readonly userTestingEnabled: boolean;
}

export interface MissionControlMessage {
  readonly type:
    | 'mission.dismissSetup'
    | 'mission.pause'
    | 'mission.resume'
    | 'mission.stopCurrentFeature'
    | 'mission.refresh';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly scope: 'selected-chat';
  readonly snapshotRevision: number;
}

export interface MissionDisclosureMessage {
  readonly type: 'mission.disclosure.set';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly scope: 'selected-chat';
  readonly expanded: boolean;
}

export interface MissionViewerOpenMessage {
  readonly type: 'mission.viewer.open';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly scope: 'selected-chat';
  readonly snapshotRevision: number;
  readonly featureId: string;
}

export interface MissionPanelOpenMessage {
  readonly type: 'mission.panel.open';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly scope: 'selected-chat';
  readonly target?: 'catalog' | 'setup';
  readonly task?: string;
}

export type MissionWebviewMessage =
  | MissionStartMessage
  | MissionControlMessage
  | MissionDisclosureMessage
  | MissionViewerOpenMessage
  | MissionPanelOpenMessage;

export interface MissionFeatureSnapshot {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly description?: string;
  readonly milestone?: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  /** Host-derived capability, never a worker/session identifier. */
  readonly workerViewAvailable?: true;
}

export interface MissionSetupCatalogItem {
  readonly id: string;
  readonly displayName: string;
  readonly supportedReasoningEfforts: readonly MissionReasoningEffort[];
}

/**
 * Host-owned setup inputs. Preferences are advisory and may be stale; the
 * Webview and Host both revalidate every effective pair against `catalog`.
 */
export interface MissionSetupCapabilities {
  readonly currentChat: Omit<MissionProfile, 'mode'>;
  readonly catalogStatus: 'loading' | 'ready' | 'error' | 'unsupported';
  readonly catalog: readonly MissionSetupCatalogItem[];
  readonly preferences: {
    readonly worker: MissionProfile;
    readonly validator: MissionProfile;
    readonly scrutinyEnabled: boolean;
    readonly userTestingEnabled: boolean;
  };
}

export interface MissionSnapshotMessage {
  readonly type: 'mission.snapshot';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  /** Bridge ordering stamp, distinct from the Mission revision. */
  readonly sequence: number;
  readonly scope: 'selected-chat';
  readonly revision: number;
  readonly availability: 'attached' | 'detached';
  readonly lifecycle?: MissionLifecycle;
  readonly presentationPhase?: 'loading' | 'setup';
  readonly title?: string;
  readonly features: readonly MissionFeatureSnapshot[];
  readonly currentFeatureId?: string;
  readonly completedFeatureCount: number;
  readonly controls: {
    readonly canPause: boolean;
    readonly canResume: boolean;
    readonly canStopCurrentFeature: boolean;
    readonly busyAction?: 'pause' | 'resume' | 'stop';
  };
  readonly validator: {
    readonly scrutinyEnabled: boolean;
    readonly userTestingEnabled: boolean;
  };
  readonly setup?: MissionSetupCapabilities;
}

export const MISSION_CONTROL_ACTIONS = [
  'start',
  'dismiss-setup',
  'pause',
  'resume',
  'stop-current-feature',
  'refresh',
  'set-disclosure',
  'open-viewer',
] as const;
export type MissionControlAction = (typeof MISSION_CONTROL_ACTIONS)[number];

export interface MissionControlResultMessage {
  readonly type: 'mission.controlResult';
  readonly protocolVersion: typeof MISSION_BRIDGE_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly scope: 'selected-chat';
  readonly requestId: string;
  readonly action: MissionControlAction;
  readonly status: 'accepted' | 'rejected';
  readonly rejectionCode?: 'busy' | 'stale' | 'unavailable' | 'invalid';
}

export type MissionHostMessage = MissionSnapshotMessage | MissionControlResultMessage;

const REASONING_SET = new Set<string>(MISSION_REASONING_EFFORTS);
const LIFECYCLE_SET = new Set<string>(MISSION_LIFECYCLES);
const FEATURE_STATUS_SET = new Set<string>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

export function parseMissionWebviewMessage(
  value: unknown,
): MissionWebviewMessage | undefined {
  if (!isStrictRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  switch (value.type) {
    case 'mission.start':
      return parseMissionStart(value);
    case 'mission.dismissSetup':
    case 'mission.pause':
    case 'mission.resume':
    case 'mission.stopCurrentFeature':
    case 'mission.refresh':
      return parseMissionControl(value);
    case 'mission.disclosure.set':
      return parseMissionDisclosure(value);
    case 'mission.viewer.open':
      return parseMissionViewerOpen(value);
    case 'mission.panel.open':
      return parseMissionPanelOpen(value);
    default:
      return undefined;
  }
}

function parseMissionPanelOpen(
  value: UnknownRecord,
): MissionPanelOpenMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'protocolVersion', 'requestId', 'scope'],
      ['target', 'task'],
    ) ||
    !hasMissionEnvelope(value) ||
    (value.target !== undefined &&
      value.target !== 'catalog' &&
      value.target !== 'setup') ||
    (value.task !== undefined && !isMissionTaskText(value.task))
  ) {
    return undefined;
  }
  return {
    type: 'mission.panel.open',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    requestId: value.requestId,
    scope: 'selected-chat',
    ...(value.target === undefined ? {} : { target: value.target }),
    ...(value.task === undefined ? {} : { task: value.task }),
  };
}

export function parseMissionHostMessage(value: unknown): MissionHostMessage | undefined {
  if (!isStrictRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'mission.controlResult') {
    return parseMissionControlResult(value);
  }
  if (value.type !== 'mission.snapshot') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      [
        'type',
        'protocolVersion',
        'sequence',
        'scope',
        'revision',
        'availability',
        'features',
        'completedFeatureCount',
        'controls',
        'validator',
      ],
      ['lifecycle', 'presentationPhase', 'title', 'currentFeatureId', 'setup'],
    ) ||
    value.protocolVersion !== MISSION_BRIDGE_PROTOCOL_VERSION ||
    !isRevision(value.sequence) ||
    value.scope !== 'selected-chat' ||
    !isRevision(value.revision) ||
    (value.availability !== 'attached' && value.availability !== 'detached') ||
    (value.lifecycle !== undefined &&
      (typeof value.lifecycle !== 'string' || !LIFECYCLE_SET.has(value.lifecycle))) ||
    (value.presentationPhase !== undefined &&
      value.presentationPhase !== 'loading' &&
      value.presentationPhase !== 'setup') ||
    (value.lifecycle !== undefined && value.presentationPhase !== undefined) ||
    (value.title !== undefined &&
      !isPresentationText(value.title, MAX_MISSION_SNAPSHOT_TITLE_LENGTH)) ||
    !isExactArray(value.features, 0, MAX_MISSION_FEATURES) ||
    !isRevision(value.completedFeatureCount)
  ) {
    return undefined;
  }

  const features: MissionFeatureSnapshot[] = [];
  const featureIds = new Set<string>();
  for (let index = 0; index < value.features.length; index += 1) {
    const feature = parseFeature(value.features[index]);
    if (feature === undefined || feature.order !== index || featureIds.has(feature.id)) {
      return undefined;
    }
    featureIds.add(feature.id);
    features.push(feature);
  }
  if (
    value.completedFeatureCount > features.length ||
    value.completedFeatureCount !==
      features.filter(({ status }) => status === 'completed').length ||
    (value.currentFeatureId !== undefined &&
      (!isMissionId(value.currentFeatureId) || !featureIds.has(value.currentFeatureId)))
  ) {
    return undefined;
  }
  const controls = parseControls(value.controls);
  const validator = parseValidator(value.validator);
  const setup =
    value.setup === undefined ? undefined : parseMissionSetupCapabilities(value.setup);
  if (
    controls === undefined ||
    validator === undefined ||
    (value.setup !== undefined && setup === undefined)
  ) {
    return undefined;
  }
  if (
    value.availability === 'detached' &&
    (controls.canPause ||
      controls.canResume ||
      controls.canStopCurrentFeature ||
      controls.busyAction !== undefined)
  ) {
    return undefined;
  }

  return {
    type: 'mission.snapshot',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    sequence: value.sequence,
    scope: 'selected-chat',
    revision: value.revision,
    availability: value.availability,
    ...(value.lifecycle === undefined
      ? {}
      : { lifecycle: value.lifecycle as MissionLifecycle }),
    ...(value.presentationPhase === undefined
      ? {}
      : {
          presentationPhase: value.presentationPhase as 'loading' | 'setup',
        }),
    ...(value.title === undefined ? {} : { title: value.title }),
    features,
    ...(value.currentFeatureId === undefined
      ? {}
      : { currentFeatureId: value.currentFeatureId }),
    completedFeatureCount: value.completedFeatureCount,
    controls,
    validator,
    ...(setup === undefined ? {} : { setup }),
  };
}

function parseMissionControlResult(
  value: UnknownRecord,
): MissionControlResultMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'protocolVersion', 'sequence', 'scope', 'requestId', 'action', 'status'],
      ['rejectionCode'],
    ) ||
    value.protocolVersion !== MISSION_BRIDGE_PROTOCOL_VERSION ||
    !isRevision(value.sequence) ||
    value.scope !== 'selected-chat' ||
    !isMissionId(value.requestId) ||
    typeof value.action !== 'string' ||
    !(MISSION_CONTROL_ACTIONS as readonly string[]).includes(value.action) ||
    (value.status !== 'accepted' && value.status !== 'rejected') ||
    (value.status === 'accepted' && value.rejectionCode !== undefined) ||
    (value.status === 'rejected' &&
      !(
        value.rejectionCode === 'busy' ||
        value.rejectionCode === 'stale' ||
        value.rejectionCode === 'unavailable' ||
        value.rejectionCode === 'invalid'
      ))
  ) {
    return undefined;
  }
  return {
    type: 'mission.controlResult',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    sequence: value.sequence,
    scope: 'selected-chat',
    requestId: value.requestId,
    action: value.action as MissionControlAction,
    status: value.status,
    ...(value.rejectionCode === undefined
      ? {}
      : {
          rejectionCode: value.rejectionCode as Exclude<
            MissionControlResultMessage['rejectionCode'],
            undefined
          >,
        }),
  };
}

function parseMissionStart(value: UnknownRecord): MissionStartMessage | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'requestId',
      'scope',
      'task',
      'orchestrator',
      'worker',
      'validator',
      'scrutinyEnabled',
      'userTestingEnabled',
    ]) ||
    !hasMissionEnvelope(value) ||
    !isMissionTaskText(value.task) ||
    typeof value.scrutinyEnabled !== 'boolean' ||
    typeof value.userTestingEnabled !== 'boolean'
  ) {
    return undefined;
  }
  const orchestrator = parseOrchestratorProfile(value.orchestrator);
  const worker = parseMissionProfile(value.worker);
  const validator = parseMissionProfile(value.validator);
  if (
    orchestrator === undefined ||
    worker === undefined ||
    validator === undefined ||
    !matchesInheritedProfile(worker, orchestrator) ||
    !matchesInheritedProfile(validator, orchestrator)
  ) {
    return undefined;
  }
  return {
    type: 'mission.start',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    requestId: value.requestId,
    scope: 'selected-chat',
    task: value.task,
    orchestrator,
    worker,
    validator,
    scrutinyEnabled: value.scrutinyEnabled,
    userTestingEnabled: value.userTestingEnabled,
  };
}

function parseMissionControl(value: UnknownRecord): MissionControlMessage | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'requestId',
      'scope',
      'snapshotRevision',
    ]) ||
    !hasMissionEnvelope(value) ||
    !isRevision(value.snapshotRevision)
  ) {
    return undefined;
  }
  return {
    type: value.type as MissionControlMessage['type'],
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    requestId: value.requestId,
    scope: 'selected-chat',
    snapshotRevision: value.snapshotRevision,
  };
}

function parseMissionDisclosure(
  value: UnknownRecord,
): MissionDisclosureMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'protocolVersion', 'requestId', 'scope', 'expanded']) ||
    !hasMissionEnvelope(value) ||
    typeof value.expanded !== 'boolean'
  ) {
    return undefined;
  }
  return {
    type: 'mission.disclosure.set',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    requestId: value.requestId,
    scope: 'selected-chat',
    expanded: value.expanded,
  };
}

function parseMissionViewerOpen(
  value: UnknownRecord,
): MissionViewerOpenMessage | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'requestId',
      'scope',
      'snapshotRevision',
      'featureId',
    ]) ||
    !hasMissionEnvelope(value) ||
    !isRevision(value.snapshotRevision) ||
    !isMissionId(value.featureId)
  ) {
    return undefined;
  }
  return {
    type: 'mission.viewer.open',
    protocolVersion: MISSION_BRIDGE_PROTOCOL_VERSION,
    requestId: value.requestId,
    scope: 'selected-chat',
    snapshotRevision: value.snapshotRevision,
    featureId: value.featureId,
  };
}

function hasMissionEnvelope(value: UnknownRecord): value is UnknownRecord & {
  requestId: string;
  scope: 'selected-chat';
} {
  return (
    value.protocolVersion === MISSION_BRIDGE_PROTOCOL_VERSION &&
    isMissionId(value.requestId) &&
    value.scope === 'selected-chat'
  );
}

function parseOrchestratorProfile(
  value: unknown,
): Omit<MissionProfile, 'mode'> | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['modelId', 'reasoningEffort']) ||
    !isMissionModelId(value.modelId) ||
    !isReasoningEffort(value.reasoningEffort)
  ) {
    return undefined;
  }
  return { modelId: value.modelId, reasoningEffort: value.reasoningEffort };
}

function parseMissionProfile(value: unknown): MissionProfile | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['mode', 'modelId', 'reasoningEffort']) ||
    (value.mode !== 'same-as-orchestrator' && value.mode !== 'override') ||
    !isMissionModelId(value.modelId) ||
    !isReasoningEffort(value.reasoningEffort)
  ) {
    return undefined;
  }
  return {
    mode: value.mode,
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
  };
}

function matchesInheritedProfile(
  profile: MissionProfile,
  orchestrator: Omit<MissionProfile, 'mode'>,
): boolean {
  return (
    profile.mode !== 'same-as-orchestrator' ||
    (profile.modelId === orchestrator.modelId &&
      profile.reasoningEffort === orchestrator.reasoningEffort)
  );
}

function parseFeature(value: unknown): MissionFeatureSnapshot | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['id', 'order', 'title', 'status'],
      ['description', 'milestone', 'workerViewAvailable'],
    ) ||
    !isMissionId(value.id) ||
    !isRevision(value.order) ||
    !isPresentationText(value.title, MAX_MISSION_FEATURE_TEXT_LENGTH) ||
    (value.description !== undefined &&
      !isPresentationText(value.description, MAX_MISSION_FEATURE_TEXT_LENGTH)) ||
    (value.milestone !== undefined &&
      !isPresentationText(value.milestone, MAX_MISSION_FEATURE_TEXT_LENGTH)) ||
    typeof value.status !== 'string' ||
    !FEATURE_STATUS_SET.has(value.status) ||
    (value.workerViewAvailable !== undefined && value.workerViewAvailable !== true)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    order: value.order,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.milestone === undefined ? {} : { milestone: value.milestone }),
    status: value.status as MissionFeatureSnapshot['status'],
    ...(value.workerViewAvailable === true ? { workerViewAvailable: true } : {}),
  };
}

function parseControls(value: unknown): MissionSnapshotMessage['controls'] | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['canPause', 'canResume', 'canStopCurrentFeature'],
      ['busyAction'],
    ) ||
    typeof value.canPause !== 'boolean' ||
    typeof value.canResume !== 'boolean' ||
    typeof value.canStopCurrentFeature !== 'boolean' ||
    (value.busyAction !== undefined &&
      value.busyAction !== 'pause' &&
      value.busyAction !== 'resume' &&
      value.busyAction !== 'stop')
  ) {
    return undefined;
  }
  return {
    canPause: value.canPause,
    canResume: value.canResume,
    canStopCurrentFeature: value.canStopCurrentFeature,
    ...(value.busyAction === undefined ? {} : { busyAction: value.busyAction }),
  };
}

function parseValidator(value: unknown): MissionSnapshotMessage['validator'] | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['scrutinyEnabled', 'userTestingEnabled']) ||
    typeof value.scrutinyEnabled !== 'boolean' ||
    typeof value.userTestingEnabled !== 'boolean'
  ) {
    return undefined;
  }
  return {
    scrutinyEnabled: value.scrutinyEnabled,
    userTestingEnabled: value.userTestingEnabled,
  };
}

export function parseMissionSetupCapabilities(
  value: unknown,
): MissionSetupCapabilities | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['currentChat', 'catalogStatus', 'catalog', 'preferences']) ||
    (value.catalogStatus !== 'loading' &&
      value.catalogStatus !== 'ready' &&
      value.catalogStatus !== 'error' &&
      value.catalogStatus !== 'unsupported') ||
    !isExactArray(value.catalog, 0, 200) ||
    (value.catalogStatus !== 'ready' && value.catalog.length !== 0)
  ) {
    return undefined;
  }
  const currentChat = parseOrchestratorProfile(value.currentChat);
  const preferences = parseSetupPreferences(value.preferences, currentChat);
  if (currentChat === undefined || preferences === undefined) {
    return undefined;
  }
  const catalog: MissionSetupCatalogItem[] = [];
  const modelIds = new Set<string>();
  for (const candidate of value.catalog) {
    const model = parseSetupCatalogItem(candidate);
    if (model === undefined || modelIds.has(model.id)) {
      return undefined;
    }
    modelIds.add(model.id);
    catalog.push(model);
  }
  return {
    currentChat,
    catalogStatus: value.catalogStatus,
    catalog,
    preferences,
  };
}

function parseSetupPreferences(
  value: unknown,
  currentChat: Omit<MissionProfile, 'mode'> | undefined,
): MissionSetupCapabilities['preferences'] | undefined {
  if (
    currentChat === undefined ||
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'worker',
      'validator',
      'scrutinyEnabled',
      'userTestingEnabled',
    ]) ||
    typeof value.scrutinyEnabled !== 'boolean' ||
    typeof value.userTestingEnabled !== 'boolean'
  ) {
    return undefined;
  }
  const worker = parseMissionProfile(value.worker);
  const validator = parseMissionProfile(value.validator);
  if (
    worker === undefined ||
    validator === undefined ||
    !matchesInheritedProfile(worker, currentChat) ||
    !matchesInheritedProfile(validator, currentChat)
  ) {
    return undefined;
  }
  return {
    worker,
    validator,
    scrutinyEnabled: value.scrutinyEnabled,
    userTestingEnabled: value.userTestingEnabled,
  };
}

function parseSetupCatalogItem(value: unknown): MissionSetupCatalogItem | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'displayName', 'supportedReasoningEfforts']) ||
    !isMissionModelId(value.id) ||
    !isPresentationText(value.displayName, 256) ||
    !isExactArray(value.supportedReasoningEfforts, 0, MISSION_REASONING_EFFORTS.length)
  ) {
    return undefined;
  }
  const efforts: MissionReasoningEffort[] = [];
  for (const effort of value.supportedReasoningEfforts) {
    if (!isReasoningEffort(effort) || efforts.includes(effort)) {
      return undefined;
    }
    efforts.push(effort);
  }
  return {
    id: value.id,
    displayName: value.displayName,
    supportedReasoningEfforts: efforts,
  };
}

function isReasoningEffort(value: unknown): value is MissionReasoningEffort {
  return typeof value === 'string' && REASONING_SET.has(value);
}

function isMissionModelId(value: unknown): value is string {
  return (
    isBoundedText(value, 256) &&
    value.length > 0 &&
    value.trim() === value &&
    !/[\u0080-\u009f]/.test(value)
  );
}

function isMissionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MISSION_FEATURE_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isPresentationText(value: unknown, maximum: number): value is string {
  return (
    isBoundedText(value, maximum) &&
    !/(?:[A-Za-z]:[\\/]|\\\\|(?:^|\s)[~/][\w.-]+[\\/])/.test(value)
  );
}
