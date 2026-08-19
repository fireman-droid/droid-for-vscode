import {
  MAX_MODEL_CATALOG_ITEMS,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
} from './bridgeMessages';
import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import {
  hasExactKeys,
  isStrictRecord as isRecord,
} from './strictValidation';
/**
 * BYOK custom-models bridge contract
 * (docs/product/byok-add-model-design.md §5.1).
 *
 * The management panel lists, discovers, imports, saves, and deletes `customModels`
 * entries of `~/.factory/settings.json` through the daemon RPCs
 * `daemon.list_custom_models` / `upsert_custom_model` /
 * `delete_custom_model` (probed 2026-08-13,
 * artifacts/probe-custom-models-daemon.mjs). Both directions are
 * strictly validated here so `validateMessage.ts` (host inbound) and
 * `validateHostMessage.ts` (webview inbound) can delegate without
 * duplicating shape rules. `bridgeMessages.ts` must only
 * `import type` from this module: the runtime dependency points the
 * other way (shared model bounds come from the main contract).
 *
 * Credential red line: `apiKey` plaintext travels only on request-scoped
 * webview→host save/discover/import messages and is handed to the provider
 * or daemon in one step. Host→webview state carries only projected catalog
 * names or `hasApiKey` and the
 * daemon-masked `apiKeyMask` (probe: `••••` + last 4 chars) — never
 * key material.
 */
export const MAX_CUSTOM_MODEL_URL_LENGTH = 2048;
export const MAX_CUSTOM_MODEL_KEY_LENGTH = 512;
export const MAX_CUSTOM_MODEL_MASK_LENGTH = 32;
export const MAX_CUSTOM_MODEL_PROVIDER_LENGTH = 64;
export const MAX_CUSTOM_MODEL_OUTPUT_TOKENS = 100_000_000;
export const MAX_CUSTOM_MODELS_MESSAGE_LENGTH = 512;
export const MAX_CUSTOM_MODEL_IMPORT_ITEMS = 32;
/**
 * Providers the save form offers. The upsert RPC accepts an open
 * string, but the GUI only writes the three documented BYOK values
 * (docs.factory.ai/cli/byok); Bedrock and other providers stay
 * settings.json-managed. List items keep provider as an open string
 * so existing entries with other providers still display.
 */
export const CUSTOM_MODEL_PROVIDERS = [
  'anthropic',
  'openai',
  'generic-chat-completion-api',
] as const;
export type CustomModelProvider =
  (typeof CUSTOM_MODEL_PROVIDERS)[number];
/**
 * One custom model as the daemon lists it — already key-scrubbed.
 * `rawIndex` is the live array position in settings.json (probed:
 * NOT the persisted `index` field, which drifts historically) and is
 * only valid against the list it arrived with.
 */
