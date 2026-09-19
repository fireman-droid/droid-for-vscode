import { createContext, useEffect, useMemo, useRef, useState } from 'react';

import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import {
  subscribeHostMessages,
  type DecodedHostMessage,
} from '../shell/hostMessageSource';
import {
  CUSTOM_MODEL_PROVIDERS,
  IDLE_CUSTOM_MODEL_DISCOVERY_STATE,
  IDLE_CUSTOM_MODELS_STATE,
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  MAX_CUSTOM_MODEL_OUTPUT_TOKENS,
  isSafeText,
  mergeCustomModelsState,
  type CustomModelDiscoveryUiState,
  type CustomModelListItem,
  type CustomModelProvider,
  type CustomModelSaveMessage,
  type CustomModelsDiscoverMessage,
  type CustomModelsImportMessage,
  type CustomModelsUiState,
  type ProviderModelsState,
} from '../../../shared/protocol/customModelsProtocol';

/**
 * BYOK custom-models flow: context, App-level hook, and shared
 * grouping/validation helpers. The management UI
 * lives on full pages (ModelsPage.tsx / ModelProviderPage.tsx) that
 * replace the chat view; the model menu's "Add models" row opens them
 * through `onOpenManager`. All Bridge traffic flows through context
 * callbacks that App wires up — same pattern as GitCommitFlowContext.
 *
 * Credential red line: this flow carries daemon-masked key values
 * only, never plaintext. Form key fields are component-local state
 * that dies with the page; they are never persisted into drafts or
 * `vscode.setState`, and an untouched key field on edit means "keep
 * the stored key" (probed daemon semantics).
 */

/** Save payload; App stamps `type` and `sessionId`. */
export type CustomModelSaveParams = Omit<CustomModelSaveMessage, 'type' | 'sessionId'>;

export type CustomModelsDiscoverParams = Omit<
  CustomModelsDiscoverMessage,
  'type' | 'sessionId'
>;

export type CustomModelsImportParams = Omit<
  CustomModelsImportMessage,
  'type' | 'sessionId'
>;

export const CUSTOM_MODEL_PROVIDER_LABELS: Record<CustomModelProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'generic-chat-completion-api': 'OpenAI-compatible',
};

export const PROVIDER_DEFAULT_URLS: Record<CustomModelProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'generic-chat-completion-api': '',
};

/** Group identity prefilled into the provider page ("Add models"). */
export interface CustomModelProviderPreset {
  readonly provider: CustomModelProvider;
  readonly baseUrl: string;
  readonly keyHint?: string;
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
}

export interface CustomModelsFlowValue {
  readonly sessionId: string | null;
  readonly customModels: CustomModelsUiState;
  readonly discovery: CustomModelDiscoveryUiState;
  readonly providers: ProviderModelsState;
  /** Opens the independent Models editor without replacing the chat. */
  readonly onOpenManager: () => void;
  readonly onRefresh: () => void;
  readonly onSave: (params: CustomModelSaveParams) => void;
  readonly onDelete: (rawIndex: number, expectedModel: string) => void;
  readonly onDiscover: (params: CustomModelsDiscoverParams) => void;
  readonly onImport: (params: CustomModelsImportParams) => void;
  readonly onRefreshProviders: () => void;
  readonly onSaveProvider: (params: {
    readonly displayName: string;
    readonly protocol: CustomModelProvider;
    readonly rootUrl: string;
    readonly setApiKey?: boolean;
    readonly providerId?: string;
  }) => void;
  readonly onFetchProvider: (providerId: string) => void;
  readonly onImportProviderModels: (params: {
    readonly providerId: string;
    readonly models: readonly { readonly model: string; readonly displayName?: string }[];
    readonly maxOutputTokens: number | null;
    readonly noImageSupport: boolean;
  }) => void;
  readonly onSaveProviderModel: (params: {
    readonly providerId: string;
    readonly model: string;
    readonly displayName?: string;
    readonly maxOutputTokens: number | null;
    readonly noImageSupport: boolean;
    readonly rawIndex?: number;
    readonly expectedModel?: string;
  }) => void;
  readonly onTestProviderModel: (providerId: string, model: string) => void;
  readonly onTestAllProviderModels: (providerId: string) => void;
}

