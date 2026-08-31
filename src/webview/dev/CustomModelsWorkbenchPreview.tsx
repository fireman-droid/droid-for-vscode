import { useEffect, useMemo, useState } from 'react';

/* Dev-only interactive master/detail preview of the Custom Models workbench.
   Self-contained fixtures; no production protocol, Bridge or Host hooks.
   All state is local to this component. */

type ProtocolKey = 'anthropic' | 'openai' | 'local';
type StatusTone = 'ok' | 'warn';
type TestStatus = 'passed' | 'failed' | 'untested' | 'running';

interface ModelTest { readonly status: TestStatus; readonly latencyMs?: number; readonly note?: string }
interface ProviderModel { readonly id: string; readonly displayName: string; readonly test: ModelTest; readonly maxTokens?: number; readonly noImage?: boolean }
interface Provider {
  readonly id: string; readonly name: string; readonly protocol: ProtocolKey; readonly protocolLabel: string;
  readonly root: string; readonly host: string; readonly status: StatusTone; readonly hasApiKey: boolean;
  readonly imported: boolean; readonly claimed?: boolean; readonly models: readonly ProviderModel[];
}

const PROTOCOLS: readonly { readonly value: ProtocolKey; readonly label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'local', label: 'Local / OpenAI-compatible' },
];

const LATENCY: Record<string, number> = {
  'claude-opus-4-6': 820, 'claude-sonnet-4-6': 340, 'claude-haiku-4-5': 190, 'gpt-4o': 610,
  'gpt-4o-mini': 275, 'o3-mini': 990, 'qwen2.5-72b': 505, 'llama-3.1-70b': 470,
  'vendor-azure-4o': 730, 'vendor-gemini-flash': 260,
};

