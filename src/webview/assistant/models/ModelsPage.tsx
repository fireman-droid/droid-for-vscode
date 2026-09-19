import { useContext, useEffect, useState } from 'react';

import {
  IDLE_CUSTOM_MODELS_STATE,
  type CustomModelDiscoveryUiState,
  type CustomModelListItem,
  type CustomModelsUiState,
} from '../../../shared/protocol/customModelsProtocol';
import { CustomModelsContext } from './customModelsFlow';
import { PageHead } from './ModelProviderPage';
import { CUSTOM_MODEL_PROVIDER_LABELS } from './customModelsFlow';
import {
  CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  isCustomModelBaseUrl,
  type CustomModelProvider,
  type ProviderConnectionSummary,
  type ProviderModelTestResult,
} from '../../../shared/protocol/customModelsProtocol';
import { sameProviderEndpoint } from '../../../shared/validation/providerEndpoint';
import {
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
} from '../../../shared/protocol/bounds';
import { CompactSelect } from '../mission/MissionSetup';

/**
 * Full-page BYOK model manager (spec §6, 拍板 2026-08-15: the model
 * menu's "Add models" swaps the whole chat view for this page; the
 * "+ Add provider" entry and every edit open a further stand-alone
 * page in ModelProviderPage.tsx). Chat state runs on untouched in the
 * background — this is a webview-local view switch owned by App.tsx.
 *
 * Escape backs out one level: config pages return to this list, the
 * list returns to the chat. ← and a successful save/import follow the
 * same paths.
 */

type PageView =
  | { readonly mode: 'list' }
  | {
      readonly mode: 'providerEdit';
      readonly provider?: ProviderConnectionSummary;
    };

export function ModelsPage({
  onClose,
}: {
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const flow = useContext(CustomModelsContext);
  const [view, setView] = useState<PageView>({ mode: 'list' });
  // Shown once the user changed something: models enter the picker
  // via a session (re)load, which the host performs only when idle.
  const [mutated, setMutated] = useState(false);
  const state = flow?.customModels ?? IDLE_CUSTOM_MODELS_STATE;
  useEffect(() => {
    flow?.onRefreshProviders();
    flow?.onRefresh();
  }, [flow?.sessionId]);
  const onList = view.mode === 'list';
  useEffect(() => {
    const backOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (onList) {
          onClose();
        } else {
          setView({ mode: 'list' });
        }
      }
    };
    document.addEventListener('keydown', backOnEscape);
    return () => document.removeEventListener('keydown', backOnEscape);
  }, [onList, onClose]);
  if (flow === null) {
    return null;
  }
  const busy = state.status === 'loading' || state.status === 'idle';
  const sessionKey = flow.sessionId ?? 'no-session';
  if (view.mode === 'providerEdit') {
    const returnToList = (): void => {
      setView({ mode: 'list' });
      flow.onRefreshProviders();
      flow.onRefresh();
    };
    return (
      <ProviderEditor
        key={sessionKey}
        provider={view.provider}
        providers={flow.providers.providers}
        items={state.items}
        discovery={flow.discovery}
        busy={busy}
        onBack={returnToList}
        onSave={flow.onSaveProvider}
        onFetch={(providerId) => flow.onFetchProvider(providerId)}
        onImport={(providerId, models) => {
          setMutated(true);
          flow.onImportProviderModels({
            providerId,
            models,
            maxOutputTokens: null,
            noImageSupport: false,
          });
        }}
        onSaveModel={(providerId, params) => {
          setMutated(true);
          flow.onSaveProviderModel({ providerId, ...params });
        }}
        onTest={(providerId, model) => flow.onTestProviderModel(providerId, model)}
        onTestAll={(providerId) => flow.onTestAllProviderModels(providerId)}
        onDelete={(item) => {
          setMutated(true);
          flow.onDelete(item.rawIndex, item.model);
        }}
      />
    );
  }
  return (
    <div className="dvx-models-page" role="region" aria-label="Models">
      <PageHead
        backLabel="Models"
        backAriaLabel="Back to chat"
        onBack={onClose}
        actions={
          <button
            type="button"
            className="dvx-page-action"
            disabled={state.status === 'loading'}
            onClick={flow.onRefresh}
          >
            Refresh
          </button>
        }
      />
      <div className="dvx-models-body">
        <ModelsList
          state={state}
          busy={busy}
          mutated={mutated}
          providers={flow.providers.providers}
          onAddProvider={() => setView({ mode: 'providerEdit' })}
          onOpen={(provider) => setView({ mode: 'providerEdit', provider })}
        />
      </div>
    </div>
  );
}