export const CustomModelsContext = createContext<CustomModelsFlowValue | null>(null);

interface CustomModelsPort {
  postMessage(message: WebviewToHostMessage): void;
}

/**
 * App-level flow state for the pages. `customModels.state` bypasses
 * the session store (like `ui.theme`): the state is pulled on demand
 * while a page is open and must not sit in long-lived snapshots, so
 * this hook keeps it locally and validates the host push with the
 * same shared parser the bridge validator delegates to. Messages are
 * dropped unless they target the current session, and a session
 * switch resets to idle (the page re-pulls on entry).
 */
export function useCustomModelsFlow(
  vscode: CustomModelsPort,
  sessionId: string | null,
  onOpenManager: () => void,
): CustomModelsFlowValue {
  const [customModels, setCustomModels] = useState<CustomModelsUiState>(
    IDLE_CUSTOM_MODELS_STATE,
  );
  const [discovery, setDiscovery] = useState<CustomModelDiscoveryUiState>(
    IDLE_CUSTOM_MODEL_DISCOVERY_STATE,
  );
  const [providers, setProviders] = useState<ProviderModelsState>({
    status: 'loading',
    providers: [],
  });
  const latestSequence = useRef(-1);
  useEffect(() => {
    setCustomModels(IDLE_CUSTOM_MODELS_STATE);
    setDiscovery(IDLE_CUSTOM_MODEL_DISCOVERY_STATE);
    setProviders({ status: 'loading', providers: [] });
    latestSequence.current = -1;
    if (sessionId === null) {
      return;
    }
    const handleMessage = (message: DecodedHostMessage): void => {
      const stateMessage = message.type === 'customModels.state' ? message : null;
      if (
        stateMessage !== null &&
        stateMessage.sessionId === sessionId &&
        stateMessage.sequence > latestSequence.current
      ) {
        latestSequence.current = stateMessage.sequence;
        setCustomModels((previous) =>
          mergeCustomModelsState(previous, stateMessage.customModels),
        );
        return;
      }
      const discoveryMessage = message.type === 'customModels.discovery' ? message : null;
      if (
        discoveryMessage !== null &&
        discoveryMessage.sessionId === sessionId &&
        discoveryMessage.sequence > latestSequence.current
      ) {
        latestSequence.current = discoveryMessage.sequence;
        setDiscovery(discoveryMessage.discovery);
        return;
      }
      const providerMessage = message.type === 'providerModels.state' ? message : null;
      if (
        providerMessage !== null &&
        providerMessage.sessionId === sessionId &&
        providerMessage.sequence > latestSequence.current
      ) {
        latestSequence.current = providerMessage.sequence;
        setProviders(providerMessage.providers);
      }
    };
    return subscribeHostMessages(handleMessage);
  }, [sessionId]);
  return useMemo(
    () => ({
      sessionId,
      customModels,
      discovery,
      providers,
      onOpenManager,
      onRefresh: () => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'customModels.refresh', sessionId });
        }
      },
      onSave: (params) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'customModels.save',
            sessionId,
            ...params,
          });
        }
      },
      onDelete: (rawIndex, expectedModel) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'customModels.delete',
            sessionId,
            rawIndex,
            expectedModel,
          });
        }
      },
      onDiscover: (params) => {
        if (sessionId !== null) {
          setDiscovery({ status: 'loading' });
          vscode.postMessage({
            type: 'customModels.discover',
            sessionId,
            ...params,
          });
        }
      },
      onImport: (params) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'customModels.import',
            sessionId,
            ...params,
          });
        }
      },
      onRefreshProviders: () => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'providerModels.refresh', sessionId });
        }
      },
      onSaveProvider: (params) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'providerModels.saveProvider',
            sessionId,
            ...params,
          });
        }
      },
      onFetchProvider: (providerId) => {
        if (sessionId !== null) {
          setDiscovery({ status: 'loading' });
          vscode.postMessage({ type: 'providerModels.fetch', sessionId, providerId });
        }
      },
      onImportProviderModels: (params) => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'providerModels.import', sessionId, ...params });
        }
      },
      onSaveProviderModel: (params) => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'providerModels.saveModel', sessionId, ...params });
        }
      },
      onTestProviderModel: (providerId, model) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'providerModels.test',
            sessionId,
            providerId,
            model,
          });
        }
      },
      onTestAllProviderModels: (providerId) => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'providerModels.testAll', sessionId, providerId });
        }
      },
    }),
    [customModels, discovery, providers, onOpenManager, sessionId, vscode],
  );
}

