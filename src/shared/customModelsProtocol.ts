import {
  MAX_MODEL_CATALOG_ITEMS,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
} from './bridgeMessages';
import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from './strictValidation';

/**
 * BYOK custom-models bridge contract
 * (docs/product/byok-add-model-design.md §5.1).
 *
 * The management panel lists, saves, and deletes `customModels`
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
 * Credential red line: `apiKey` plaintext exists exactly once, on the
 * webview→host save message, and is handed to the daemon RPC in one
 * step. Host→webview state carries only `hasApiKey` and the
 * daemon-masked `apiKeyMask` (probe: `••••` + last 4 chars) — never
 * key material.
 */

export const MAX_CUSTOM_MODEL_URL_LENGTH = 2048;
export const MAX_CUSTOM_MODEL_KEY_LENGTH = 512;
export const MAX_CUSTOM_MODEL_MASK_LENGTH = 32;
export const MAX_CUSTOM_MODEL_PROVIDER_LENGTH = 64;
export const MAX_CUSTOM_MODEL_OUTPUT_TOKENS = 100_000_000;
export const MAX_CUSTOM_MODELS_MESSAGE_LENGTH = 512;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

/** Non-empty, trimmed, bounded, control-character-free text. */
function isSafeText(value: unknown, maximumLength: number): value is string {
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

function isSaveBaseUrl(value: unknown): value is string {
  return (
    isSafeText(value, MAX_CUSTOM_MODEL_URL_LENGTH) &&
    !/\s/.test(value) &&
    /^https?:\/\/./.test(value)
  );
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
    !isSaveBaseUrl(value.baseUrl) ||
    // Edit marker fields travel as a pair or not at all.
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
    baseUrl: value.baseUrl,
    ...(value.apiKey === undefined
      ? {}
      : { apiKey: value.apiKey as string }),
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

/**
 * Store-side merge mirroring the skills/MCP panels: a loading or
 * error event with no items keeps showing the previous list instead
 * of blanking it. 'unavailable' replaces outright.
 */
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
