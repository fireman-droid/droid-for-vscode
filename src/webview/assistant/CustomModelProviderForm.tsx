import { useMemo, useState } from 'react';

import {
  CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODEL_IMPORT_ITEMS,
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  MAX_CUSTOM_MODEL_OUTPUT_TOKENS,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  isCustomModelBaseUrl,
  type CustomModelDiscoveryUiState,
  type CustomModelListItem,
  type CustomModelProvider,
  type CustomModelsDiscoverMessage,
  type CustomModelsImportMessage,
} from '../../shared/customModelsProtocol';

export const CUSTOM_MODEL_PROVIDER_LABELS: Record<
  CustomModelProvider,
  string
> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'generic-chat-completion-api': 'OpenAI-compatible',
};

const PROVIDER_DEFAULT_URLS: Record<CustomModelProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  'generic-chat-completion-api': '',
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export type CustomModelsDiscoverParams = Omit<
  CustomModelsDiscoverMessage,
  'type' | 'sessionId'
>;

export type CustomModelsImportParams = Omit<
  CustomModelsImportMessage,
  'type' | 'sessionId'
>;

export interface CustomModelProviderPreset {
  readonly provider: CustomModelProvider;
  readonly baseUrl: string;
  readonly keyHint?: string;
  readonly maxOutputTokens: number | null;
  readonly noImageSupport: boolean;
}

interface CustomModelProviderFormProps {
  readonly initial?: CustomModelProviderPreset;
  readonly configuredItems: readonly CustomModelListItem[];
  readonly discovery: CustomModelDiscoveryUiState;
  readonly busy: boolean;
  readonly onDiscover: (params: CustomModelsDiscoverParams) => void;
  readonly onImport: (params: CustomModelsImportParams) => void;
  readonly onManual: () => void;
  readonly onCancel: () => void;
}

/**
 * One request-scoped provider group. The key never leaves component
 * state except in the exact discover/import command sent to the Host;
 * discovered Host state contains projected model names only.
 */
