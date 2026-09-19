import { useId, useMemo, useState } from 'react';

import {
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODEL_IMPORT_ITEMS,
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  isCustomModelBaseUrl,
  type CustomModelDiscoveryUiState,
  type CustomModelListItem,
  type CustomModelProvider,
} from '../../../shared/protocol/customModelsProtocol';
import { isSafeDisplayName, isSafeModelId } from '../../../shared/validation/guards';
import {
  CUSTOM_MODEL_PROVIDER_LABELS,
  PROVIDER_DEFAULT_URLS,
  isFormProvider,
  matchesProviderPreset,
  readCustomModelOptions,
  type CustomModelProviderPreset,
  type CustomModelSaveParams,
  type CustomModelsDiscoverParams,
  type CustomModelsImportParams,
} from './customModelsFlow';

/**
 * Stand-alone provider configuration page (spec §6 拍板: "+ Add
 * provider" opens its own page, never an in-place wizard). The three
 * steps — endpoint + key, fetch + multi-select, shared parameters —
 * stack vertically as hairline-separated sections; Cancel/​primary
 * live on a pinned footer. `ModelEditorPage` reuses the same page
 * chrome for creating or editing one model with current values.
 *
 * Neither page is a real `<form>`: submission is a disabled-gated
 * click (Enter on inputs submits via keydown), matching the MCP
 * add-form precedent.
 */