export function readCustomModelOptions(
  apiKey: string,
  maxTokens: string,
): {
  readonly trimmedKey: string;
  readonly keyValid: boolean;
  readonly tokenText: string;
  readonly tokenNumber: number;
  readonly tokensValid: boolean;
} {
  const trimmedKey = apiKey.trim();
  const tokenText = maxTokens.trim();
  const tokenNumber = Number(tokenText);
  return {
    trimmedKey,
    keyValid:
      trimmedKey.length === 0 || isSafeText(trimmedKey, MAX_CUSTOM_MODEL_KEY_LENGTH),
    tokenText,
    tokenNumber,
    tokensValid:
      tokenText.length === 0 ||
      (Number.isSafeInteger(tokenNumber) &&
        tokenNumber >= 1 &&
        tokenNumber <= MAX_CUSTOM_MODEL_OUTPUT_TOKENS),
  };
}

export function isFormProvider(value: string | undefined): value is CustomModelProvider {
  return (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(value ?? '');
}

export interface CustomModelGroup {
  readonly key: string;
  readonly providerLabel: string;
  readonly baseUrl: string;
  readonly keyLabel: string;
  readonly preset: CustomModelProviderPreset | null;
  readonly items: readonly CustomModelListItem[];
}

/** One card per (provider, baseUrl, credential, shared options). */
export function groupCustomModels(
  items: readonly CustomModelListItem[],
): CustomModelGroup[] {
  const grouped = new Map<string, CustomModelListItem[]>();
  for (const item of items) {
    const credentialKey =
      item.apiKeyMask ?? (item.hasApiKey ? `unknown:${item.rawIndex}` : 'no-key');
    const key = [
      item.provider,
      item.baseUrl ?? '',
      credentialKey,
      String(item.maxOutputTokens ?? ''),
      String(item.noImageSupport ?? ''),
    ].join('\u0000');
    const rows = grouped.get(key);
    if (rows === undefined) {
      grouped.set(key, [item]);
    } else {
      rows.push(item);
    }
  }
  return [...grouped].map(([key, rows]) => {
    const first = rows[0]!;
    const provider = isFormProvider(first.provider) ? first.provider : null;
    const baseUrl = first.baseUrl ?? 'No API base URL';
    const keyed = rows.find((item) => item.hasApiKey);
    return {
      key,
      providerLabel:
        provider === null ? first.provider : CUSTOM_MODEL_PROVIDER_LABELS[provider],
      baseUrl,
      keyLabel: keyed?.apiKeyMask ?? (keyed === undefined ? 'no key' : 'key set'),
      preset:
        provider === null ||
        first.baseUrl === undefined ||
        (keyed !== undefined && keyed.apiKeyMask === undefined)
          ? null
          : {
              provider,
              baseUrl: first.baseUrl,
              ...(keyed === undefined ? {} : { keyHint: keyed.apiKeyMask ?? 'key set' }),
              maxOutputTokens: first.maxOutputTokens ?? null,
              noImageSupport: first.noImageSupport === true,
            },
      items: rows,
    };
  });
}

/** Whether a configured item already belongs to the prefilled group. */
export function matchesProviderPreset(
  item: CustomModelListItem,
  preset: CustomModelProviderPreset,
): boolean {
  const keyMatches =
    preset.keyHint === undefined
      ? !item.hasApiKey
      : item.hasApiKey && (item.apiKeyMask ?? 'key set') === preset.keyHint;
  return (
    item.provider === preset.provider &&
    item.baseUrl === preset.baseUrl &&
    (item.maxOutputTokens ?? null) === preset.maxOutputTokens &&
    (item.noImageSupport === true) === preset.noImageSupport &&
    keyMatches
  );
}
