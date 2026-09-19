import {
  CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODEL_OUTPUT_TOKENS,
  isCustomModelBaseUrl,
  isSafeText,
  type CustomModelProvider,
  type DiscoveredCustomModel,
} from './customModelsProtocol';
import { MAX_MODEL_CATALOG_ITEMS, MAX_MODEL_ID_LENGTH } from './bounds';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const MODEL_MANAGER_VERSION = 2 as const;
export interface ModelsOpenMessage {
  readonly type: 'models.open';
}

export interface ModelConnection {
  readonly id: string;
  readonly name: string;
  readonly protocol: CustomModelProvider;
  readonly baseUrl: string;
  readonly hasKey: boolean;
  readonly imported: boolean;
  readonly providerName?: string;
}

export interface ModelVerification {
  readonly status: 'passed' | 'failed';
  readonly message: string;
  readonly latencyMs: number;
}

export interface ManagedModel {
  readonly rawIndex: number;
  readonly model: string;
  readonly displayName: string;
  readonly connectionId: string;
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
  readonly valid: boolean;
  readonly runtimeId: string | null;
  readonly loadMessage: string;
  readonly test: ModelVerification | null;
}

export interface ModelsSnapshot {
  readonly connections: readonly ModelConnection[];
  readonly models: readonly ManagedModel[];
  readonly activeModelId: string | null;
  readonly canApply: boolean;
  readonly applyMessage: string;
}

export interface ConnectionDraft {
  readonly id?: string;
  readonly name: string;
  readonly protocol: CustomModelProvider;
  readonly baseUrl: string;
  /** The Host asks for a password; plaintext never enters this protocol. */
  readonly setApiKey: boolean;
}

export interface ManagedModelDraft {
  readonly connectionId: string;
  readonly rawIndex?: number;
  readonly expectedModel?: string;
  readonly model: string;
  readonly displayName: string;
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
}

export type ModelsAction =
  | { readonly kind: 'refresh' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'saveConnection'; readonly draft: ConnectionDraft }
  | { readonly kind: 'discover'; readonly connectionId: string }
  | { readonly kind: 'deleteConnection'; readonly connectionId: string }
  | { readonly kind: 'renameProvider'; readonly providerHost: string; readonly name: string }
  | { readonly kind: 'renameModel'; readonly rawIndex: number; readonly expectedModel: string; readonly name: string }
  | { readonly kind: 'saveModel'; readonly draft: ManagedModelDraft }
  | {
      readonly kind: 'importModels';
      readonly connectionId: string;
      readonly models: readonly DiscoveredCustomModel[];
    }
  | {
      readonly kind: 'deleteModel' | 'verifyModel' | 'useModel';
      readonly rawIndex: number;
      readonly expectedModel: string;
    };

export interface ModelsRequest {
  readonly type: 'models.request';
  readonly version: typeof MODEL_MANAGER_VERSION;
  readonly requestId: string;
  readonly action: ModelsAction;
}

export type ModelsHostMessage =
  | {
      readonly type: 'models.theme';
      readonly version: typeof MODEL_MANAGER_VERSION;
      readonly resolved: 'light' | 'dark';
    }
  | {
      readonly type: 'models.snapshot';
      readonly version: typeof MODEL_MANAGER_VERSION;
      readonly snapshot: ModelsSnapshot;
    }
  | {
      readonly type: 'models.result';
      readonly version: typeof MODEL_MANAGER_VERSION;
      readonly requestId: string;
      readonly ok: boolean;
      readonly message: string;
      readonly connectionId?: string;
      readonly discovered?: readonly DiscoveredCustomModel[];
    };

