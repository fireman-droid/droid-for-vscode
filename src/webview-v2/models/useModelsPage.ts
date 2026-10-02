import { useMemo, useState } from 'react';
import type { DiscoveredCustomModel } from '../../shared/protocol/customModelsProtocol';
import type { ConnectionDraft, ManagedModel, ManagedModelDraft, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import { useModels, type ModelsTransport } from './useModels';
import { groupModelProviders, type ModelProviderGroup } from './providerGroups';

type SelectedEndpoint = Pick<ModelConnection, 'protocol' | 'baseUrl'>;

export function useModelsPage(transport: ModelsTransport) {
  const manager = useModels(transport);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<SelectedEndpoint | null>(null);
  const [preferredInterfaces, setPreferredInterfaces] = useState<ReadonlyMap<string, SelectedEndpoint>>(new Map());
  const [connectionForm, setConnectionForm] = useState<{ connection: ModelConnection | null } | null>(null);
  const [modelForm, setModelForm] = useState<{ model: ManagedModel | null } | null>(null);
  const [search, setSearch] = useState('');
  const [discovery, setDiscovery] = useState<{ connectionId: string; items: readonly DiscoveredCustomModel[] } | null>(null);
  const [selection, setChosen] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => groupModelProviders(manager.snapshot), [manager.snapshot]);
  const active = manager.snapshot?.models.find((model) => model.runtimeId !== null && model.runtimeId === manager.snapshot?.activeModelId);
  const connection = manager.snapshot?.connections.find((item) =>
    selectedEndpoint !== null ? item.protocol === selectedEndpoint.protocol && item.baseUrl === selectedEndpoint.baseUrl : item.id === selectedId) ??
    manager.snapshot?.connections.find((item) => item.id === selectedId) ??
    manager.snapshot?.connections.find((item) => item.id === active?.connectionId) ??
    manager.snapshot?.connections[0] ?? null;
  const group = groups.find((item) => item.connections.some((source) => source.id === connection?.id)) ?? null;
  const selectConnection = (id: string) => {
    const source = manager.readSnapshot()?.connections.find((item) => item.id === id);
    setSelectedId(id);
    setSelectedEndpoint(source ? { protocol: source.protocol, baseUrl: source.baseUrl } : null);
    if (source) setPreferredInterfaces((current) => new Map(current).set(new URL(source.baseUrl).host, {
      protocol: source.protocol, baseUrl: source.baseUrl,
    }));
    if (source?.id === connection?.id) return;
    setSearch('');
    setDiscovery(null);
    setChosen(new Set());
  };
  const selectProvider = (provider: ModelProviderGroup) => {
    const remembered = preferredInterfaces.get(provider.host);
    const source = provider.connections.find((item) => item.protocol === remembered?.protocol && item.baseUrl === remembered.baseUrl) ??
      provider.connections.find((item) => item.id === active?.connectionId) ?? provider.connections[0];
    if (source) selectConnection(source.id);
  };
  const models = manager.snapshot?.models.filter((item) => item.connectionId === connection?.id) ?? [];
  const savedIds = new Set(models.map((item) => item.model));
  const chosen: ReadonlySet<string> = new Set([...selection].filter((id) => !savedIds.has(id)));
  const visible = models.filter((item) => `${item.model} ${item.displayName}`.toLowerCase().includes(search.toLowerCase()));
  const discovered = discovery !== null && discovery.connectionId === connection?.id ? discovery.items : null;

  const saveConnection = async (draft: ConnectionDraft): Promise<boolean> => {
    const result = await manager.run({ kind: 'saveConnection', draft });
    if (!result.ok) return false;
    setConnectionForm(null);
    if (result.connectionId !== undefined) selectConnection(result.connectionId);
    setDiscovery(null);
    return true;
  };
  const saveModel = async (draft: ManagedModelDraft, verify: boolean): Promise<boolean> => {
    const result = await manager.run({ kind: 'saveModel', draft });
    if (!result.ok) return false;
    setModelForm(null);
    if (!verify) return true;
    const saved = manager.readSnapshot()?.models.find(
      (item) => item.connectionId === draft.connectionId && item.model === draft.model,
    );
    if (saved === undefined) {
      manager.setNotice({
        ok: false,
        message: 'Saved, but the refreshed model row is unavailable. Refresh before verifying.',
      });
      return true;
    }
    if (saved.enabled === false) {
      manager.setNotice({ ok: true, message: '配置已保存。此模型已禁用，恢复后才能验证。' });
      return true;
    }
    await manager.run({ kind: 'verifyModel', rawIndex: saved.rawIndex, expectedModel: saved.model });
    return true;
  };
  const discoverModels = async (connectionId: string): Promise<void> => {
    const result = await manager.run({ kind: 'discover', connectionId });
    if (!result.ok || result.discovered === undefined) return;
    manager.setNotice(null);
    const availableIds = new Set(result.discovered.map((item) => item.model));
    const savedIds = new Set(manager.readSnapshot()?.models
      .filter((item) => item.connectionId === connectionId).map((item) => item.model));
    setChosen((current) => new Set([...current].filter((id) => availableIds.has(id) && !savedIds.has(id))));
    setDiscovery({ connectionId, items: result.discovered });
  };
  const importModels = async (connectionId: string, items: readonly DiscoveredCustomModel[]): Promise<boolean> => {
    const savedIds = new Set(manager.readSnapshot()?.models
      .filter((item) => item.connectionId === connectionId).map((item) => item.model));
    const selectedModels = items.filter((item) => chosen.has(item.model) && !savedIds.has(item.model));
    if (selectedModels.length === 0) return false;
    const result = await manager.run({
      kind: 'importModels', connectionId, models: selectedModels,
    });
    if (result.ok) {
      setDiscovery(null);
      setChosen(new Set());
    }
    return result.ok;
  };
  return {
    manager, connection, group, groups, models, visible, discovered, chosen, search, connectionForm, modelForm,
    busy: manager.pending !== null,
    editing: connectionForm !== null || modelForm !== null,
    setSelectedId: selectConnection, selectProvider, setSearch, setDiscovery, setChosen, setConnectionForm, setModelForm,
    saveConnection, saveModel, discoverModels, importModels,
  };
}

export function operationLabel(kind: string | null): string {
  switch (kind) {
    case 'verifyModel': return 'Waiting for a real Droid verification reply…';
    case 'discover': return 'Requesting the provider’s model list…';
    case 'importModels': return 'Saving selected models…';
    case 'useModel': return 'Refreshing the idle chat and confirming its model…';
    case 'setModelEnabled': return 'Updating model availability…';
    default: return 'Waiting for Droid to confirm the change…';
  }
}
