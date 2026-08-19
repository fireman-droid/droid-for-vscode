import { MAX_MODEL_CATALOG_ITEMS, MAX_MODEL_DISPLAY_NAME_LENGTH, MAX_MODEL_ID_LENGTH } from "./bridgeMessages";
import { MAX_BRIDGE_ID_LENGTH } from "./interactionProtocol";
import { hasExactKeys, isStrictRecord as isRecord } from "./strictValidation";
import { CUSTOM_MODEL_PROVIDERS, MAX_CUSTOM_MODEL_IMPORT_ITEMS, MAX_CUSTOM_MODEL_OUTPUT_TOKENS, MAX_CUSTOM_MODELS_MESSAGE_LENGTH, isCustomModelBaseUrl, isSafeText, type CustomModelProvider, type DiscoveredCustomModel } from "./customModelsProtocol";

export interface ProviderModelTestResult {
  readonly model: string;
  readonly status: 'passed' | 'failed';
  readonly summary: string;
  readonly latencyMs: number;
}
export interface ProviderConnectionSummary {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: CustomModelProvider;
  readonly rootUrl: string;
  readonly apiBaseUrl: string;
  readonly hasApiKey: boolean;
  readonly imported: boolean;
  readonly modelCount: number;
  readonly latestTest?: {
    readonly status: 'passed' | 'failed';
    readonly summary: string;
    readonly latencyMs: number;
  };
  readonly modelTests?: readonly ProviderModelTestResult[];
}
export type ProviderModelsState =
  | { readonly status: 'loading'; readonly providers: readonly ProviderConnectionSummary[] }
  | { readonly status: 'ready'; readonly providers: readonly ProviderConnectionSummary[] }
  | {
      readonly status: 'error';
      readonly providers: readonly ProviderConnectionSummary[];
      readonly message: string;
    };
export interface ProviderModelsStateMessage {
  readonly type: 'providerModels.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly providers: ProviderModelsState;
}
export interface ProviderModelsRefreshMessage {
  readonly type: 'providerModels.refresh';
  readonly sessionId: string;
}
export interface ProviderSaveMessage {
  readonly type: 'providerModels.saveProvider';
  readonly sessionId: string;
  readonly displayName: string;
  readonly protocol: CustomModelProvider;
  readonly rootUrl: string;
  /** Host opens VS Code's password input; no secret crosses the Bridge. */
  readonly setApiKey?: boolean;
  readonly providerId?: string;
}
export interface ProviderModelsFetchMessage {
  readonly type: 'providerModels.fetch';
  readonly sessionId: string;
  readonly providerId: string;
}
export interface ProviderModelSaveMessage {
  readonly type: 'providerModels.saveModel';
  readonly sessionId: string;
  readonly providerId: string;
  readonly model: string;
  readonly displayName?: string;
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
  readonly rawIndex?: number;
  readonly expectedModel?: string;
}
export interface ProviderModelImportMessage {
  readonly type: 'providerModels.import';
  readonly sessionId: string;
  readonly providerId: string;
  readonly models: readonly DiscoveredCustomModel[];
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
}
export interface ProviderModelTestMessage {
  readonly type: 'providerModels.test';
  readonly sessionId: string;
  readonly providerId: string;
  readonly model: string;
}
export interface ProviderModelsTestAllMessage {
  readonly type: 'providerModels.testAll';
  readonly sessionId: string;
  readonly providerId: string;
}
export type ProviderModelsWebviewMessage =
  | ProviderModelsRefreshMessage
  | ProviderSaveMessage
  | ProviderModelsFetchMessage
  | ProviderModelSaveMessage
  | ProviderModelImportMessage
  | ProviderModelTestMessage
  | ProviderModelsTestAllMessage;