function id(value: unknown): value is string {
  return isSafeText(value, 256);
}
function index(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < MAX_MODEL_CATALOG_ITEMS
  );
}
function protocol(value: unknown): value is CustomModelProvider {
  return (
    typeof value === 'string' &&
    (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(value)
  );
}
function tokens(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) &&
      (value as number) > 0 &&
      (value as number) <= MAX_CUSTOM_MODEL_OUTPUT_TOKENS)
  );
}
function parseConnectionDraft(value: unknown): ConnectionDraft | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['name', 'protocol', 'baseUrl', 'setApiKey'], ['id']) ||
    !isSafeText(value.name, 80) ||
    !protocol(value.protocol) ||
    !isCustomModelBaseUrl(value.baseUrl) ||
    typeof value.setApiKey !== 'boolean' ||
    (value.id !== undefined && !id(value.id))
  )
    return undefined;
  return {
    name: value.name,
    protocol: value.protocol,
    baseUrl: value.baseUrl as string,
    setApiKey: value.setApiKey,
    ...(value.id === undefined ? {} : { id: value.id as string }),
  };
}
function parseModelDraft(value: unknown): ManagedModelDraft | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['connectionId', 'model', 'displayName', 'maxOutputTokens', 'noImageSupport'],
      ['rawIndex', 'expectedModel'],
    ) ||
    !id(value.connectionId) ||
    !isSafeText(value.model, MAX_MODEL_ID_LENGTH) ||
    typeof value.displayName !== 'string' ||
    (value.displayName !== '' && !isSafeText(value.displayName, 160)) ||
    !tokens(value.maxOutputTokens) ||
    typeof value.noImageSupport !== 'boolean' ||
    ((value.rawIndex !== undefined || value.expectedModel !== undefined) &&
      (!index(value.rawIndex) || !isSafeText(value.expectedModel, MAX_MODEL_ID_LENGTH)))
  ) {
    return undefined;
  }
  return {
    connectionId: value.connectionId,
    model: value.model as string,
    displayName: value.displayName,
    maxOutputTokens: value.maxOutputTokens,
    noImageSupport: value.noImageSupport,
    ...(value.rawIndex === undefined
      ? {}
      : {
          rawIndex: value.rawIndex as number,
          expectedModel: value.expectedModel as string,
        }),
  };
}
function discovered(value: unknown): value is readonly DiscoveredCustomModel[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_MODEL_CATALOG_ITEMS &&
    value.every(
      (entry: unknown) =>
        isStrictRecord(entry) &&
        hasExactKeys(entry, ['model'], ['displayName']) &&
        isSafeText(entry.model, MAX_MODEL_ID_LENGTH) &&
        (entry.displayName === undefined || isSafeText(entry.displayName, 160)),
    )
  );
}
export function parseModelsRequest(value: unknown): ModelsRequest | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'version', 'requestId', 'action']) ||
    value.type !== 'models.request' ||
    value.version !== MODEL_MANAGER_VERSION ||
    !id(value.requestId) ||
    !isStrictRecord(value.action)
  )
    return undefined;
  const action = value.action;
  let parsed: ModelsAction | undefined;
  if (
    (action.kind === 'refresh' || action.kind === 'cancel') &&
    hasExactKeys(action, ['kind'])
  ) {
    parsed = { kind: action.kind };
  } else if (
    action.kind === 'renameProvider' &&
    hasExactKeys(action, ['kind', 'providerHost', 'name']) &&
    isSafeText(action.providerHost, 512) && isSafeText(action.name, 80)
  ) {
    parsed = { kind: action.kind, providerHost: action.providerHost, name: action.name };
  } else if (
    action.kind === 'renameModel' &&
    hasExactKeys(action, ['kind', 'rawIndex', 'expectedModel', 'name']) &&
    index(action.rawIndex) && isSafeText(action.expectedModel, MAX_MODEL_ID_LENGTH) &&
    isSafeText(action.name, 160)
  ) {
    parsed = { kind: action.kind, rawIndex: action.rawIndex, expectedModel: action.expectedModel, name: action.name };
  } else if (
    action.kind === 'saveConnection' &&
    hasExactKeys(action, ['kind', 'draft'])
  ) {
    const draft = parseConnectionDraft(action.draft);
    if (draft !== undefined) parsed = { kind: action.kind, draft };
  } else if (action.kind === 'saveModel' && hasExactKeys(action, ['kind', 'draft'])) {
    const draft = parseModelDraft(action.draft);
    if (draft !== undefined) parsed = { kind: action.kind, draft };
  } else if (
    (action.kind === 'discover' || action.kind === 'deleteConnection') &&
    hasExactKeys(action, ['kind', 'connectionId']) &&
    id(action.connectionId)
  ) {
    parsed = { kind: action.kind, connectionId: action.connectionId };
  } else if (
    action.kind === 'importModels' &&
    hasExactKeys(action, ['kind', 'connectionId', 'models']) &&
    id(action.connectionId) &&
    discovered(action.models) &&
    action.models.length > 0 &&
    action.models.length <= 100
  ) {
    parsed = {
      kind: action.kind,
      connectionId: action.connectionId,
      models: action.models,
    };
  } else if (
    ['deleteModel', 'verifyModel', 'useModel'].includes(String(action.kind)) &&
    hasExactKeys(action, ['kind', 'rawIndex', 'expectedModel']) &&
    index(action.rawIndex) &&
    isSafeText(action.expectedModel, MAX_MODEL_ID_LENGTH)
  ) {
    parsed = {
      kind: action.kind as 'deleteModel' | 'verifyModel' | 'useModel',
      rawIndex: action.rawIndex,
      expectedModel: action.expectedModel,
    };
  }
  return parsed === undefined
    ? undefined
    : {
        type: 'models.request',
        version: MODEL_MANAGER_VERSION,
        requestId: value.requestId,
        action: parsed,
      };
}
function verification(value: unknown): value is ModelVerification | null {
  return (
    value === null ||
    (isStrictRecord(value) &&
      hasExactKeys(value, ['status', 'message', 'latencyMs']) &&
      (value.status === 'passed' || value.status === 'failed') &&
      typeof value.message === 'string' &&
      value.message.length <= 2048 &&
      typeof value.latencyMs === 'number' &&
      Number.isFinite(value.latencyMs) &&
      value.latencyMs >= 0)
  );
}
function snapshot(value: unknown): value is ModelsSnapshot {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'connections',
      'models',
      'activeModelId',
      'canApply',
      'applyMessage',
    ]) ||
    !Array.isArray(value.connections) ||
    value.connections.length > MAX_MODEL_CATALOG_ITEMS ||
    !Array.isArray(value.models) ||
    value.models.length > MAX_MODEL_CATALOG_ITEMS ||
    (value.activeModelId !== null && !id(value.activeModelId)) ||
    typeof value.canApply !== 'boolean' ||
    typeof value.applyMessage !== 'string' ||
    value.applyMessage.length > 2048
  )
    return false;
  return (
    value.connections.every(
      (row: unknown) =>
        isStrictRecord(row) &&
        hasExactKeys(row, ['id', 'name', 'protocol', 'baseUrl', 'hasKey', 'imported'], ['providerName']) &&
        id(row.id) &&
        isSafeText(row.name, 160) &&
        protocol(row.protocol) &&
        isCustomModelBaseUrl(row.baseUrl) &&
        typeof row.hasKey === 'boolean' &&
        typeof row.imported === 'boolean' &&
        (row.providerName === undefined || isSafeText(row.providerName, 80)),
    ) &&
    value.models.every(
      (row: unknown) =>
        isStrictRecord(row) &&
        hasExactKeys(row, [
          'rawIndex',
          'model',
          'displayName',
          'connectionId',
          'maxOutputTokens',
          'noImageSupport',
          'valid',
          'runtimeId',
          'loadMessage',
          'test',
        ]) &&
        index(row.rawIndex) &&
        isSafeText(row.model, MAX_MODEL_ID_LENGTH) &&
        isSafeText(row.displayName, 160) &&
        id(row.connectionId) &&
        tokens(row.maxOutputTokens) &&
        typeof row.noImageSupport === 'boolean' &&
        typeof row.valid === 'boolean' &&
        (row.runtimeId === null || id(row.runtimeId)) &&
        typeof row.loadMessage === 'string' &&
        row.loadMessage.length <= 2048 &&
        verification(row.test),
    )
  );
}
export function parseModelsHostMessage(value: unknown): ModelsHostMessage | undefined {
  if (!isStrictRecord(value) || value.version !== MODEL_MANAGER_VERSION) return undefined;
  if (
    value.type === 'models.theme' &&
    hasExactKeys(value, ['type', 'version', 'resolved']) &&
    (value.resolved === 'light' || value.resolved === 'dark')
  ) {
    return { type: value.type, version: MODEL_MANAGER_VERSION, resolved: value.resolved };
  }
  if (
    value.type === 'models.snapshot' &&
    hasExactKeys(value, ['type', 'version', 'snapshot']) &&
    snapshot(value.snapshot)
  ) {
    return { type: value.type, version: MODEL_MANAGER_VERSION, snapshot: value.snapshot };
  }
  if (
    value.type === 'models.result' &&
    hasExactKeys(
      value,
      ['type', 'version', 'requestId', 'ok', 'message'],
      ['connectionId', 'discovered'],
    ) &&
    id(value.requestId) &&
    typeof value.ok === 'boolean' &&
    typeof value.message === 'string' &&
    value.message.length <= 2048 &&
    (value.connectionId === undefined || id(value.connectionId)) &&
    (value.discovered === undefined || discovered(value.discovered))
  ) {
    return {
      type: value.type,
      version: MODEL_MANAGER_VERSION,
      requestId: value.requestId,
      ok: value.ok,
      message: value.message,
      ...(value.connectionId === undefined
        ? {}
        : { connectionId: value.connectionId as string }),
      ...(value.discovered === undefined
        ? {}
        : {
            discovered: value.discovered as readonly DiscoveredCustomModel[],
          }),
    };
  }
  return undefined;
}