export function CustomModelProviderForm({
  initial,
  configuredItems,
  discovery,
  busy,
  onDiscover,
  onImport,
  onManual,
  onCancel,
}: CustomModelProviderFormProps): React.JSX.Element {
  const [provider, setProvider] = useState<CustomModelProvider>(
    initial?.provider ?? 'openai',
  );
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? PROVIDER_DEFAULT_URLS.openai,
  );
  const [apiKey, setApiKey] = useState('');
  const [maxTokens, setMaxTokens] = useState(
    initial?.maxOutputTokens == null
      ? ''
      : String(initial.maxOutputTokens),
  );
  const [noImageSupport, setNoImageSupport] = useState(
    initial?.noImageSupport ?? false,
  );
  const [requested, setRequested] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const configuredIds = useMemo(
    () =>
      new Set(
        initial === undefined
          ? []
          : configuredItems
              .filter((item) => matchesProviderPreset(item, initial))
              .map((item) => item.model),
      ),
    [configuredItems, initial],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems =
    discovery.status === 'ready'
      ? discovery.items.filter(
          (item) =>
            normalizedQuery.length === 0 ||
            item.model.toLocaleLowerCase().includes(normalizedQuery) ||
            item.displayName
              ?.toLocaleLowerCase()
              .includes(normalizedQuery) === true,
        )
      : [];
  const selectedItems =
    discovery.status === 'ready'
      ? discovery.items.filter((item) => selected.has(item.model))
      : [];

  const trimmedUrl = baseUrl.trim();
  const trimmedKey = apiKey.trim();
  const urlValid = isCustomModelBaseUrl(trimmedUrl);
  const keyValid =
    trimmedKey.length <= MAX_CUSTOM_MODEL_KEY_LENGTH &&
    !CONTROL_CHARS.test(trimmedKey);
  const tokenText = maxTokens.trim();
  const tokenNumber = Number(tokenText);
  const tokensValid =
    tokenText.length === 0 ||
    (Number.isSafeInteger(tokenNumber) &&
      tokenNumber >= 1 &&
      tokenNumber <= MAX_CUSTOM_MODEL_OUTPUT_TOKENS);
  const valid = urlValid && keyValid && tokensValid;
  const working =
    busy || (requested && discovery.status === 'loading');
  const hint =
    !urlValid && trimmedUrl.length > 0
      ? 'Enter an API base URL starting with http:// or https://.'
      : !tokensValid
        ? 'Max output tokens must be a positive whole number.'
        : null;

  const sharedParams = {
    provider,
    baseUrl: trimmedUrl,
    ...(trimmedKey.length === 0 ? {} : { apiKey: trimmedKey }),
    maxOutputTokens: tokenText.length === 0 ? null : tokenNumber,
    noImageSupport,
  } as const;

  const fetchModels = (): void => {
    if (!valid || working) {
      return;
    }
    setRequested(true);
    setQuery('');
    setSelected(new Set());
    const { maxOutputTokens: _tokens, noImageSupport: _images, ...request } =
      sharedParams;
    onDiscover(request);
  };

  const importSelected = (): void => {
    if (!valid || working || selectedItems.length === 0) {
      return;
    }
    onImport({ ...sharedParams, models: selectedItems });
  };

  const selectProvider = (next: CustomModelProvider): void => {
    if (next === provider) {
      return;
    }
    setProvider(next);
    setBaseUrl(PROVIDER_DEFAULT_URLS[next]);
    setRequested(false);
    setSelected(new Set());
  };

  const toggle = (model: string): void => {
    setSelected((previous) => {
      const selectedNow = previous.has(model);
      if (!selectedNow && previous.size >= MAX_CUSTOM_MODEL_IMPORT_ITEMS) {
        return previous;
      }
      const next = new Set(previous);
      if (selectedNow) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  };

  return (
    <div className="dvx-cm-form" role="form" aria-label="Provider model group">
      <div className="dvx-cm-field" role="radiogroup" aria-label="Provider">
        <span className="dvx-cm-field-label">Provider *</span>
        <div className="dvx-mcp-add-types">
          {CUSTOM_MODEL_PROVIDERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="dvx-mcp-add-type"
              aria-checked={provider === value}
              onClick={() => selectProvider(value)}
            >
              {CUSTOM_MODEL_PROVIDER_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      <label className="dvx-cm-field">
        <span className="dvx-cm-field-label">API base URL *</span>
        <input
          className="dvx-mcp-add-input"
          type="text"
          value={baseUrl}
          maxLength={MAX_CUSTOM_MODEL_URL_LENGTH}
          placeholder="e.g. http://localhost:11434/v1"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setBaseUrl(event.currentTarget.value);
            setRequested(false);
            setSelected(new Set());
          }}
        />
      </label>
      <label className="dvx-cm-field">
        <span className="dvx-cm-field-label">API key</span>
        <input
          className="dvx-mcp-add-input"
          type="password"
          value={apiKey}
          maxLength={MAX_CUSTOM_MODEL_KEY_LENGTH}
          placeholder={
            initial?.keyHint === undefined
              ? 'Required by most hosted providers'
              : `${initial.keyHint} — enter again to fetch`
          }
          autoComplete="off"
          onChange={(event) => {
            setApiKey(event.currentTarget.value);
            setRequested(false);
            setSelected(new Set());
          }}
        />
      </label>
      <div className="dvx-cm-field-row">
        <label className="dvx-cm-field">
          <span className="dvx-cm-field-label">Max output tokens</span>
          <input
            className="dvx-mcp-add-input"
            type="text"
            inputMode="numeric"
            value={maxTokens}
            maxLength={12}
            placeholder="Model default"
            autoComplete="off"
            onChange={(event) => setMaxTokens(event.currentTarget.value)}
          />
        </label>
        <label className="dvx-cm-check">
          <input
            type="checkbox"
            checked={noImageSupport}
            onChange={(event) =>
              setNoImageSupport(event.currentTarget.checked)
            }
          />
          <span>No image input</span>
        </label>
      </div>
      {hint !== null ? (
        <p className="dvx-popover-message dvx-error-text" role="alert">
          {hint}
        </p>
      ) : null}
      <div className="dvx-cm-provider-actions">
        <button
          type="button"
          className="dvx-mcp-add-submit"
          disabled={!valid || working}
          onClick={fetchModels}
        >
          {working ? 'Fetching…' : 'Fetch models'}
        </button>
        <button type="button" className="dvx-cm-action" onClick={onManual}>
          Add one manually
        </button>
      </div>
      {requested ? (
        <DiscoveryPicker
          discovery={discovery}
          visibleItems={visibleItems}
          configuredIds={configuredIds}
          selected={selected}
          query={query}
          working={working}
          onQueryChange={setQuery}
          onToggle={toggle}
          onSelectVisible={() =>
            setSelected(
              new Set(
                visibleItems
                  .filter((item) => !configuredIds.has(item.model))
                  .slice(0, MAX_CUSTOM_MODEL_IMPORT_ITEMS)
                  .map((item) => item.model),
              ),
            )
          }
        />
      ) : null}
      <div className="dvx-cm-form-actions">
        {requested && discovery.status === 'ready' ? (
          <button
            type="button"
            className="dvx-mcp-add-submit"
            disabled={selectedItems.length === 0 || working}
            onClick={importSelected}
          >
            {selectedItems.length === 0
              ? 'Add selected'
              : `Add ${selectedItems.length} selected`}
          </button>
        ) : null}
        <button type="button" className="dvx-cm-action" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function matchesProviderPreset(
  item: CustomModelListItem,
  preset: CustomModelProviderPreset,
): boolean {
  const keyMatches =
    preset.keyHint === undefined
      ? !item.hasApiKey
      : item.hasApiKey &&
        (item.apiKeyMask ?? 'key set') === preset.keyHint;
  return (
    item.provider === preset.provider &&
    item.baseUrl === preset.baseUrl &&
    (item.maxOutputTokens ?? null) === preset.maxOutputTokens &&
    (item.noImageSupport === true) === preset.noImageSupport &&
    keyMatches
  );
}

function DiscoveryPicker({
  discovery,
  visibleItems,
  configuredIds,
  selected,
  query,
  working,
  onQueryChange,
  onToggle,
  onSelectVisible,
}: {
  readonly discovery: CustomModelDiscoveryUiState;
  readonly visibleItems: readonly { model: string; displayName?: string }[];
  readonly configuredIds: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  readonly query: string;
  readonly working: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onToggle: (model: string) => void;
  readonly onSelectVisible: () => void;
}): React.JSX.Element {
  if (discovery.status === 'loading') {
    return (
      <p className="dvx-popover-message" role="status">
        Reading provider catalog…
      </p>
    );
  }
  if (discovery.status === 'error') {
    return (
      <p className="dvx-popover-message dvx-error-text" role="alert">
        {discovery.message}
      </p>
    );
  }
  if (discovery.status !== 'ready') {
    return <></>;
  }
  return (
    <div className="dvx-cm-discovery">
      <div className="dvx-cm-discovery-tools">
        <input
          className="dvx-mcp-add-input"
          type="search"
          aria-label="Search provider models"
          placeholder="Search models"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
        <button
          type="button"
          className="dvx-cm-action"
          disabled={working || visibleItems.length === 0}
          onClick={onSelectVisible}
        >
          Select visible
        </button>
      </div>
      {visibleItems.length === 0 ? (
        <p className="dvx-popover-message" role="status">
          {discovery.items.length === 0
            ? 'This provider returned no models.'
            : 'No models match this search.'}
        </p>
      ) : (
        <ul className="dvx-cm-discovery-list" aria-label="Provider models">
          {visibleItems.map((item) => {
            const configured = configuredIds.has(item.model);
            return (
              <li key={item.model}>
                <label className="dvx-cm-discovery-row">
                  <input
                    type="checkbox"
                    checked={selected.has(item.model)}
                    disabled={configured || working}
                    onChange={() => onToggle(item.model)}
                  />
                  <span className="dvx-cm-copy">
                    <span className="dvx-cm-name">
                      {item.displayName ?? item.model}
                    </span>
                    {item.displayName !== undefined ? (
                      <span className="dvx-cm-meta">{item.model}</span>
                    ) : null}
                  </span>
                  {configured ? (
                    <span className="dvx-cm-key">Added</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