export function ModelProviderPage({
  initial,
  configuredItems,
  discovery,
  busy,
  onBack,
  onManual,
  onDiscover,
  onImport,
}: {
  readonly initial?: CustomModelProviderPreset;
  readonly configuredItems: readonly CustomModelListItem[];
  readonly discovery: CustomModelDiscoveryUiState;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onManual: () => void;
  readonly onDiscover: (params: CustomModelsDiscoverParams) => void;
  readonly onImport: (params: CustomModelsImportParams) => void;
}): React.JSX.Element {
  const [provider, setProvider] = useState<CustomModelProvider>(
    initial?.provider ?? 'openai',
  );
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? PROVIDER_DEFAULT_URLS.openai,
  );
  const [apiKey, setApiKey] = useState('');
  const [maxTokens, setMaxTokens] = useState(
    initial?.maxOutputTokens == null ? '' : String(initial.maxOutputTokens),
  );
  const [noImageSupport, setNoImageSupport] = useState(initial?.noImageSupport ?? false);
  const [requested, setRequested] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
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
  const visibleItems = useMemo(
    () =>
      requested && discovery.status === 'ready'
        ? discovery.items.filter(
            (item) =>
              normalizedQuery.length === 0 ||
              item.model.toLocaleLowerCase().includes(normalizedQuery) ||
              item.displayName?.toLocaleLowerCase().includes(normalizedQuery) === true,
          )
        : [],
    [discovery, normalizedQuery, requested],
  );
  const selectedItems = useMemo(
    () =>
      discovery.status === 'ready'
        ? discovery.items.filter((item) => selected.has(item.model))
        : [],
    [discovery, selected],
  );

  const trimmedUrl = baseUrl.trim();
  const { trimmedKey, keyValid, tokenText, tokenNumber, tokensValid } =
    readCustomModelOptions(apiKey, maxTokens);
  const urlValid = isCustomModelBaseUrl(trimmedUrl);
  const valid = urlValid && keyValid && tokensValid;
  const working = busy || (requested && discovery.status === 'loading');
  const picking = requested && discovery.status === 'ready';
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
    const {
      maxOutputTokens: _tokens,
      noImageSupport: _images,
      ...request
    } = sharedParams;
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
    setApiKey('');
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
  const fetchOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      fetchModels();
    }
  };

  return (
    <div className="dvx-models-page" role="form" aria-label="Provider model group">
      <PageHead
        backLabel="Models"
        backAriaLabel="Back to models"
        title={initial === undefined ? 'Add provider' : 'Add models'}
        onBack={onBack}
      />
      <div className="dvx-models-body">
        <section className="dvx-page-section">
          <h3 className="dvx-page-section-title">Provider</h3>
          <CustomModelProviderSelector value={provider} onChange={selectProvider} />
          <label className="dvx-cm-field">
            <span className="dvx-cm-field-label">API base URL *</span>
            <input
              className="dvx-cm-input"
              type="text"
              value={baseUrl}
              maxLength={MAX_CUSTOM_MODEL_URL_LENGTH}
              placeholder="e.g. http://localhost:11434"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={fetchOnEnter}
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
              className="dvx-cm-input"
              type="password"
              value={apiKey}
              maxLength={MAX_CUSTOM_MODEL_KEY_LENGTH}
              placeholder={
                initial?.keyHint === undefined
                  ? 'Required by most hosted providers'
                  : `${initial.keyHint} — enter again to fetch`
              }
              autoComplete="off"
              onKeyDown={fetchOnEnter}
              onChange={(event) => {
                setApiKey(event.currentTarget.value);
                setRequested(false);
                setSelected(new Set());
              }}
            />
          </label>
          {hint !== null ? (
            <p className="dvx-page-note dvx-error-text" role="alert">
              {hint}
            </p>
          ) : null}
        </section>
        {requested ? (
          <section className="dvx-page-section">
            <div className="dvx-page-section-head">
              <h3 className="dvx-page-section-title">Models</h3>
              {discovery.status === 'ready' ? (
                <button
                  type="button"
                  className="dvx-page-action"
                  disabled={!valid || working}
                  onClick={fetchModels}
                >
                  Fetch again
                </button>
              ) : null}
            </div>
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
          </section>
        ) : null}
        {picking ? (
          <section className="dvx-page-section">
            <h3 className="dvx-page-section-title">Parameters</h3>
            <div className="dvx-cm-field-row">
              <label className="dvx-cm-field">
                <span className="dvx-cm-field-label">Max output tokens</span>
                <input
                  className="dvx-cm-input"
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
                  onChange={(event) => setNoImageSupport(event.currentTarget.checked)}
                />
                <span>No image input</span>
              </label>
            </div>
          </section>
        ) : null}
      </div>
      <footer className="dvx-page-footer">
        <div className="dvx-page-footer-secondary">
          <button type="button" className="dvx-page-quiet-action" onClick={onManual}>
            Add one manually
          </button>
          <button type="button" className="dvx-page-quiet-action" onClick={onBack}>
            Cancel
          </button>
        </div>
        {picking ? (
          <button
            type="button"
            className="dvx-page-primary"
            disabled={selectedItems.length === 0 || working}
            onClick={importSelected}
          >
            {selectedItems.length === 0
              ? 'Add models'
              : `Add ${selectedItems.length} ${
                  selectedItems.length === 1 ? 'model' : 'models'
                }`}
          </button>
        ) : (
          <button
            type="button"
            className="dvx-page-primary"
            disabled={!valid || working}
            onClick={fetchModels}
          >
            {working ? 'Fetching…' : 'Fetch models'}
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * Full-page single-model create/edit (spec 段 D item 4: editing an
 * existing model reuses the stand-alone page with current values).
 */
export function ModelEditorPage({
  item,
  providerConnection,
  busy,
  onBack,
  onSave,
}: {
  /** Null = create; an item = edit with its concurrency guard. */
  readonly item: CustomModelListItem | null;
  /** A managed connection owns protocol, endpoint, and credentials. */
  readonly providerConnection?: {
    readonly protocol: CustomModelProvider;
    readonly apiBaseUrl: string;
  };
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onSave: (params: CustomModelSaveParams) => void;
}): React.JSX.Element {
  const [model, setModel] = useState(item?.model ?? '');
  const [displayName, setDisplayName] = useState(item?.displayName ?? '');
  const [baseUrl, setBaseUrl] = useState(item?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const initialProvider = item?.provider;
  const [provider, setProvider] = useState<CustomModelProvider>(
    providerConnection?.protocol ??
      (isFormProvider(initialProvider) ? initialProvider : 'openai'),
  );
  const [maxTokens, setMaxTokens] = useState(
    item?.maxOutputTokens === undefined ? '' : String(item.maxOutputTokens),
  );
  const [noImageSupport, setNoImageSupport] = useState(item?.noImageSupport === true);

  const trimmedModel = model.trim();
  const trimmedName = displayName.trim();
  const trimmedUrl = baseUrl.trim();
  const {
    trimmedKey,
    keyValid,
    tokenText: tokens,
    tokenNumber: tokensNumber,
    tokensValid,
  } = readCustomModelOptions(apiKey, maxTokens);
  const modelValid = isSafeModelId(trimmedModel);
  const urlValid = providerConnection !== undefined || isCustomModelBaseUrl(trimmedUrl);
  const nameValid = trimmedName.length === 0 || isSafeDisplayName(trimmedName);
  const canSave = !busy && modelValid && urlValid && nameValid && keyValid && tokensValid;
  // Quiet gate: empty required fields just keep Save disabled; a
  // filled but malformed value earns the one hint explaining it.
  const hint =
    !urlValid && trimmedUrl.length > 0
      ? 'Enter a base URL starting with http:// or https://.'
      : !tokensValid
        ? 'Max output tokens must be a positive whole number.'
        : null;

  const submit = (): void => {
    if (!canSave) {
      return;
    }
    onSave({
      ...(item === null ? {} : { rawIndex: item.rawIndex, expectedModel: item.model }),
      model: trimmedModel,
      ...(trimmedName.length > 0 ? { displayName: trimmedName } : {}),
      provider,
      baseUrl: providerConnection?.apiBaseUrl ?? trimmedUrl,
      // Blank on edit = keep the stored key (probed); blank on create
      // = keyless endpoint. Either way the field never echoes back.
      ...(providerConnection === undefined && trimmedKey.length > 0
        ? { apiKey: trimmedKey }
        : {}),
      maxOutputTokens: tokens.length === 0 ? null : tokensNumber,
      noImageSupport,
    });
  };
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="dvx-models-page" role="form" aria-label="Custom model">
      <PageHead
        backLabel="Models"
        backAriaLabel="Back to models"
        title={item === null ? 'Add one model' : 'Edit model'}
        onBack={onBack}
      />
      <div className="dvx-models-body">
        <section className="dvx-page-section">
          <label className="dvx-cm-field">
            <span className="dvx-cm-field-label">Model ID *</span>
            <input
              className="dvx-cm-input"
              type="text"
              placeholder="e.g. qwen3:4b or claude-sonnet-4-5"
              value={model}
              maxLength={MAX_MODEL_ID_LENGTH}
              autoComplete="off"
              onChange={(event) => setModel(event.currentTarget.value)}
              onKeyDown={submitOnEnter}
            />
          </label>
          <label className="dvx-cm-field">
            <span className="dvx-cm-field-label">Display name</span>
            <input
              className="dvx-cm-input"
              type="text"
              placeholder="Shown in the model picker"
              value={displayName}
              maxLength={MAX_MODEL_DISPLAY_NAME_LENGTH}
              autoComplete="off"
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              onKeyDown={submitOnEnter}
            />
          </label>
          {providerConnection === undefined ? (
            <>
              <CustomModelProviderSelector value={provider} onChange={setProvider} />
              <label className="dvx-cm-field">
                <span className="dvx-cm-field-label">Base URL *</span>
                <input
                  className="dvx-cm-input"
                  type="text"
                  placeholder="e.g. http://localhost:11434"
                  value={baseUrl}
                  maxLength={MAX_CUSTOM_MODEL_URL_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setBaseUrl(event.currentTarget.value)}
                  onKeyDown={submitOnEnter}
                />
              </label>
              <label className="dvx-cm-field">
                <span className="dvx-cm-field-label">API key</span>
                <input
                  className="dvx-cm-input"
                  type="password"
                  placeholder={
                    item !== null && item.hasApiKey
                      ? `${item.apiKeyMask ?? 'key set'} — leave blank to keep`
                      : 'sk-… or ${VAR_NAME}; blank for keyless'
                  }
                  value={apiKey}
                  maxLength={MAX_CUSTOM_MODEL_KEY_LENGTH}
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                  onKeyDown={submitOnEnter}
                />
              </label>
            </>
          ) : (
            <p className="dvx-page-note">
              This model uses the saved connection endpoint and key.
            </p>
          )}
          <div className="dvx-cm-field-row">
            <label className="dvx-cm-field">
              <span className="dvx-cm-field-label">Max output tokens</span>
              <input
                className="dvx-cm-input"
                type="text"
                inputMode="numeric"
                placeholder="Model default"
                value={maxTokens}
                maxLength={12}
                autoComplete="off"
                onChange={(event) => setMaxTokens(event.currentTarget.value)}
                onKeyDown={submitOnEnter}
              />
            </label>
            <label className="dvx-cm-check">
              <input
                type="checkbox"
                checked={noImageSupport}
                onChange={(event) => setNoImageSupport(event.currentTarget.checked)}
              />
              <span>No image input</span>
            </label>
          </div>
          {hint !== null ? (
            <p className="dvx-page-note dvx-error-text" role="alert">
              {hint}
            </p>
          ) : null}
          {item !== null && item.hasBedrockConfig ? (
            <p className="dvx-page-note" role="status">
              Bedrock and other advanced fields stay as configured in settings.json
              (verified against the local daemon).
            </p>
          ) : null}
        </section>
      </div>
      <footer className="dvx-page-footer">
        <div className="dvx-page-footer-secondary">
          <button type="button" className="dvx-page-quiet-action" onClick={onBack}>
            Cancel
          </button>
        </div>
        <button
          type="button"
          className="dvx-page-primary"
          disabled={!canSave}
          onClick={submit}
        >
          {item === null ? 'Add model' : 'Save changes'}
        </button>
      </footer>
    </div>
  );
}

/** Shared page crown: quiet back affordance + 13px title. */
export function PageHead({
  backLabel,
  backAriaLabel,
  title,
  actions,
  onBack,
}: {
  readonly backLabel: string;
  readonly backAriaLabel: string;
  readonly title?: string;
  readonly actions?: React.ReactNode;
  readonly onBack: () => void;
}): React.JSX.Element {
  return (
    <header className="dvx-page-head">
      <div className="dvx-page-head-left">
        <button
          type="button"
          className="dvx-page-back"
          aria-label={backAriaLabel}
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span>{backLabel}</span>
        </button>
        {title !== undefined ? <span className="dvx-page-title">{title}</span> : null}
      </div>
      {actions !== undefined ? (
        <div className="dvx-page-head-actions">{actions}</div>
      ) : null}
    </header>
  );
}

function CustomModelProviderSelector({
  value,
  onChange,
}: {
  readonly value: CustomModelProvider;
  readonly onChange: (provider: CustomModelProvider) => void;
}): React.JSX.Element {
  const name = useId();
  return (
    <div className="dvx-cm-field" role="radiogroup" aria-label="Provider">
      <span className="dvx-cm-field-label">Provider *</span>
      <div className="dvx-cm-pills">
        {CUSTOM_MODEL_PROVIDERS.map((provider) => (
          <label
            key={provider}
            className="dvx-cm-pill"
            data-checked={value === provider ? 'true' : undefined}
          >
            <input
              className="dvx-visually-hidden"
              type="radio"
              name={name}
              value={provider}
              checked={value === provider}
              onChange={() => onChange(provider)}
            />
            <span>{CUSTOM_MODEL_PROVIDER_LABELS[provider]}</span>
          </label>
        ))}
      </div>
    </div>
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
      <p className="dvx-page-note" role="status">
        Reading provider catalog…
      </p>
    );
  }
  if (discovery.status === 'error') {
    return (
      <p className="dvx-page-note dvx-error-text" role="alert">
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
          className="dvx-cm-input"
          type="search"
          aria-label="Search provider models"
          placeholder="Search models"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
            }
          }}
        />
        <button
          type="button"
          className="dvx-page-quiet-action"
          disabled={working || visibleItems.length === 0}
          onClick={onSelectVisible}
        >
          Select visible
        </button>
      </div>
      {visibleItems.length === 0 ? (
        <p className="dvx-page-note" role="status">
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
                    <span className="dvx-cm-name">{item.displayName ?? item.model}</span>
                    {item.displayName !== undefined ? (
                      <span className="dvx-cm-meta">{item.model}</span>
                    ) : null}
                  </span>
                  {configured ? <span className="dvx-cm-tag">Added</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ChevronLeftIcon(): React.JSX.Element {
  return (
    <svg className="dvx-chevron-left" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m9.5 4.5-3.5 3.5 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