export interface CustomModelListItem {
  readonly rawIndex: number;
  readonly model: string;
  readonly displayName?: string;
  readonly provider: string;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
  readonly apiKeyMask?: string;
  readonly maxOutputTokens?: number;
  readonly noImageSupport?: boolean;
  readonly hasBedrockConfig: boolean;
  readonly isValid: boolean;
}
export type CustomModelsState =
  | {
      readonly status: 'loading';
      readonly items: readonly CustomModelListItem[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly CustomModelListItem[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly CustomModelListItem[];
      readonly message: string;
    }
  | {
      readonly status: 'unavailable';
      readonly items: readonly [];
      readonly message: string;
    };
/** Webview panel state: 'idle' means not requested yet. */
export type CustomModelsUiState =
  | CustomModelsState
  | { readonly status: 'idle'; readonly items: readonly [] };
export const IDLE_CUSTOM_MODELS_STATE: CustomModelsUiState = {
  status: 'idle',
  items: [],
};
/** Webview → Host: (re)load the custom model list from the daemon. */
export interface CustomModelsRefreshMessage {
  readonly type: 'customModels.refresh';
  readonly sessionId: string;
}
/** One provider-returned model projected without arbitrary metadata. */
export interface DiscoveredCustomModel {
  readonly model: string;
  readonly displayName?: string;
}
export type CustomModelDiscoveryState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly items: readonly DiscoveredCustomModel[];
    }
  | { readonly status: 'error'; readonly message: string };
export type CustomModelDiscoveryUiState =
  | CustomModelDiscoveryState
  | { readonly status: 'idle' };
export const IDLE_CUSTOM_MODEL_DISCOVERY_STATE: CustomModelDiscoveryUiState = {
  status: 'idle',
};
/**
 * Webview → Host: fetch a provider's model catalog. The Host performs
 * the bounded request; the Webview remains network-free. Plaintext key
 * is request-scoped and never returns across the Bridge.
 */
export interface CustomModelsDiscoverMessage {
  readonly type: 'customModels.discover';
  readonly sessionId: string;
  readonly provider: CustomModelProvider;
  readonly baseUrl: string;
  readonly apiKey?: string;
}
/** Webview → Host: import selected discovery rows with shared settings. */
export interface CustomModelsImportMessage {
  readonly type: 'customModels.import';
  readonly sessionId: string;
  readonly provider: CustomModelProvider;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly models: readonly DiscoveredCustomModel[];
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
}
/**
 * Webview → Host: create or edit one custom model. `rawIndex` +
 * `expectedModel` together mark an edit (daemon optimistic-concurrency
 * pair); both absent means create. `apiKey` carries plaintext exactly
 * once; omitted on edit it keeps the stored key (probed: an omitted or
 * empty key leaves settings.json untouched). `maxOutputTokens: null`
 * clears the stored limit.
 */
export interface CustomModelSaveMessage {
  readonly type: 'customModels.save';
  readonly sessionId: string;
  readonly rawIndex?: number;
  readonly expectedModel?: string;
  readonly model: string;
  readonly displayName?: string;
  readonly provider: CustomModelProvider;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
}
/** Webview → Host: delete one custom model (concurrency-guarded). */
export interface CustomModelDeleteMessage {
  readonly type: 'customModels.delete';
  readonly sessionId: string;
  readonly rawIndex: number;
  readonly expectedModel: string;
}
/**
 * Host → Webview: masked custom-model list state. Not part of
 * `host.snapshot`: the panel pulls on demand so masks never sit in
 * long-lived snapshots.
 */
export interface CustomModelsStateMessage {
  readonly type: 'customModels.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly customModels: CustomModelsState;
}
/** Host → Webview: bounded provider discovery progress/results. */
export interface CustomModelsDiscoveryStateMessage {
  readonly type: 'customModels.discovery';
  readonly sequence: number;
  readonly sessionId: string;
  readonly discovery: CustomModelDiscoveryState;
}
/**
 * Provider-owned management state. API keys never occur here: the Host
 * projects presence only and reads the SecretStorage value just-in-time.
 */
import type { ProviderConnectionSummary, ProviderModelTestResult, ProviderModelsState, ProviderModelsStateMessage, ProviderModelsRefreshMessage, ProviderSaveMessage, ProviderModelsFetchMessage, ProviderModelSaveMessage, ProviderModelImportMessage, ProviderModelTestMessage, ProviderModelsTestAllMessage, ProviderModelsWebviewMessage } from "./providerModelsProtocol";
export type { ProviderConnectionSummary, ProviderModelTestResult, ProviderModelsState, ProviderModelsStateMessage, ProviderModelsRefreshMessage, ProviderSaveMessage, ProviderModelsFetchMessage, ProviderModelSaveMessage, ProviderModelImportMessage, ProviderModelTestMessage, ProviderModelsTestAllMessage, ProviderModelsWebviewMessage } from "./providerModelsProtocol";
import {
  parseProviderModelsStateMessage,
  parseProviderModelsWebviewMessage,
} from "./providerModelsProtocol";
export {
  parseProviderModelsStateMessage,
  parseProviderModelsWebviewMessage,
} from "./providerModelsProtocol";
export type CustomModelsWebviewMessage =
  | CustomModelsRefreshMessage
  | CustomModelSaveMessage
  | CustomModelDeleteMessage
  | CustomModelsDiscoverMessage
  | CustomModelsImportMessage
  | ProviderModelsWebviewMessage;
export type CustomModelsHostMessage =
  | CustomModelsStateMessage
  | CustomModelsDiscoveryStateMessage
  | ProviderModelsStateMessage;
function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}
/** Non-empty, trimmed, bounded, control-character-free text. */
export function isSafeText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}
function isRawIndex(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < MAX_MODEL_CATALOG_ITEMS
  );
}
export function isCustomModelBaseUrl(value: unknown): boolean {
  if (
    !isSafeText(value, MAX_CUSTOM_MODEL_URL_LENGTH) ||
    /\s/u.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}
export function parseCustomModelsRefreshMessage(
  value: unknown,
): CustomModelsRefreshMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.refresh' ||
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  return { type: 'customModels.refresh', sessionId: value.sessionId };
}
export function parseCustomModelSaveMessage(
  value: unknown,
): CustomModelSaveMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.save' ||
    !hasExactKeys(
      value,
      [
        'type',
        'sessionId',
        'model',
        'provider',
        'baseUrl',
        'maxOutputTokens',
        'noImageSupport',
      ],
      ['rawIndex', 'expectedModel', 'displayName', 'apiKey'],
    ) ||
    !isId(value.sessionId) ||
    !isSafeText(value.model, MAX_MODEL_ID_LENGTH) ||
    !(CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(
      value.provider as string,
    ) ||
    !isCustomModelBaseUrl(value.baseUrl) ||
    (value.rawIndex === undefined) !==
      (value.expectedModel === undefined) ||
    (value.rawIndex !== undefined && !isRawIndex(value.rawIndex)) ||
    (value.expectedModel !== undefined &&
      !isSafeText(value.expectedModel, MAX_MODEL_ID_LENGTH)) ||
    (value.displayName !== undefined &&
      !isSafeText(value.displayName, MAX_MODEL_DISPLAY_NAME_LENGTH)) ||
    (value.apiKey !== undefined &&
      !isSafeText(value.apiKey, MAX_CUSTOM_MODEL_KEY_LENGTH)) ||
    (value.maxOutputTokens !== null &&
      !(
        Number.isSafeInteger(value.maxOutputTokens) &&
        (value.maxOutputTokens as number) >= 1 &&
        (value.maxOutputTokens as number) <=
          MAX_CUSTOM_MODEL_OUTPUT_TOKENS
      )) ||
    typeof value.noImageSupport !== 'boolean'
  ) {
    return null;
  }
  return {
    type: 'customModels.save',
    sessionId: value.sessionId,
    ...(value.rawIndex === undefined
      ? {}
      : {
          rawIndex: value.rawIndex as number,
          expectedModel: value.expectedModel as string,
        }),
    model: value.model,
    ...(value.displayName === undefined
      ? {}
      : { displayName: value.displayName as string }),
    provider: value.provider as CustomModelProvider,
    baseUrl: value.baseUrl as string,
    ...(value.apiKey === undefined
      ? {}
      : { apiKey: value.apiKey as string }),
    maxOutputTokens: value.maxOutputTokens as number | null,
    noImageSupport: value.noImageSupport,
  };
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
export function parseCustomModelsDiscoverMessage(
  value: unknown,
): CustomModelsDiscoverMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.discover' ||
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'provider', 'baseUrl'],
      ['apiKey'],
    ) ||
    !isId(value.sessionId) ||
    !isProvider(value.provider) ||
    !isCustomModelBaseUrl(value.baseUrl) ||
    (value.apiKey !== undefined &&
      !isSafeText(value.apiKey, MAX_CUSTOM_MODEL_KEY_LENGTH))
  ) {
    return null;
  }
  return {
    type: 'customModels.discover',
    sessionId: value.sessionId,
    provider: value.provider,
    baseUrl: value.baseUrl as string,
    ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
  };
}
export function parseCustomModelsImportMessage(
  value: unknown,
): CustomModelsImportMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.import' ||
    !hasExactKeys(
      value,
      [
        'type',
        'sessionId',
        'provider',
        'baseUrl',
        'models',
        'maxOutputTokens',
        'noImageSupport',
      ],
      ['apiKey'],
    ) ||
    !isId(value.sessionId) ||
    !isProvider(value.provider) ||
    !isCustomModelBaseUrl(value.baseUrl) ||
    (value.apiKey !== undefined &&
      !isSafeText(value.apiKey, MAX_CUSTOM_MODEL_KEY_LENGTH)) ||
    !Array.isArray(value.models) ||
    value.models.length === 0 ||
    value.models.length > MAX_CUSTOM_MODEL_IMPORT_ITEMS ||
    (value.maxOutputTokens !== null &&
      !(
        Number.isSafeInteger(value.maxOutputTokens) &&
        (value.maxOutputTokens as number) >= 1 &&
        (value.maxOutputTokens as number) <=
          MAX_CUSTOM_MODEL_OUTPUT_TOKENS
      )) ||
    typeof value.noImageSupport !== 'boolean'
  ) {
    return null;
  }
  const models: DiscoveredCustomModel[] = [];
  const ids = new Set<string>();
  for (const raw of value.models) {
    const model = parseDiscoveredModel(raw);
    if (model === null || ids.has(model.model)) {
      return null;
    }
    ids.add(model.model);
    models.push(model);
  }
  return {
    type: 'customModels.import',
    sessionId: value.sessionId,
    provider: value.provider,
    baseUrl: value.baseUrl as string,
    ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
    models,
    maxOutputTokens: value.maxOutputTokens as number | null,
    noImageSupport: value.noImageSupport,
  };
}
export function parseCustomModelDeleteMessage(
  value: unknown,
): CustomModelDeleteMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.delete' ||
    !hasExactKeys(value, [
      'type',
      'sessionId',
      'rawIndex',
      'expectedModel',
    ]) ||
    !isId(value.sessionId) ||
    !isRawIndex(value.rawIndex) ||
    !isSafeText(value.expectedModel, MAX_MODEL_ID_LENGTH)
  ) {
    return null;
  }
  return {
    type: 'customModels.delete',
    sessionId: value.sessionId,
    rawIndex: value.rawIndex,
    expectedModel: value.expectedModel,
  };
}
function parseCustomModelListItem(
  value: unknown,
): CustomModelListItem | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        'rawIndex',
        'model',
        'provider',
        'hasApiKey',
        'hasBedrockConfig',
        'isValid',
      ],
      [
        'displayName',
        'baseUrl',
        'apiKeyMask',
        'maxOutputTokens',
        'noImageSupport',
      ],
    ) ||
    !isRawIndex(value.rawIndex) ||
    !isSafeText(value.model, MAX_MODEL_ID_LENGTH) ||
    !isSafeText(value.provider, MAX_CUSTOM_MODEL_PROVIDER_LENGTH) ||
    typeof value.hasApiKey !== 'boolean' ||
    typeof value.hasBedrockConfig !== 'boolean' ||
    typeof value.isValid !== 'boolean' ||
    (value.displayName !== undefined &&
      !isSafeText(value.displayName, MAX_MODEL_DISPLAY_NAME_LENGTH)) ||
    (value.baseUrl !== undefined &&
      !isSafeText(value.baseUrl, MAX_CUSTOM_MODEL_URL_LENGTH)) ||
    (value.apiKeyMask !== undefined &&
      !isSafeText(value.apiKeyMask, MAX_CUSTOM_MODEL_MASK_LENGTH)) ||
    (value.maxOutputTokens !== undefined &&
      !(
        Number.isSafeInteger(value.maxOutputTokens) &&
        (value.maxOutputTokens as number) >= 0
      )) ||
    (value.noImageSupport !== undefined &&
      typeof value.noImageSupport !== 'boolean')
  ) {
    return null;
  }
  return {
    rawIndex: value.rawIndex,
    model: value.model,
    ...(value.displayName === undefined
      ? {}
      : { displayName: value.displayName as string }),
    provider: value.provider,
    ...(value.baseUrl === undefined
      ? {}
      : { baseUrl: value.baseUrl as string }),
    hasApiKey: value.hasApiKey,
    ...(value.apiKeyMask === undefined
      ? {}
      : { apiKeyMask: value.apiKeyMask as string }),
    ...(value.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: value.maxOutputTokens as number }),
    ...(value.noImageSupport === undefined
      ? {}
      : { noImageSupport: value.noImageSupport as boolean }),
    hasBedrockConfig: value.hasBedrockConfig,
    isValid: value.isValid,
  };
}
function isStateMessageText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CUSTOM_MODELS_MESSAGE_LENGTH
  );
}
export function parseCustomModelsState(
  value: unknown,
): CustomModelsState | null {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return null;
  }
  const status = value.status;
  const hasMessage = status === 'error' || status === 'unavailable';
  if (
    (status !== 'loading' &&
      status !== 'ready' &&
      status !== 'error' &&
      status !== 'unavailable') ||
    !hasExactKeys(
      value,
      hasMessage ? ['status', 'items', 'message'] : ['status', 'items'],
    ) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_MODEL_CATALOG_ITEMS ||
    (status === 'unavailable' && value.items.length !== 0) ||
    (hasMessage && !isStateMessageText(value.message))
  ) {
    return null;
  }
  const items: CustomModelListItem[] = [];
  const rawIndices = new Set<number>();
  for (const raw of value.items) {
    const item = parseCustomModelListItem(raw);
    if (item === null || rawIndices.has(item.rawIndex)) {
      return null;
    }
    rawIndices.add(item.rawIndex);
    items.push(item);
  }
  if (status === 'unavailable') {
    return {
      status: 'unavailable',
      items: [],
      message: value.message as string,
    };
  }
  return hasMessage
    ? { status: 'error', items, message: value.message as string }
    : { status, items };
}
export function parseCustomModelsStateMessage(
  value: unknown,
): CustomModelsStateMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.state' ||
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'customModels',
    ]) ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  const customModels = parseCustomModelsState(value.customModels);
  if (customModels === null) {
    return null;
  }
  return {
    type: 'customModels.state',
    sequence: value.sequence,
    sessionId: value.sessionId,
    customModels,
  };
}
export function parseCustomModelDiscoveryState(
  value: unknown,
): CustomModelDiscoveryState | null {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return null;
  }
  if (value.status === 'loading') {
    return hasExactKeys(value, ['status']) ? { status: 'loading' } : null;
  }
  if (value.status === 'error') {
    return hasExactKeys(value, ['status', 'message']) &&
      isStateMessageText(value.message)
      ? { status: 'error', message: value.message }
      : null;
  }
  if (
    value.status !== 'ready' ||
    !hasExactKeys(value, ['status', 'items']) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_MODEL_CATALOG_ITEMS
  ) {
    return null;
  }
  const items: DiscoveredCustomModel[] = [];
  const ids = new Set<string>();
  for (const raw of value.items) {
    const item = parseDiscoveredModel(raw);
    if (item === null || ids.has(item.model)) {
      return null;
    }
    ids.add(item.model);
    items.push(item);
  }
  return { status: 'ready', items };
}
export function parseCustomModelsDiscoveryStateMessage(
  value: unknown,
): CustomModelsDiscoveryStateMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'customModels.discovery' ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'discovery']) ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  const discovery = parseCustomModelDiscoveryState(value.discovery);
  return discovery === null
    ? null
    : {
        type: 'customModels.discovery',
        sequence: value.sequence,
        sessionId: value.sessionId,
        discovery,
      };
}
export function parseCustomModelsWebviewMessage(
  value: unknown,
): CustomModelsWebviewMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.type) {
    case 'customModels.refresh':
      return parseCustomModelsRefreshMessage(value);
    case 'customModels.save':
      return parseCustomModelSaveMessage(value);
    case 'customModels.delete':
      return parseCustomModelDeleteMessage(value);
    case 'customModels.discover':
      return parseCustomModelsDiscoverMessage(value);
    case 'customModels.import':
      return parseCustomModelsImportMessage(value);
    case 'providerModels.refresh':
    case 'providerModels.saveProvider':
    case 'providerModels.fetch':
    case 'providerModels.saveModel':
    case 'providerModels.import':
    case 'providerModels.test':
    case 'providerModels.testAll':
      return parseProviderModelsWebviewMessage(value);
    default:
      return null;
  }
}
export function parseCustomModelsHostMessage(
  value: unknown,
): CustomModelsHostMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  return value.type === 'customModels.state'
    ? parseCustomModelsStateMessage(value)
    : value.type === 'customModels.discovery'
      ? parseCustomModelsDiscoveryStateMessage(value)
      : value.type === 'providerModels.state'
        ? parseProviderModelsStateMessage(value)
      : null;
}
export function mergeCustomModelsState(
  previous: CustomModelsUiState,
  next: CustomModelsState,
): CustomModelsState {
  if (
    next.status === 'loading' &&
    next.items.length === 0 &&
    previous.items.length > 0
  ) {
    return { status: 'loading', items: previous.items };
  }
  if (
    next.status === 'error' &&
    next.items.length === 0 &&
    previous.items.length > 0
  ) {
    return {
      status: 'error',
      items: previous.items,
      message: next.message,
    };
  }
  return next;
}