const INITIAL_PROVIDERS: readonly Provider[] = [
  {
    id: 'gateway', name: 'Personal Gateway', protocol: 'anthropic', protocolLabel: 'anthropic',
    root: 'https://pvtstack.com', host: 'pvtstack.com', status: 'ok', hasApiKey: true, imported: false,
    models: [
      { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', test: { status: 'passed', latencyMs: 820 } },
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', test: { status: 'passed', latencyMs: 340 } },
      { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', test: { status: 'failed', note: 'handshake failed' } },
    ],
  },
  {
    id: 'teameast', name: 'Team East', protocol: 'openai', protocolLabel: 'openai',
    root: 'https://api.teameast.dev', host: 'api.teameast.dev', status: 'ok', hasApiKey: true, imported: false,
    models: [
      { id: 'gpt-4o', displayName: 'GPT-4o', test: { status: 'passed', latencyMs: 610 } },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', test: { status: 'passed', latencyMs: 275 } },
      { id: 'o3-mini', displayName: 'o3-mini', test: { status: 'untested' } },
    ],
  },
  {
    id: 'infer', name: 'On-prem Inference', protocol: 'local', protocolLabel: 'local',
    root: 'http://infer.local:8080', host: 'infer.local:8080', status: 'warn', hasApiKey: false, imported: false,
    models: [
      { id: 'qwen2.5-72b', displayName: 'Qwen 2.5 72B', test: { status: 'untested' } },
      { id: 'llama-3.1-70b', displayName: 'Llama 3.1 70B', test: { status: 'untested' } },
    ],
  },
  {
    id: 'vendor', name: 'Vendor Hub', protocol: 'openai', protocolLabel: 'openai',
    root: 'https://api.vendorhub.io', host: 'api.vendorhub.io', status: 'ok', hasApiKey: false,
    imported: true, claimed: false,
    models: [
      { id: 'vendor-azure-4o', displayName: 'Azure GPT-4o', test: { status: 'untested' } },
      { id: 'vendor-gemini-flash', displayName: 'Gemini Flash', test: { status: 'untested' } },
    ],
  },
];

const CATALOG: readonly { readonly id: string; readonly displayName: string }[] = [
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  { id: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
  { id: 'claude-3-5-haiku', displayName: 'Claude 3.5 Haiku' },
];

interface ConnectionDraft { readonly name: string; readonly protocol: ProtocolKey; readonly root: string; readonly setApiKey: boolean }

function statusText(test: ModelTest | undefined): { readonly label: string; readonly tone: 'pass' | 'fail' | 'idle' } {
  if (test === undefined || test.status === 'untested') return { label: 'Not tested', tone: 'idle' };
  if (test.status === 'running') return { label: 'Testing…', tone: 'idle' };
  if (test.status === 'passed') return { label: `Passed · ${test.latencyMs ?? 0}ms`, tone: 'pass' };
  return { label: `Failed · ${test.note ?? 'error'}`, tone: 'fail' };
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/gu, '');
  return slug.length > 0 ? slug : 'provider';
}

function configFor(provider: Provider, draft: ConnectionDraft): string {
  return JSON.stringify({
    name: draft.name, protocol: draft.protocol, base_url: draft.root,
    api_key_env: provider.hasApiKey || draft.setApiKey ? 'CUSTOM_MODELS_KEY' : null,
    endpoints: provider.models.map((model) => ({ model: model.id, display_name: model.displayName })),
  }, null, 2);
}

interface EditDraft { readonly id: string; readonly displayName: string; readonly maxTokens: string; readonly noImage: boolean }

function ModelEditorForm({ draft, onChange, onCancel, onSave, addMode }: {
  readonly draft: EditDraft; readonly onChange: (patch: Partial<EditDraft>) => void;
  readonly onCancel: () => void; readonly onSave: () => void; readonly addMode: boolean;
}): React.JSX.Element {
  const tokenNumber = Number(draft.maxTokens.trim());
  const valid = draft.id.trim().length > 0 &&
    (draft.maxTokens.trim().length === 0 || (Number.isSafeInteger(tokenNumber) && tokenNumber > 0));
  return (
    <div className="dvx-ww-model-edit">
      <label className="dvx-ww-model-edit-field">
        <span className="dvx-ww-field-label">Model ID *</span>
        <input className="dvx-ww-input" value={draft.id} spellCheck={false} onChange={(e) => onChange({ id: e.currentTarget.value })} />
      </label>
      <label className="dvx-ww-model-edit-field">
        <span className="dvx-ww-field-label">Display name</span>
        <input className="dvx-ww-input" value={draft.displayName} onChange={(e) => onChange({ displayName: e.currentTarget.value })} />
      </label>
      <div className="dvx-ww-model-edit-meta">
        <label className="dvx-ww-model-edit-field dvx-ww-model-edit-token">
          <span className="dvx-ww-field-label">Max tokens</span>
          <input className="dvx-ww-input" inputMode="numeric" value={draft.maxTokens} onChange={(e) => onChange({ maxTokens: e.currentTarget.value })} />
        </label>
        <label className="dvx-ww-model-edit-check">
          <input type="checkbox" checked={draft.noImage} onChange={(e) => onChange({ noImage: e.currentTarget.checked })} />
          <span>No images</span>
        </label>
      </div>
      <div className="dvx-ww-inline-actions">
        <button type="button" className="dvx-ww-text-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-emph" disabled={!valid} onClick={onSave}>
          {addMode ? 'Add model' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function ProviderRow({ provider, selected, onSelect, onClaim }: {
  readonly provider: Provider; readonly selected: boolean; readonly onSelect: () => void; readonly onClaim: () => void;
}): React.JSX.Element {
  return (
    <div className="dvx-ww-provider" data-selected={selected ? 'true' : 'false'}>
      <button type="button" className="dvx-ww-provider-main" onClick={onSelect}>
        <span className="dvx-ww-provider-rail" />
        <span className="dvx-ww-dot" data-status={provider.status} aria-hidden="true" />
        <span className="dvx-ww-provider-copy">
          <span className="dvx-ww-provider-name">{provider.name}</span>
          <span className="dvx-ww-provider-meta">{provider.protocolLabel} · {provider.host}</span>
        </span>
        {provider.imported ? null : <span className="dvx-ww-provider-count">{provider.models.length}</span>}
      </button>
      {provider.imported ? (
        <button type="button" className={provider.claimed ? 'dvx-ww-claim dvx-ww-claim-done' : 'dvx-ww-claim'}
          disabled={provider.claimed} onClick={onClaim}
          aria-label={provider.claimed ? `${provider.name} claimed` : `Claim ${provider.name}`}>
          {provider.claimed ? 'Claimed' : 'Claim'}
        </button>
      ) : null}
    </div>
  );
}

export function CustomModelsWorkbenchPreview(): React.JSX.Element {
  const [providers, setProviders] = useState<readonly Provider[]>(INITIAL_PROVIDERS);
  const [selectedId, setSelectedId] = useState<string>('gateway');
  const [railQuery, setRailQuery] = useState('');
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProviderDraft, setNewProviderDraft] = useState({ name: '', protocol: 'openai' as ProtocolKey, root: '' });
  const [detailOpen, setDetailOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogSelected, setCatalogSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [addingModel, setAddingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState<EditDraft>({ id: '', displayName: '', maxTokens: '', noImage: false });
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ id: '', displayName: '', maxTokens: '', noImage: false });
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [testingAll, setTestingAll] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [openOverflowId, setOpenOverflowId] = useState<string | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(() => draftFor(INITIAL_PROVIDERS.find((p) => p.id === 'gateway')!));
  const [configText, setConfigText] = useState<string>(() => configFor(INITIAL_PROVIDERS.find((p) => p.id === 'gateway')!, {
    name: 'Personal Gateway', protocol: 'anthropic', root: 'https://pvtstack.com', setApiKey: false,
  }));

  function draftFor(provider: Provider): ConnectionDraft {
    return { name: provider.name, protocol: provider.protocol, root: provider.root, setApiKey: false };
  }

  const selected = useMemo(() => providers.find((p) => p.id === selectedId) ?? providers[0], [providers, selectedId]);
  const ownedProviders = providers.filter((p) => p.imported === false);
  const importedProviders = providers.filter((p) => p.imported === true);
  const match = (provider: Provider): boolean => {
    const query = railQuery.trim().toLowerCase();
    return query.length === 0 || provider.name.toLowerCase().includes(query) || provider.host.toLowerCase().includes(query) || provider.protocolLabel.toLowerCase().includes(query);
  };
  const filteredOwned = ownedProviders.filter(match);
  const filteredImported = importedProviders.filter(match);

  useEffect(() => {
    setConnectionDraft(draftFor(selected));
    setConfigText(configFor(selected, draftFor(selected)));
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setOpenOverflowId(null); setCatalogOpen(false); setDeletingProvider(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (openOverflowId === null) return;
    const close = (): void => setOpenOverflowId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openOverflowId]);

  if (selected === undefined) {
    return (
      <div className="dvx-ww-root">
        <div className="dvx-ww-empty">
          <h2 className="dvx-ww-main-title">No connections</h2>
          <span className="dvx-ww-note">Add a provider to begin configuring custom models.</span>
        </div>
      </div>
    );
  }

  const selectProvider = (id: string): void => { setSelectedId(id); setDetailOpen(true); setEditingModelId(null); setAddingModel(false); };
  const claimProvider = (id: string): void => setProviders((current) => current.map((p) => (p.id === id ? { ...p, claimed: true } : p)));
  const addProvider = (): void => {
    if (newProviderDraft.name.trim().length === 0) return;
    const id = `${slugify(newProviderDraft.name)}-${Date.now()}`;
    const protocolLabel = PROTOCOLS.find((o) => o.value === newProviderDraft.protocol)?.label ?? newProviderDraft.protocol;
    const host = newProviderDraft.root.replace(/^https?:\/\//u, '').replace(/\/+$/u, '') || newProviderDraft.root;
    setProviders((current) => [...current, {
      id, name: newProviderDraft.name.trim(), protocol: newProviderDraft.protocol, protocolLabel,
      root: newProviderDraft.root.trim(), host, status: 'warn', hasApiKey: false, imported: false, models: [],
    }]);
    setSelectedId(id); setAddingProvider(false); setNewProviderDraft({ name: '', protocol: 'openai', root: '' }); setDetailOpen(true);
  };
  const saveConnection = (): void => {
    setProviders((current) => current.map((p) => (p.id === selected.id ? {
      ...p, name: connectionDraft.name.trim() || p.name, protocol: connectionDraft.protocol,
      protocolLabel: PROTOCOLS.find((o) => o.value === connectionDraft.protocol)?.label ?? connectionDraft.protocol,
      root: connectionDraft.root.trim() || p.root,
      host: connectionDraft.root.trim().replace(/^https?:\/\//u, '').replace(/\/+$/u, '') || p.host,
      hasApiKey: p.hasApiKey || connectionDraft.setApiKey,
    } : p)));
    setSavedNote(connectionDraft.setApiKey ? 'Saved — API key will be set on the host.' : 'Saved');
    window.setTimeout(() => setSavedNote(null), 1800);
  };
  const deleteConnection = (): void => {
    const remaining = providers.filter((p) => p.id !== selected.id);
    setProviders(remaining); setSelectedId(remaining[0]?.id ?? ''); setDeletingProvider(false); setDetailOpen(false);
  };
  const testModel = (id: string): void => {
    const providerId = selected.id;
    setTestingIds((current) => new Set(current).add(id));
    window.setTimeout(() => {
      setProviders((current) => current.map((p) => (p.id === providerId ? {
        ...p, models: p.models.map((m) => (m.id === id ? { ...m, test: { status: 'passed', latencyMs: LATENCY[id] ?? 300 } } : m)),
      } : p)));
      setTestingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }, 700);
  };
  const testAllModels = (): void => {
    setTestingAll(true);
    const providerId = selected.id;
    setTestingIds(new Set(selected.models.map((m) => m.id)));
    window.setTimeout(() => {
      setProviders((current) => current.map((p) => (p.id === providerId ? {
        ...p, models: p.models.map((m) => ({ ...m, test: { status: 'passed' as const, latencyMs: LATENCY[m.id] ?? 380 } })),
      } : p)));
      setTestingAll(false); setTestingIds(new Set());
    }, 950);
  };
  const startEditModel = (model: ProviderModel): void => {
    setEditingModelId(model.id);
    setEditDraft({ id: model.id, displayName: model.displayName, maxTokens: model.maxTokens === undefined ? '' : String(model.maxTokens), noImage: model.noImage === true });
  };
  const saveEditModel = (): void => {
    const patch = { ...editDraft };
    setProviders((current) => current.map((p) => (p.id === selected.id ? {
      ...p, models: p.models.map((m) => (m.id === editingModelId ? {
        ...m, id: patch.id.trim() || m.id, displayName: patch.displayName.trim() || patch.id.trim() || m.displayName,
        maxTokens: patch.maxTokens.trim().length > 0 ? Number(patch.maxTokens.trim()) : undefined, noImage: patch.noImage,
      } : m)),
    } : p)));
    setEditingModelId(null);
  };
  const deleteModel = (id: string): void => {
    setProviders((current) => current.map((p) => (p.id === selected.id ? { ...p, models: p.models.filter((m) => m.id !== id) } : p)));
    setOpenOverflowId(null);
  };
  const addModel = (): void => {
    if (modelDraft.id.trim().length === 0) return;
    setProviders((current) => current.map((p) => (p.id === selected.id ? {
      ...p, models: [...p.models, {
        id: modelDraft.id.trim(), displayName: modelDraft.displayName.trim() || modelDraft.id.trim(),
        test: { status: 'untested' as const }, maxTokens: modelDraft.maxTokens.trim().length > 0 ? Number(modelDraft.maxTokens.trim()) : undefined,
        noImage: modelDraft.noImage,
      }],
    } : p)));
    setAddingModel(false); setModelDraft({ id: '', displayName: '', maxTokens: '', noImage: false });
  };
  const openCatalog = (): void => { setCatalogOpen(true); setCatalogQuery(''); setCatalogSelected(new Set()); };
  const toggleCatalogItem = (id: string): void => setCatalogSelected((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const importSelected = (): void => {
    const chosen = CATALOG.filter((entry) => catalogSelected.has(entry.id));
    setProviders((current) => current.map((p) => (p.id === selected.id ? {
      ...p, models: [...p.models, ...chosen.filter((e) => !p.models.some((m) => m.id === e.id))
        .map((e) => ({ id: e.id, displayName: e.displayName, test: { status: 'untested' as const } }))],
    } : p)));
    setCatalogOpen(false);
  };
  const filteredCatalog = CATALOG.filter((entry) => {
    const query = catalogQuery.trim().toLowerCase();
    return query.length === 0 || entry.id.toLowerCase().includes(query) || entry.displayName.toLowerCase().includes(query);
  });
  const back = (): void => setDetailOpen(false);
  const statusLabel = (model: ProviderModel): string => {
    const testing = testingIds.has(model.id);
    return statusText(testing ? { status: 'running' } : model.test).label;
  };

  const protocolOptions = PROTOCOLS.map((o) => (
    <option key={o.value} value={o.value}>{o.label}</option>
  ));

  return (
    <div className="dvx-ww-root">
      <div className="dvx-ww" data-ww-mobile={detailOpen ? 'detail' : 'list'}>
        <aside className="dvx-ww-rail" aria-label="Providers">
          <header className="dvx-ww-rail-head">
            <h1 className="dvx-ww-rail-title">Custom Models</h1>
            <p className="dvx-ww-rail-sub">Connections and their models</p>
          </header>
          <div className="dvx-ww-rail-tools">
            <label className="dvx-ww-search">
              <svg className="dvx-ww-search-icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.5 10.5 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input type="search" className="dvx-ww-input dvx-ww-search-input" placeholder="Filter providers" aria-label="Filter providers" value={railQuery} onChange={(e) => setRailQuery(e.currentTarget.value)} />
            </label>
            <button type="button" className="dvx-ww-rail-add" onClick={() => setAddingProvider(true)}>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="dvx-ww-add-icon">
                <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Add provider
            </button>
          </div>
          {addingProvider ? (
            <div className="dvx-ww-add-provider">
              <label className="dvx-ww-field">
                <span className="dvx-ww-field-label">Connection name *</span>
                <input className="dvx-ww-input" value={newProviderDraft.name} placeholder="e.g. Team DeepSeek" onChange={(e) => setNewProviderDraft({ ...newProviderDraft, name: e.currentTarget.value })} />
              </label>
              <label className="dvx-ww-field">
                <span className="dvx-ww-field-label">Protocol</span>
                <select className="dvx-ww-select" value={newProviderDraft.protocol} onChange={(e) => setNewProviderDraft({ ...newProviderDraft, protocol: e.currentTarget.value as ProtocolKey })}>
                  {protocolOptions}
                </select>
              </label>
              <label className="dvx-ww-field">
                <span className="dvx-ww-field-label">Domain root *</span>
                <input className="dvx-ww-input" value={newProviderDraft.root} placeholder="https://api.example.com" spellCheck={false} onChange={(e) => setNewProviderDraft({ ...newProviderDraft, root: e.currentTarget.value })} />
              </label>
              <div className="dvx-ww-inline-actions">
                <button type="button" className="dvx-ww-text-btn" onClick={() => setAddingProvider(false)}>Cancel</button>
                <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-emph" disabled={newProviderDraft.name.trim().length === 0} onClick={addProvider}>Add provider</button>
              </div>
            </div>
          ) : null}
          <div className="dvx-ww-rail-body">
            <nav className="dvx-ww-rail-group" aria-label="Owned providers">
              <span className="dvx-ww-group-label">Connections</span>
              <ul className="dvx-ww-rail-list">
                {filteredOwned.map((provider) => (
                  <li key={provider.id}>
                    <ProviderRow provider={provider} selected={provider.id === selectedId} onSelect={() => selectProvider(provider.id)} onClaim={() => claimProvider(provider.id)} />
                  </li>
                ))}
                {filteredOwned.length === 0 ? <li className="dvx-ww-rail-empty">No connections match.</li> : null}
              </ul>
            </nav>
            {filteredImported.length > 0 ? (
              <nav className="dvx-ww-rail-group" aria-label="Imported providers">
                <span className="dvx-ww-group-label">Imported <span className="dvx-ww-group-note">claim once to manage</span></span>
                <ul className="dvx-ww-rail-list">
                  {filteredImported.map((provider) => (
                    <li key={provider.id}>
                      <ProviderRow provider={provider} selected={provider.id === selectedId} onSelect={() => selectProvider(provider.id)} onClaim={() => claimProvider(provider.id)} />
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
        </aside>

        <section className="dvx-ww-main" aria-label="Provider workspace">
          <header className="dvx-ww-main-head">
            <div className="dvx-ww-main-head-top">
              <button type="button" className="dvx-ww-back" onClick={back} aria-label="Back to providers">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="dvx-ww-main-title-wrap">
                <h2 className="dvx-ww-main-title">{selected.name}</h2>
                <span className="dvx-ww-main-meta">{selected.protocolLabel} · {selected.root}</span>
              </div>
              <div className="dvx-ww-main-actions">
                {selected.imported && !selected.claimed ? <button type="button" className="dvx-ww-primary" onClick={() => claimProvider(selected.id)}>Claim connection</button> : null}
                <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-danger" onClick={() => setDeletingProvider((v) => !v)}>{deletingProvider ? 'Confirm delete?' : 'Delete'}</button>
                <button type="button" className="dvx-ww-primary" onClick={saveConnection}>Save</button>
              </div>
            </div>
            {deletingProvider ? (
              <div className="dvx-ww-deleting">
                <span>Delete this connection and its models?</span>
                <div className="dvx-ww-inline-actions">
                  <button type="button" className="dvx-ww-text-btn" onClick={() => setDeletingProvider(false)}>Keep</button>
                  <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-danger" onClick={deleteConnection}>Delete</button>
                </div>
              </div>
            ) : null}
            {savedNote !== null ? <span className="dvx-ww-saved-note" role="status">{savedNote}</span> : null}
          </header>

          <div className="dvx-ww-scroll">
            {selected.imported && !selected.claimed ? (
              <div className="dvx-ww-banner">
                <span className="dvx-ww-banner-text">Imported connection — verify ownership once to manage its models locally.</span>
                <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-emph" onClick={() => claimProvider(selected.id)}>Claim</button>
              </div>
            ) : null}

            <section className="dvx-ww-section">
              <div className="dvx-ww-section-head"><h3 className="dvx-ww-section-title">Connection</h3></div>
              <div className="dvx-ww-form-grid">
                <label className="dvx-ww-field">
                  <span className="dvx-ww-field-label">Connection name</span>
                  <input className="dvx-ww-input" value={connectionDraft.name} onChange={(e) => setConnectionDraft({ ...connectionDraft, name: e.currentTarget.value })} />
                </label>
                <label className="dvx-ww-field">
                  <span className="dvx-ww-field-label">Protocol</span>
                  <select className="dvx-ww-select" value={connectionDraft.protocol} onChange={(e) => setConnectionDraft({ ...connectionDraft, protocol: e.currentTarget.value as ProtocolKey })}>
                    {protocolOptions}
                  </select>
                </label>
              </div>
              <label className="dvx-ww-field">
                <span className="dvx-ww-field-label">Domain root</span>
                <input className="dvx-ww-input" value={connectionDraft.root} spellCheck={false} onChange={(e) => setConnectionDraft({ ...connectionDraft, root: e.currentTarget.value })} />
              </label>
              <div className="dvx-ww-apikey">
                <span className="dvx-ww-apikey-value" aria-hidden="true">{selected.hasApiKey || connectionDraft.setApiKey ? '••••••••••••' : 'Not set'}</span>
                <span className="dvx-ww-apikey-label">{selected.hasApiKey || connectionDraft.setApiKey ? 'API key is stored securely on the host.' : "Add a key to fetch this connection's model catalog."}</span>
                <label className="dvx-ww-check">
                  <input type="checkbox" checked={connectionDraft.setApiKey} onChange={(e) => setConnectionDraft({ ...connectionDraft, setApiKey: e.currentTarget.checked })} />
                  <span>{selected.hasApiKey ? 'Rotate key when saving' : 'Set a key when saving'}</span>
                </label>
              </div>
            </section>

            <section className="dvx-ww-section">
              <div className="dvx-ww-section-head">
                <h3 className="dvx-ww-section-title">Config JSON</h3>
                <span className="dvx-ww-section-hint">Editable — shared by every model here</span>
              </div>
              <div className="dvx-ww-config">
                <textarea className="dvx-ww-code" value={configText} spellCheck={false} aria-label="Provider config JSON" onChange={(e) => setConfigText(e.currentTarget.value)} />
              </div>
            </section>

            <section className="dvx-ww-section dvx-ww-models-section">
              <div className="dvx-ww-section-head dvx-ww-models-head">
                <h3 className="dvx-ww-section-title">Models</h3>
                <div className="dvx-ww-models-actions">
                  <button type="button" className="dvx-ww-text-btn" disabled={!selected.hasApiKey} onClick={openCatalog}>Fetch catalog</button>
                  <button type="button" className="dvx-ww-text-btn" disabled={addingModel} onClick={() => setAddingModel(true)}>Add model</button>
                  <button type="button" className="dvx-ww-text-btn" disabled={selected.models.length === 0 || testingAll} onClick={testAllModels}>{testingAll ? 'Testing all…' : 'Test all'}</button>
                </div>
              </div>
              {!selected.hasApiKey && !selected.imported ? <p className="dvx-ww-note">Set an API key above to fetch a catalog and test models.</p> : null}
              {selected.models.length === 0 && !addingModel ? <p className="dvx-ww-note">No models configured for this connection yet.</p> : null}
              {addingModel ? (
                <div className="dvx-ww-model-add">
                  <span className="dvx-ww-group-label">New model</span>
                  <ModelEditorForm draft={modelDraft} addMode onChange={(patch) => setModelDraft((c) => ({ ...c, ...patch }))} onCancel={() => setAddingModel(false)} onSave={addModel} />
                </div>
              ) : null}
              {selected.models.length > 0 ? (
                <div className="dvx-ww-model-table">
                  <div className="dvx-ww-model-headrow" aria-hidden="true">
                    <span>Model</span><span>Display name</span><span>Last test</span><span className="dvx-ww-model-head-actions">Actions</span>
                  </div>
                  {selected.models.map((model) => {
                    const tone = statusText(testingIds.has(model.id) ? { status: 'running' } : model.test).tone;
                    const editing = editingModelId === model.id;
                    const overflowOpen = openOverflowId === model.id;
                    return (
                      <div className="dvx-ww-model-row" data-test-tone={tone} key={model.id}>
                        {editing ? (
                          <ModelEditorForm draft={editDraft} addMode={false} onChange={(patch) => setEditDraft((c) => ({ ...c, ...patch }))} onCancel={() => setEditingModelId(null)} onSave={saveEditModel} />
                        ) : (
                          <>
                            <span className="dvx-ww-model-id" title={model.id}>{model.id}</span>
                            <span className="dvx-ww-model-name" title={model.displayName}>{model.displayName}</span>
                            <span className="dvx-ww-model-test">{statusLabel(model)}</span>
                            <span className="dvx-ww-model-actions">
                              <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-sm" onClick={() => testModel(model.id)}>{testingIds.has(model.id) ? 'Testing…' : 'Test'}</button>
                              <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-sm" onClick={() => startEditModel(model)}>Edit</button>
                              <span className="dvx-ww-overflow-wrap">
                                <button type="button" className="dvx-ww-overflow" aria-label="More actions" aria-expanded={overflowOpen} onClick={(e) => { e.stopPropagation(); setOpenOverflowId((c) => (c === model.id ? null : model.id)); }}>⋯</button>
                                {overflowOpen ? (
                                  <>
                                    <span className="dvx-ww-overflow-gap" />
                                    <button type="button" className="dvx-ww-text-btn dvx-ww-text-btn-sm dvx-ww-text-btn-danger" onClick={(e) => { e.stopPropagation(); deleteModel(model.id); }}>Delete</button>
                                  </>
                                ) : null}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          </div>
        </section>
      </div>

      {catalogOpen ? (
        <div className="dvx-ww-sheet-scrim" onClick={() => setCatalogOpen(false)}>
          <div className="dvx-ww-sheet" role="dialog" aria-modal="true" aria-label="Provider model catalog" onClick={(e) => e.stopPropagation()}>
            <header className="dvx-ww-sheet-head">
              <div>
                <h3 className="dvx-ww-sheet-title">Provider catalog</h3>
                <span className="dvx-ww-sheet-sub">Select models to import into {selected.name}.</span>
              </div>
              <button type="button" className="dvx-ww-text-btn" onClick={() => setCatalogOpen(false)}>Close</button>
            </header>
            <label className="dvx-ww-search dvx-ww-sheet-search">
              <svg className="dvx-ww-search-icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.5 10.5 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input type="search" className="dvx-ww-input dvx-ww-search-input" placeholder="Search models" aria-label="Search models" value={catalogQuery} onChange={(e) => setCatalogQuery(e.currentTarget.value)} />
            </label>
            <ul className="dvx-ww-sheet-list">
              {filteredCatalog.map((entry) => {
                const checked = catalogSelected.has(entry.id);
                const alreadyImported = selected.models.some((m) => m.id === entry.id);
                return (
                  <li key={entry.id}>
                    <label className="dvx-ww-sheet-row" data-checked={checked ? 'true' : 'false'}>
                      <input type="checkbox" checked={checked} disabled={alreadyImported} onChange={() => toggleCatalogItem(entry.id)} />
                      <span className="dvx-ww-sheet-copy">
                        <span className="dvx-ww-sheet-name">{entry.displayName}</span>
                        <span className="dvx-ww-sheet-id">{entry.id}</span>
                      </span>
                      {alreadyImported ? <span className="dvx-ww-sheet-tag">Imported</span> : null}
                    </label>
                  </li>
                );
              })}
              {filteredCatalog.length === 0 ? <li className="dvx-ww-rail-empty">No catalog models match.</li> : null}
            </ul>
            <footer className="dvx-ww-sheet-foot">
              <button type="button" className="dvx-ww-text-btn" onClick={() => { setCatalogOpen(false); setAddingModel(true); }}>Add manually</button>
              <button type="button" className="dvx-ww-primary" disabled={catalogSelected.size === 0} onClick={importSelected}>Import selected ({catalogSelected.size})</button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
