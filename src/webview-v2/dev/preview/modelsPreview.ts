import type { DiscoveredCustomModel } from '../../../shared/protocol/customModelsProtocol';
import {
  MODEL_MANAGER_VERSION,
  type ManagedModel,
  type ModelsAction,
  type ModelsHostMessage,
  type ModelsSnapshot,
} from '../../../shared/protocol/modelManagerProtocol';
import { createModelsPreviewSnapshot } from '../modelsPreviewTransport';

const SIMULATED_DISCOVERED: Readonly<Record<string, readonly DiscoveredCustomModel[]>> = {
  gateway: [
    { model: 'auto/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite' },
    { model: 'auto/gpt-6-luna', displayName: 'GPT-6 Luna' },
    { model: 'auto/gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
    { model: 'gateway-reasoner', displayName: 'Reasoner · Personal gateway' },
    { model: 'gateway-fast', displayName: 'Fast · Personal gateway' },
    { model: 'gateway-coder-32b' },
    { model: 'gateway-vision-large-context', displayName: 'Vision Large Context' },
    { model: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { model: 'deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash' },
    { model: 'qwen3-coder-plus', displayName: 'Qwen3 Coder Plus' },
    { model: 'o4-mini', displayName: 'O4 Mini' },
  ],
  imported: [
    { model: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { model: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { model: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  ],
};

const DEFAULT_DISCOVERED: readonly DiscoveredCustomModel[] = [
  { model: 'preview-model-pro', displayName: 'Preview Model Pro' },
  { model: 'preview-model-fast', displayName: 'Preview Model Fast' },
  { model: 'preview-model-mini' },
];

export function createPreviewModelsHandler(callbacks: {
  readonly previewNotice: string;
  readonly block: () => void;
  readonly notice: (message: string) => void;
  readonly emit: (message: ModelsHostMessage) => void;
}) {
  let snapshot: ModelsSnapshot = createModelsPreviewSnapshot();
  const publish = () => callbacks.emit({ type: 'models.snapshot', version: MODEL_MANAGER_VERSION, snapshot });
  const result = (
    requestId: string,
    ok: boolean,
    message: string,
    extra: Partial<Extract<ModelsHostMessage, { type: 'models.result' }>> = {},
  ) => callbacks.emit({ type: 'models.result', version: MODEL_MANAGER_VERSION, requestId, ok, message, ...extra });

  const handle = (requestId: string, action: ModelsAction): void => {
    if (action.kind === 'cancel') return;
    if (action.kind === 'refresh') {
      publish();
      result(requestId, true, 'Fixed example models. No provider was contacted.');
      return;
    }
    if (action.kind === 'verifyModel') {
      callbacks.block();
      result(requestId, false, callbacks.previewNotice);
      return;
    }
    if (action.kind === 'discover') {
      const discovered = SIMULATED_DISCOVERED[action.connectionId] ?? DEFAULT_DISCOVERED;
      callbacks.notice('Simulated model list returned locally for this preview. No backend is connected.');
      result(requestId, true, `${discovered.length} simulated models returned (offline preview).`, { discovered });
      return;
    }
    if (action.kind === 'saveConnection') {
      const draft = action.draft;
      const id = draft.id ?? `connection-${snapshot.connections.length}`;
      const previous = snapshot.connections.find(item => item.id === id);
      const nextConnection = {
        id,
        name: draft.name,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl,
        hasKey: draft.setApiKey || previous?.hasKey === true,
        imported: false,
      };
      snapshot = {
        ...snapshot,
        connections: previous
          ? snapshot.connections.map(item => (item.id === id ? nextConnection : item))
          : [...snapshot.connections, nextConnection],
      };
      publish();
      callbacks.notice('Connection updated locally in this preview tab only. No backend is connected.');
      result(requestId, true, 'Connection saved in offline preview.', { connectionId: id });
      return;
    }
    if (action.kind === 'deleteConnection') {
      snapshot = {
        ...snapshot,
        connections: snapshot.connections.filter(item => item.id !== action.connectionId),
      };
      publish();
      callbacks.notice('Connection removed in this preview tab only. No backend is connected.');
      result(requestId, true, 'Connection removed in offline preview.');
      return;
    }
    if (action.kind === 'renameProvider') {
      snapshot = {
        ...snapshot,
        connections: snapshot.connections.map(item =>
          new URL(item.baseUrl).host === action.providerHost ? { ...item, providerName: action.name } : item),
      };
      publish();
      result(requestId, true, 'Provider alias updated in offline preview.');
      return;
    }
    if (action.kind === 'saveModel') {
      const draft = action.draft;
      const rawIndex = draft.rawIndex ?? Math.max(-1, ...snapshot.models.map(item => item.rawIndex)) + 1;
      const existing = snapshot.models.find(item => item.rawIndex === rawIndex);
      const connectionName = snapshot.connections.find(item => item.id === draft.connectionId)?.name ?? draft.connectionId;
      const nextModel: ManagedModel = {
        rawIndex,
        model: draft.model,
        displayName: draft.displayName || `${draft.model} · ${connectionName}`,
        connectionId: draft.connectionId,
        maxOutputTokens: draft.maxOutputTokens,
        noImageSupport: draft.noImageSupport,
        valid: true,
        enabled: existing?.enabled,
        runtimeId: `preview:${rawIndex}`,
        loadMessage: 'Simulated in offline preview',
        test: null,
      };
      snapshot = {
        ...snapshot,
        models: existing
          ? snapshot.models.map(item => (item.rawIndex === rawIndex ? nextModel : item))
          : [...snapshot.models, nextModel],
      };
      publish();
      callbacks.notice('Model updated locally in this preview tab only. No backend is connected.');
      result(requestId, true, 'Model saved in offline preview.');
      return;
    }
    if (action.kind === 'importModels') {
      const rows = [...snapshot.models];
      for (const item of action.models) {
        if (rows.some(row => row.connectionId === action.connectionId && row.model === item.model)) continue;
        const rawIndex = Math.max(-1, ...rows.map(row => row.rawIndex)) + 1;
        rows.push({
          rawIndex,
          model: item.model,
          displayName: item.displayName ?? item.model,
          connectionId: action.connectionId,
          maxOutputTokens: null,
          noImageSupport: false,
          valid: true,
          runtimeId: `preview:${rawIndex}`,
          loadMessage: 'Simulated in offline preview',
          test: null,
        });
      }
      snapshot = { ...snapshot, models: rows };
      publish();
      callbacks.notice('Models imported locally in this preview tab only. No backend is connected.');
      result(requestId, true, `Added ${action.models.length} simulated models (offline preview).`);
      return;
    }
    if (action.kind === 'setModelEnabled') {
      snapshot = {
        ...snapshot,
        models: snapshot.models.map(item =>
          item.rawIndex === action.rawIndex ? { ...item, enabled: action.enabled } : item),
      };
      publish();
      result(requestId, true, 'Model availability updated in offline preview.');
      return;
    }
    if (action.kind === 'deleteModel') {
      snapshot = {
        ...snapshot,
        models: snapshot.models.filter(item => item.rawIndex !== action.rawIndex),
      };
      publish();
      result(requestId, true, 'Model deleted in offline preview.');
      return;
    }
    if (action.kind === 'renameModel') {
      snapshot = {
        ...snapshot,
        models: snapshot.models.map(item =>
          item.rawIndex === action.rawIndex ? { ...item, displayName: action.name } : item),
      };
      publish();
      result(requestId, true, 'Model renamed in offline preview.');
      return;
    }
    if (action.kind === 'useModel') {
      const target = snapshot.models.find(item => item.rawIndex === action.rawIndex);
      if (target?.runtimeId) {
        snapshot = { ...snapshot, activeModelId: target.runtimeId };
        publish();
        result(requestId, true, 'Active model updated in offline preview.');
      } else {
        result(requestId, false, 'This simulated model cannot be selected.');
      }
    }
  };

  return {
    handle,
    reset: () => { snapshot = createModelsPreviewSnapshot(); },
  };
}