function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}
function isProvider(value: unknown): value is CustomModelProvider {
  return (
    typeof value === 'string' &&
    (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(value)
  );
}
function parseDiscoveredModel(value: unknown): DiscoveredCustomModel | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['model'], ['displayName']) ||
    !isSafeText(value.model, MAX_MODEL_ID_LENGTH) ||
    (value.displayName !== undefined &&
      !isSafeText(value.displayName, MAX_MODEL_DISPLAY_NAME_LENGTH))
  ) {
    return null;
  }
  return {
    model: value.model,
    ...(value.displayName === undefined
      ? {}
      : { displayName: value.displayName as string }),
  };
}
function isRawIndex(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < MAX_MODEL_CATALOG_ITEMS
  );
}
function isStateMessageText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CUSTOM_MODELS_MESSAGE_LENGTH
  );
}
function parseProviderId(value: unknown): value is string {
  return isSafeText(value, 64);
}
export function parseProviderModelsWebviewMessage(
  value: unknown,
): ProviderModelsWebviewMessage | null {
  if (!isRecord(value) || !isId(value.sessionId)) {
    return null;
  }
  if (
    value.type === 'providerModels.refresh' &&
    hasExactKeys(value, ['type', 'sessionId'])
  ) {
    return { type: value.type, sessionId: value.sessionId };
  }
  if (
    value.type === 'providerModels.saveProvider' &&
    hasExactKeys(
      value,
      ['type', 'sessionId', 'displayName', 'protocol', 'rootUrl'],
      ['setApiKey', 'providerId'],
    ) &&
    isSafeText(value.displayName, 80) &&
    isProvider(value.protocol) &&
    isCustomModelBaseUrl(value.rootUrl) &&
    (value.providerId === undefined || parseProviderId(value.providerId)) &&
    (value.setApiKey === undefined || typeof value.setApiKey === 'boolean')
  ) {
    return {
      type: 'providerModels.saveProvider', sessionId: value.sessionId, displayName: value.displayName,
      protocol: value.protocol as CustomModelProvider, rootUrl: value.rootUrl as string,
      ...(value.setApiKey === undefined ? {} : { setApiKey: value.setApiKey }),
      ...(value.providerId === undefined ? {} : { providerId: value.providerId }),
    };
  }
  if (
    value.type === 'providerModels.fetch' &&
    hasExactKeys(value, ['type', 'sessionId', 'providerId']) &&
    parseProviderId(value.providerId)
  ) {
    return { type: 'providerModels.fetch', sessionId: value.sessionId, providerId: value.providerId };
  }
  if (
    value.type === 'providerModels.test' &&
    hasExactKeys(value, ['type', 'sessionId', 'providerId', 'model']) &&
    parseProviderId(value.providerId) &&
    isSafeText(value.model, MAX_MODEL_ID_LENGTH)
  ) {
    return { type: 'providerModels.test', sessionId: value.sessionId, providerId: value.providerId, model: value.model };
  }
  if (
    value.type === 'providerModels.testAll' &&
    hasExactKeys(value, ['type', 'sessionId', 'providerId']) &&
    parseProviderId(value.providerId)
  ) {
    return { type: 'providerModels.testAll', sessionId: value.sessionId, providerId: value.providerId };
  }
  const importMode = value.type === 'providerModels.import';
  const saveMode = value.type === 'providerModels.saveModel';
  if (
    (!importMode && !saveMode) ||
    !hasExactKeys(
      value,
      importMode
        ? ['type', 'sessionId', 'providerId', 'models', 'maxOutputTokens', 'noImageSupport']
        : ['type', 'sessionId', 'providerId', 'model', 'maxOutputTokens', 'noImageSupport'],
      importMode ? [] : ['displayName', 'rawIndex', 'expectedModel'],
    ) ||
    !parseProviderId(value.providerId) ||
    typeof value.noImageSupport !== 'boolean' ||
    (value.maxOutputTokens !== null &&
      (!Number.isSafeInteger(value.maxOutputTokens) ||
        (value.maxOutputTokens as number) < 1 ||
        (value.maxOutputTokens as number) > MAX_CUSTOM_MODEL_OUTPUT_TOKENS))
  ) {
    return null;
  }
  if (importMode) {
    if (!Array.isArray(value.models) || value.models.length === 0 ||
      value.models.length > MAX_CUSTOM_MODEL_IMPORT_ITEMS) return null;
    const models = value.models.map(parseDiscoveredModel);
    if (
      models.some((model) => model === null) ||
      new Set(models.map((model) => model?.model)).size !== models.length
    ) return null;
    return { type: 'providerModels.import', sessionId: value.sessionId, providerId: value.providerId,
      models: models as DiscoveredCustomModel[], maxOutputTokens: value.maxOutputTokens as number | null,
      noImageSupport: value.noImageSupport };
  }
  if (
    !isSafeText(value.model, MAX_MODEL_ID_LENGTH) ||
    (value.displayName !== undefined && !isSafeText(value.displayName, MAX_MODEL_DISPLAY_NAME_LENGTH)) ||
    (value.rawIndex === undefined) !== (value.expectedModel === undefined) ||
    (value.rawIndex !== undefined && !isRawIndex(value.rawIndex)) ||
    (value.expectedModel !== undefined && !isSafeText(value.expectedModel, MAX_MODEL_ID_LENGTH))
  ) return null;
  return {
    type: 'providerModels.saveModel', sessionId: value.sessionId, providerId: value.providerId,
    model: value.model, ...(value.displayName === undefined ? {} : { displayName: value.displayName }),
    maxOutputTokens: value.maxOutputTokens as number | null, noImageSupport: value.noImageSupport,
    ...(value.rawIndex === undefined ? {} : { rawIndex: value.rawIndex, expectedModel: value.expectedModel }),
  };
}
function parseTestResult(value: unknown): ProviderModelTestResult | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['status', 'summary', 'latencyMs'], ['model']) ||
    (value.status !== 'passed' && value.status !== 'failed') ||
    !isStateMessageText(value.summary) ||
    !Number.isSafeInteger(value.latencyMs) ||
    (value.latencyMs as number) < 0 ||
    (value.latencyMs as number) > 120_000
  ) {
    return null;
  }
  if (value.model !== undefined && !isSafeText(value.model, MAX_MODEL_ID_LENGTH)) {
    return null;
  }
  return value as unknown as ProviderModelTestResult;
}
function parseProviderSummary(value: unknown): ProviderConnectionSummary | null {
  if (!isRecord(value) || !hasExactKeys(value,
    ['id', 'displayName', 'protocol', 'rootUrl', 'apiBaseUrl', 'hasApiKey', 'imported', 'modelCount'],
    ['latestTest', 'modelTests']) ||
    !parseProviderId(value.id) || !isSafeText(value.displayName, 80) ||
    !isProvider(value.protocol) || !isCustomModelBaseUrl(value.rootUrl) ||
    !isCustomModelBaseUrl(value.apiBaseUrl) || typeof value.hasApiKey !== 'boolean' ||
    typeof value.imported !== 'boolean' ||
    !Number.isSafeInteger(value.modelCount) || (value.modelCount as number) < 0 ||
    (value.modelCount as number) > MAX_MODEL_CATALOG_ITEMS) return null;
  if (value.latestTest !== undefined && parseTestResult(value.latestTest) === null) {
    return null;
  }
  if (value.modelTests !== undefined) {
    if (
      !Array.isArray(value.modelTests) ||
      value.modelTests.length === 0 ||
      value.modelTests.length > MAX_MODEL_CATALOG_ITEMS
    ) {
      return null;
    }
    const modelTests = value.modelTests.map((row) => {
      if (!isRecord(row) || !isSafeText(row.model, MAX_MODEL_ID_LENGTH)) {
        return null;
      }
      const parsed = parseTestResult(row);
      return parsed === null ? null : { ...parsed, model: row.model };
    });
    if (modelTests.some((row) => row === null)) {
      return null;
    }
  }
  return value as unknown as ProviderConnectionSummary;
}
export function parseProviderModelsStateMessage(value: unknown): ProviderModelsStateMessage | null {
  if (!isRecord(value) || value.type !== 'providerModels.state' ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'providers']) ||
    !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 || !isId(value.sessionId) ||
    !isRecord(value.providers) || !Array.isArray(value.providers.providers) ||
    value.providers.providers.length > MAX_MODEL_CATALOG_ITEMS) return null;
  const status = value.providers.status;
  if ((status !== 'loading' && status !== 'ready' && status !== 'error') ||
    !hasExactKeys(value.providers, status === 'error' ? ['status', 'providers', 'message'] : ['status', 'providers']) ||
    (status === 'error' && !isStateMessageText(value.providers.message))) return null;
  const providers = value.providers.providers.map(parseProviderSummary);
  if (providers.some((provider) => provider === null)) return null;
  return { type: 'providerModels.state', sequence: value.sequence as number, sessionId: value.sessionId,
    providers: status === 'error'
      ? { status: 'error', providers: providers as ProviderConnectionSummary[], message: value.providers.message as string }
      : { status: status as 'loading' | 'ready', providers: providers as ProviderConnectionSummary[] } };
}