function ModelsList({
  state,
  busy,
  mutated,
  providers,
  onAddProvider,
  onOpen,
}: {
  readonly state: CustomModelsUiState;
  readonly busy: boolean;
  readonly mutated: boolean;
  readonly providers: readonly ProviderConnectionSummary[];
  readonly onAddProvider: () => void;
  readonly onOpen: (provider: ProviderConnectionSummary) => void;
}): React.JSX.Element {
  return (
    <>
      {state.status === 'error' || state.status === 'unavailable' ? (
        <p
          className={`dvx-page-note ${state.status === 'error' ? 'dvx-error-text' : ''}`}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}
      {busy && state.items.length === 0 ? (
        <p className="dvx-page-note" role="status">
          Loading custom models…
        </p>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <p className="dvx-page-note" role="status">
          No custom models configured yet.
        </p>
      ) : null}
      {providers.length > 0 ? (
        <div className="dvx-cm-groups" aria-label="Custom model groups">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="dvx-cm-group dvx-cm-provider-card"
              onClick={() => onOpen(provider)}
            >
              <div className="dvx-cm-group-head">
                <span className="dvx-cm-group-copy">
                  <strong className="dvx-cm-group-host">{provider.displayName}</strong>
                  <span className="dvx-cm-group-meta">
                    <span>{CUSTOM_MODEL_PROVIDER_LABELS[provider.protocol]}</span>
                    <span>
                      {provider.modelCount}{' '}
                      {provider.modelCount === 1 ? 'model' : 'models'}
                    </span>
                    <span className="dvx-cm-key">
                      {provider.hasApiKey ? 'key saved' : 'key needed'}
                    </span>
                  </span>
                </span>
                <span className="dvx-page-quiet-action">Manage</span>
              </div>
              {provider.latestTest !== undefined ? (
                <span className="dvx-cm-provider-test">
                  {provider.latestTest.status === 'passed'
                    ? 'Last test passed'
                    : provider.latestTest.summary}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="dvx-cm-add-provider"
        disabled={busy || state.status === 'unavailable'}
        onClick={onAddProvider}
      >
        + Add provider
      </button>
      {mutated && state.status === 'ready' ? (
        <p className="dvx-page-note" role="status">
          Changes reach the model picker when the session reloads; busy sessions pick them
          up on the next reload.
        </p>
      ) : null}
    </>
  );
}

export function ProviderEditor({
  provider,
  providers,
  items,
  discovery,
  busy,
  onBack,
  onSave,
  onFetch,
  onImport,
  onSaveModel,
  onTest,
  onTestAll,
  onDelete,
}: {
  readonly provider?: ProviderConnectionSummary;
  readonly providers: readonly ProviderConnectionSummary[];
  readonly items: readonly CustomModelListItem[];
  readonly discovery: CustomModelDiscoveryUiState;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onSave: (params: {
    readonly displayName: string;
    readonly protocol: CustomModelProvider;
    readonly rootUrl: string;
    readonly setApiKey?: boolean;
    readonly providerId?: string;
  }) => void;
  readonly onFetch: (providerId: string) => void;
  readonly onImport: (
    providerId: string,
    models: readonly {
      readonly model: string;
      readonly displayName?: string;
    }[],
  ) => void;
  readonly onSaveModel: (
    providerId: string,
    params: {
      readonly model: string;
      readonly displayName?: string;
      readonly maxOutputTokens: number | null;
      readonly noImageSupport: boolean;
      readonly rawIndex?: number;
      readonly expectedModel?: string;
    },
  ) => void;
  readonly onTest: (providerId: string, model: string) => void;
  readonly onTestAll: (providerId: string) => void;
  readonly onDelete: (item: CustomModelListItem) => void;
}): React.JSX.Element {
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '');
  const [protocol, setProtocol] = useState<CustomModelProvider>(
    provider?.protocol ?? 'openai',
  );
  const [rootUrl, setRootUrl] = useState(provider?.rootUrl ?? '');
  const [setApiKey, setSetApiKey] = useState(false);
  const savedProvider = resolveEditorProvider(
    provider,
    providers,
    displayName,
    protocol,
    rootUrl,
  );
  const valid = displayName.trim().length > 0 && isCustomModelBaseUrl(rootUrl.trim());
  return (
    <div className="dvx-models-page" role="form" aria-label="Provider connection">
      <PageHead
        backLabel="Models"
        backAriaLabel="Back to models"
        title={provider === undefined ? 'New connection' : 'Edit connection'}
        onBack={onBack}
      />
      <div className="dvx-models-body">
        <section className="dvx-page-section">
          <p className="dvx-page-note">
            Connection details are shared by every model you add here.
          </p>
          <label className="dvx-cm-field">
            <span className="dvx-cm-field-label">Connection name *</span>
            <input
              className="dvx-cm-input"
              value={displayName}
              maxLength={MAX_MODEL_DISPLAY_NAME_LENGTH}
              placeholder="e.g. Team DeepSeek"
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
          <CompactSelect
            label="Protocol"
            fieldLabel="Protocol *"
            value={protocol}
            options={CUSTOM_MODEL_PROVIDERS.map((value) => ({
              value,
              label: CUSTOM_MODEL_PROVIDER_LABELS[value],
            }))}
            menuLabel="Available protocols"
            placeholder="Choose a protocol"
            disabled={false}
            onChange={(value) => setProtocol(value as CustomModelProvider)}
          />
          <label className="dvx-cm-field">
            <span className="dvx-cm-field-label">Domain root *</span>
            <input
              className="dvx-cm-input"
              value={rootUrl}
              maxLength={MAX_CUSTOM_MODEL_URL_LENGTH}
              placeholder="https://api.example.com"
              spellCheck={false}
              onChange={(event) => setRootUrl(event.currentTarget.value)}
            />
          </label>
          <label className="dvx-cm-check">
            <input
              type="checkbox"
              checked={setApiKey}
              onChange={(event) => setSetApiKey(event.currentTarget.checked)}
            />
            <span>
              {savedProvider?.hasApiKey
                ? 'Change API key when saving'
                : 'Add API key when saving'}
            </span>
          </label>
        </section>
        {savedProvider !== undefined ? (
          <ProviderModelsSection
            provider={savedProvider}
            items={items}
            discovery={discovery}
            busy={busy}
            onFetch={onFetch}
            onImport={onImport}
            onSaveModel={onSaveModel}
            onTest={onTest}
            onTestAll={onTestAll}
            onDelete={onDelete}
          />
        ) : (
          <section className="dvx-page-section">
            <div className="dvx-page-section-head">
              <h3 className="dvx-page-section-title">Model configuration</h3>
              <div className="dvx-cm-detail-actions">
                <button type="button" className="dvx-page-action" disabled>
                  Fetch model list
                </button>
                <button type="button" className="dvx-page-action" disabled>
                  Add model
                </button>
                <button type="button" className="dvx-page-action" disabled>
                  Test all
                </button>
              </div>
            </div>
            <p className="dvx-page-note">
              Save this connection first. Model controls unlock here as soon as the Host
              confirms it.
            </p>
          </section>
        )}
      </div>
      <footer className="dvx-page-footer">
        <button type="button" className="dvx-page-quiet-action" onClick={onBack}>
          Cancel
        </button>
        <button
          type="button"
          className="dvx-page-primary"
          disabled={!valid}
          onClick={() =>
            onSave({
              displayName: displayName.trim(),
              protocol,
              rootUrl: rootUrl.trim(),
              ...(setApiKey ? { setApiKey: true } : {}),
              ...(savedProvider === undefined || savedProvider.imported
                ? {}
                : { providerId: savedProvider.id }),
            })
          }
        >
          Save connection
        </button>
      </footer>
    </div>
  );
}

function ProviderModelsSection({
  provider,
  items,
  discovery,
  busy,
  onFetch,
  onImport,
  onSaveModel,
  onTest,
  onTestAll,
  onDelete,
}: {
  readonly provider: ProviderConnectionSummary;
  readonly items: readonly CustomModelListItem[];
  readonly discovery: CustomModelDiscoveryUiState;
  readonly busy: boolean;
  readonly onFetch: (providerId: string) => void;
  readonly onImport: (
    providerId: string,
    models: readonly { readonly model: string; readonly displayName?: string }[],
  ) => void;
  readonly onSaveModel: (
    providerId: string,
    params: {
      readonly model: string;
      readonly displayName?: string;
      readonly maxOutputTokens: number | null;
      readonly noImageSupport: boolean;
      readonly rawIndex?: number;
      readonly expectedModel?: string;
    },
  ) => void;
  readonly onTest: (providerId: string, model: string) => void;
  readonly onTestAll: (providerId: string) => void;
  readonly onDelete: (item: CustomModelListItem) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const models = items.filter(
    (item) =>
      item.provider === provider.protocol &&
      sameProviderEndpoint(item.baseUrl, provider.rootUrl),
  );
  return (
    <section className="dvx-page-section">
      <div className="dvx-page-section-head">
        <h3 className="dvx-page-section-title">Model configuration</h3>
        <div className="dvx-cm-detail-actions">
          <button
            type="button"
            className="dvx-page-action"
            disabled={busy || !provider.hasApiKey}
            onClick={() => {
              setCatalogOpen(true);
              onFetch(provider.id);
            }}
          >
            Fetch model list
          </button>
          <button
            type="button"
            className="dvx-page-action"
            disabled={busy || adding}
            onClick={() => setAdding(true)}
          >
            Add model
          </button>
          <button
            type="button"
            className="dvx-page-action"
            disabled={busy || models.length === 0}
            onClick={() => onTestAll(provider.id)}
          >
            Test all
          </button>
        </div>
      </div>
      {provider.latestTest !== undefined ? (
        <p className="dvx-cm-section-test" role="status">
          {provider.latestTest.summary}
        </p>
      ) : null}
      {catalogOpen ? (
        <InlineCatalog
          discovery={discovery}
          busy={busy}
          onClose={() => setCatalogOpen(false)}
          onAddManual={() => {
            setCatalogOpen(false);
            setAdding(true);
          }}
          onImport={(selected) => {
            onImport(provider.id, selected);
            setCatalogOpen(false);
          }}
        />
      ) : null}
      {!provider.hasApiKey ? (
        <p className="dvx-page-note">
          Save an API key for this connection before fetching its model list.
        </p>
      ) : null}
      {models.length === 0 && !adding ? (
        <p className="dvx-page-note">No models configured for this connection.</p>
      ) : null}
      <div className="dvx-cm-edit-list">
        {models.map((item) => (
          <InlineModelRow
            key={item.rawIndex}
            item={item}
            busy={busy}
            test={provider.modelTests?.find((result) => result.model === item.model)}
            onSave={(params) => onSaveModel(provider.id, params)}
            onTest={() => onTest(provider.id, item.model)}
            onDelete={() => onDelete(item)}
          />
        ))}
        {adding ? (
          <InlineModelRow
            item={null}
            busy={busy}
            onSave={(params) => {
              onSaveModel(provider.id, params);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
      </div>
    </section>
  );
}

function resolveEditorProvider(
  provider: ProviderConnectionSummary | undefined,
  providers: readonly ProviderConnectionSummary[],
  displayName: string,
  protocol: CustomModelProvider,
  rootUrl: string,
): ProviderConnectionSummary | undefined {
  if (provider !== undefined) {
    const byId = providers.find((candidate) => candidate.id === provider.id);
    if (byId !== undefined) {
      return byId;
    }
    const byEndpoint = providers.find(
      (candidate) =>
        !candidate.imported &&
        candidate.protocol === provider.protocol &&
        sameProviderEndpoint(candidate.rootUrl, provider.rootUrl),
    );
    return byEndpoint ?? provider;
  }
  return providers.find(
    (candidate) =>
      !candidate.imported &&
      candidate.displayName === displayName.trim() &&
      candidate.protocol === protocol &&
      sameProviderEndpoint(candidate.rootUrl, rootUrl.trim()),
  );
}

function InlineModelRow({
  item,
  busy,
  test,
  onSave,
  onTest,
  onDelete,
  onCancel,
}: {
  readonly item: CustomModelListItem | null;
  readonly busy: boolean;
  readonly test?: ProviderModelTestResult;
  readonly onSave: (params: {
    readonly model: string;
    readonly displayName?: string;
    readonly maxOutputTokens: number | null;
    readonly noImageSupport: boolean;
    readonly rawIndex?: number;
    readonly expectedModel?: string;
  }) => void;
  readonly onTest?: () => void;
  readonly onDelete?: () => void;
  readonly onCancel?: () => void;
}): React.JSX.Element {
  const [model, setModel] = useState(item?.model ?? '');
  const [displayName, setDisplayName] = useState(item?.displayName ?? '');
  const [maxTokens, setMaxTokens] = useState(
    item?.maxOutputTokens === undefined ? '' : String(item.maxOutputTokens),
  );
  const [noImageSupport, setNoImageSupport] = useState(item?.noImageSupport === true);
  const tokenNumber = Number(maxTokens.trim());
  const valid =
    model.trim().length > 0 &&
    model.trim().length <= MAX_MODEL_ID_LENGTH &&
    (displayName.trim().length === 0 ||
      displayName.trim().length <= MAX_MODEL_DISPLAY_NAME_LENGTH) &&
    (maxTokens.trim().length === 0 ||
      (Number.isSafeInteger(tokenNumber) && tokenNumber > 0));
  return (
    <article className="dvx-cm-edit-row">
      <div className="dvx-cm-edit-fields">
        <label className="dvx-cm-field">
          <span className="dvx-cm-field-label">Model ID *</span>
          <input
            className="dvx-cm-input"
            value={model}
            maxLength={MAX_MODEL_ID_LENGTH}
            onChange={(event) => setModel(event.currentTarget.value)}
          />
        </label>
        <label className="dvx-cm-field">
          <span className="dvx-cm-field-label">Display name</span>
          <input
            className="dvx-cm-input"
            value={displayName}
            maxLength={MAX_MODEL_DISPLAY_NAME_LENGTH}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
        </label>
        <div className="dvx-cm-edit-meta">
          <label className="dvx-cm-field dvx-cm-token-field">
            <span className="dvx-cm-field-label">Max tokens</span>
            <input
              className="dvx-cm-input"
              inputMode="numeric"
              value={maxTokens}
              onChange={(event) => setMaxTokens(event.currentTarget.value)}
            />
          </label>
          <label className="dvx-cm-check dvx-cm-inline-check">
            <input
              type="checkbox"
              checked={noImageSupport}
              onChange={(event) => setNoImageSupport(event.currentTarget.checked)}
            />
            <span>No images</span>
          </label>
        </div>
      </div>
      <div className="dvx-cm-edit-foot">
        {test !== undefined ? (
          <p
            className={`dvx-cm-edit-status${test.status === 'failed' ? ' dvx-cm-edit-status-failed' : ''}`}
            role="status"
          >
            {test.status === 'passed' ? `Passed · ${test.latencyMs}ms` : test.summary}
          </p>
        ) : (
          <span className="dvx-cm-edit-status" />
        )}
        <div className="dvx-cm-inline-actions">
          {onTest ? (
            <button
              type="button"
              className="dvx-cm-edit-btn"
              disabled={busy}
              onClick={onTest}
            >
              Test
            </button>
          ) : null}
          <button
            type="button"
            className="dvx-cm-edit-btn dvx-cm-edit-btn-save"
            disabled={busy || !valid}
            onClick={() =>
              onSave({
                model: model.trim(),
                ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
                maxOutputTokens: maxTokens.trim() ? tokenNumber : null,
                noImageSupport,
                ...(item === null
                  ? {}
                  : { rawIndex: item.rawIndex, expectedModel: item.model }),
              })
            }
          >
            {item === null ? 'Add' : 'Save'}
          </button>
          {onDelete ? (
            <button
              type="button"
              className="dvx-cm-edit-btn dvx-cm-edit-btn-delete"
              disabled={busy}
              onClick={onDelete}
            >
              Delete
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="dvx-cm-edit-btn"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function InlineCatalog({
  discovery,
  busy,
  onClose,
  onAddManual,
  onImport,
}: {
  readonly discovery: CustomModelDiscoveryUiState;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onAddManual: () => void;
  readonly onImport: (
    models: readonly { readonly model: string; readonly displayName?: string }[],
  ) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const items = discovery.status === 'ready' ? discovery.items : [];
  return (
    <div className="dvx-cm-inline-catalog">
      <div className="dvx-page-section-head">
        <span className="dvx-cm-field-label">Provider catalog</span>
        <button type="button" className="dvx-page-action" onClick={onClose}>
          Close
        </button>
      </div>
      {discovery.status === 'loading' ? (
        <p className="dvx-page-note">Reading provider catalog…</p>
      ) : null}
      {discovery.status === 'error' ? (
        <p className="dvx-page-note dvx-error-text">{discovery.message}</p>
      ) : null}
      {discovery.status === 'ready' && items.length === 0 ? (
        <div className="dvx-cm-empty-catalog">
          <p className="dvx-page-note">No models were returned by this connection.</p>
          <button type="button" className="dvx-page-action" onClick={onAddManual}>
            Add model manually
          </button>
        </div>
      ) : null}
      {discovery.status === 'ready' ? (
        <ul className="dvx-cm-discovery-list">
          {items.map((entry) => (
            <li key={entry.model}>
              <label className="dvx-cm-discovery-row">
                <input
                  type="checkbox"
                  checked={selected.has(entry.model)}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(entry.model)) next.delete(entry.model);
                      else next.add(entry.model);
                      return next;
                    })
                  }
                />
                <span className="dvx-cm-copy">
                  <span className="dvx-cm-name">{entry.displayName ?? entry.model}</span>
                  <span className="dvx-cm-meta">{entry.model}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="dvx-page-primary"
        disabled={busy || selected.size === 0}
        onClick={() => onImport(items.filter((entry) => selected.has(entry.model)))}
      >
        Import selected ({selected.size})
      </button>
    </div>
  );
}
