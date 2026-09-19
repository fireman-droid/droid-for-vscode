import type {
  ConnectionDraft,
  ManagedModelDraft,
  ModelConnection,
  ModelsAction,
  ModelsSnapshot,
  ModelVerification,
} from '../../shared/protocol/modelManagerProtocol';
import type { DiscoveredCustomModel } from '../../shared/protocol/customModelsProtocol';
import { isCustomModelBaseUrl } from '../../shared/protocol/customModelsProtocol';
import { normalizeProviderRoot } from '../../shared/validation/providerEndpoint';
import type {
  ModelManagementGateway,
  SavedModel,
} from '../../runtime/models/modelManagement';
import { modelFailureMessage } from '../../runtime/models/modelManagement';
import {
  ModelDiscoveryError,
  type CustomModelDiscoveryGateway,
} from '../chat/models/modelDiscovery';
import type { ProviderRegistry } from '../chat/models/providerRegistry';
import {
  connectionKey,
  findLoadedModel,
  modelRevision,
  projectConnections,
  projectManagedModels,
} from './modelProjection';

export interface ModelApplyState {
  readonly activeModelId: string | null;
  readonly canApply: boolean;
  readonly message: string;
}
export interface ModelManagerDependencies {
  readonly gateway: ModelManagementGateway;
  readonly registry: ProviderRegistry;
  readonly discovery: CustomModelDiscoveryGateway;
  readonly promptKey: () => PromiseLike<string | undefined>;
  readonly readApplyState: () => ModelApplyState;
  readonly apply: (runtimeId: string, signal: AbortSignal) => Promise<void>;
}
export interface ModelActionResult {
  readonly message: string;
  readonly connectionId?: string;
  readonly discovered?: readonly DiscoveredCustomModel[];
}
export class ModelManagerError extends Error {}

/** Global configuration ownership, independent of the chat panel's lifetime. */
export class ModelManager {
  private busy = false;
  private readonly tests = new Map<string, ModelVerification>();
  constructor(private readonly deps: ModelManagerDependencies) {}

  async snapshot(): Promise<ModelsSnapshot> {
    const [rows, loaded] = await Promise.all([
      this.deps.gateway.list(),
      this.deps.gateway.loaded(),
    ]);
    const connections = await projectConnections(this.deps.registry, rows);
    const live = new Set(rows.map(modelRevision));
    for (const key of this.tests.keys()) if (!live.has(key)) this.tests.delete(key);
    const apply = this.deps.readApplyState();
    return {
      connections,
      models: projectManagedModels(rows, connections, loaded, this.tests),
      activeModelId: apply.activeModelId,
      canApply: apply.canApply,
      applyMessage: apply.message,
    };
  }

  async execute(action: ModelsAction, signal: AbortSignal): Promise<ModelActionResult> {
    if (this.busy)
      throw new ModelManagerError('Another model operation is still running.');
    this.busy = true;
    try {
      signal.throwIfAborted();
      if (action.kind === 'refresh' || action.kind === 'cancel')
        return { message: 'Model catalog refreshed.' };
      const rows = await this.deps.gateway.list();
      signal.throwIfAborted();
      const connections = await projectConnections(this.deps.registry, rows);
      if (action.kind === 'renameProvider') {
        if (!connections.some((connection) => new URL(connection.baseUrl).host === action.providerHost)) {
          throw new ModelManagerError('服务商配置已变化，请刷新后重试。');
        }
        await this.deps.registry.renameProvider(action.providerHost, action.name.trim());
        return { message: '服务商别名已保存，接口地址、密钥和模型配置保持不变。' };
      }
      if (action.kind === 'saveConnection')
        return await this.saveConnection(action.draft, connections, rows, signal);
      if (action.kind === 'saveModel') {
        await this.saveModel(action.draft, connections, rows, signal);
        return {
          message: 'Model saved. Droid loading and verification are shown separately.',
        };
      }
      if (action.kind === 'discover') {
        const connection = this.connection(connections, action.connectionId);
        const key = await this.connectionKey(connection, true, signal);
        const discovered = await this.deps.discovery.discover(
          {
            provider: connection.protocol,
            baseUrl: connection.baseUrl,
            ...(key === undefined ? {} : { apiKey: key }),
          },
          signal,
        );
        return {
          message: `${discovered.length} models returned by the provider.`,
          discovered,
        };
      }
      if (action.kind === 'deleteConnection') {
        const connection = this.connection(connections, action.connectionId);
        if (this.connectionRows(connection, rows).length > 0) {
          throw new ModelManagerError(
            'Remove this connection’s models first. Existing model configurations were not deleted.',
          );
        }
        if (!connection.imported) await this.deps.registry.delete(connection.id);
        return { message: 'Empty connection removed.' };
      }
      if (action.kind === 'importModels') {
        let currentRows = rows;
        let added = 0;
        const connection = this.connection(connections, action.connectionId);
        const key = await this.connectionKey(connection, true, signal);
        for (const model of action.models) {
          signal.throwIfAborted();
          const connection = this.connection(connections, action.connectionId);
          if (
            this.connectionRows(connection, currentRows).some(
              (row) => row.model === model.model,
            )
          )
            continue;
          try {
            await this.saveModel(
              {
                connectionId: action.connectionId,
                model: model.model,
                displayName: model.displayName ?? '',
                maxOutputTokens: null,
                noImageSupport: false,
              },
              connections,
              currentRows,
              signal,
              key,
            );
          } catch (error) {
            throw new ModelManagerError(
              `${added} models saved before import stopped. ${modelManagerFailure(error)}`,
            );
          }
          added++;
          currentRows = await this.deps.gateway.list();
        }
        return { message: `${added} models added. Existing Model IDs were skipped.` };
      }
      const row = rows.find(
        (item) =>
          item.rawIndex === action.rawIndex && item.model === action.expectedModel,
      );
      if (row === undefined)
        throw new ModelManagerError('This model changed elsewhere. Refresh and retry.');
      if (action.kind === 'renameModel') {
        const displayName = action.name.trim();
        this.requireUniqueName(displayName, row.rawIndex, rows);
        await this.deps.gateway.save({
          rawIndex: row.rawIndex, expectedModel: row.model, model: row.model,
          provider: row.provider, displayName,
          ...(row.baseUrl === undefined ? {} : { baseUrl: row.baseUrl }),
          ...(row.maxOutputTokens === undefined ? {} : { maxOutputTokens: row.maxOutputTokens }),
          ...(row.noImageSupport === undefined ? {} : { noImageSupport: row.noImageSupport }),
        });
        this.tests.delete(modelRevision(row));
        return { message: '模型别名已保存。Model ID、接口和已保存密钥保持不变。' };
      }
      if (action.kind === 'deleteModel') {
        await this.deps.gateway.delete(row.rawIndex, row.model);
        return { message: 'Model removed from Droid configuration.' };
      }
      const loaded = findLoadedModel(row, await this.deps.gateway.loaded(), rows);
      if (loaded.runtimeId === null) throw new ModelManagerError(loaded.loadMessage);
      if (action.kind === 'verifyModel') {
        const test = await this.deps.gateway.verify(loaded.runtimeId, signal);
        this.tests.set(modelRevision(row), test);
        if (test.status === 'failed') throw new ModelManagerError(test.message);
        return { message: test.message };
      }
      const state = this.deps.readApplyState();
      if (!state.canApply) throw new ModelManagerError(state.message);
      await this.deps.apply(loaded.runtimeId, signal);
      return { message: 'Droid confirmed this model in the current chat.' };
    } finally {
      this.busy = false;
    }
  }

  private connection(
    connections: readonly ModelConnection[],
    id: string,
  ): ModelConnection {
    const connection = connections.find((item) => item.id === id);
    if (connection === undefined)
      throw new ModelManagerError('This connection changed. Refresh and retry.');
    return connection;
  }
  private connectionRows(
    connection: ModelConnection,
    rows: readonly SavedModel[],
  ): readonly SavedModel[] {
    return rows.filter(
      (row) =>
        typeof row.baseUrl === 'string' &&
        isCustomModelBaseUrl(row.baseUrl) &&
        connectionKey(row.provider, row.baseUrl) ===
          connectionKey(connection.protocol, connection.baseUrl),
    );
  }
  private async connectionKey(
    connection: ModelConnection,
    required: boolean,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const key = await this.deps.registry.apiKeyForEndpoint(connection.protocol, connection.baseUrl);
    if (key !== undefined || !required || !connection.hasKey) return key;
    const typed = await this.deps.promptKey();
    signal.throwIfAborted();
    if (typed === undefined || typed.trim() === '')
      throw new ModelManagerError('API key entry cancelled. No model was changed.');
    const value = typed.trim();
    await this.deps.registry.rememberApiKey(connection.protocol, connection.baseUrl, value);
    signal.throwIfAborted();
    return value;
  }

  private async saveConnection(
    draft: ConnectionDraft,
    connections: readonly ModelConnection[],
    rows: readonly SavedModel[],
    signal: AbortSignal,
  ): Promise<ModelActionResult> {
    const old =
      draft.id === undefined ? undefined : this.connection(connections, draft.id);
    const key = draft.setApiKey ? await this.deps.promptKey() : undefined;
    signal.throwIfAborted();
    if (draft.setApiKey && (key === undefined || key.trim() === '')) {
      throw new ModelManagerError('API key entry cancelled. Connection was not saved.');
    }
    const saved = await this.deps.registry.save({
      ...(old === undefined || old.imported ? {} : { id: old.id }),
      displayName: draft.name,
      protocol: draft.protocol,
      rootUrl: draft.baseUrl,
      ...(key === undefined ? {} : { apiKey: key.trim() }),
    });
    if (old !== undefined && (old.protocol !== draft.protocol ||
      normalizeProviderRoot(old.baseUrl) !== normalizeProviderRoot(draft.baseUrl) || key !== undefined)) {
      let updated = 0;
      for (const row of this.connectionRows(old, rows)) {
        try {
          signal.throwIfAborted();
          await this.deps.gateway.save({
            rawIndex: row.rawIndex,
            expectedModel: row.model,
            model: row.model,
            provider: draft.protocol,
            baseUrl: normalizeProviderRoot(draft.baseUrl),
            ...(row.displayName === undefined ? {} : { displayName: row.displayName }),
            ...(row.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: row.maxOutputTokens }),
            ...(row.noImageSupport === undefined
              ? {}
              : { noImageSupport: row.noImageSupport }),
            ...(key === undefined ? {} : { apiKey: key.trim() }),
          });
          this.tests.delete(modelRevision(row));
          updated++;
        } catch (error) {
          throw new ModelManagerError(
            `Connection saved; ${updated} model configurations updated before an error. Review the refreshed list. ${modelManagerFailure(error)}`,
          );
        }
      }
    }
    return { message: 'Connection saved.', connectionId: saved.id };
  }

  private async saveModel(
    draft: ManagedModelDraft,
    connections: readonly ModelConnection[],
    rows: readonly SavedModel[],
    signal: AbortSignal,
    apiKeyOverride?: string,
  ): Promise<void> {
    const connection = this.connection(connections, draft.connectionId);
    const previous =
      draft.rawIndex === undefined
        ? undefined
        : rows.find(
            (row) => row.rawIndex === draft.rawIndex && row.model === draft.expectedModel,
          );
    if (draft.rawIndex !== undefined && previous === undefined) {
      throw new ModelManagerError('This model changed elsewhere. Refresh and retry.');
    }
    const displayName = draft.displayName.trim() || draft.model.slice(0, 160);
    this.requireUniqueName(displayName, draft.rawIndex, rows);
    if (
      this.connectionRows(connection, rows).some(
        (row) => row.rawIndex !== draft.rawIndex && row.model === draft.model,
      )
    ) {
      throw new ModelManagerError(
        'This Model ID already exists on the connection. Edit its existing row.',
      );
    }
    const key =
      apiKeyOverride ??
      (await this.connectionKey(connection, previous === undefined, signal));
    signal.throwIfAborted();
    await this.deps.gateway.save({
      ...(previous === undefined
        ? {}
        : { rawIndex: previous.rawIndex, expectedModel: previous.model }),
      model: draft.model,
      displayName,
      provider: connection.protocol,
      baseUrl: normalizeProviderRoot(connection.baseUrl),
      ...(key === undefined ? {} : { apiKey: key }),
      maxOutputTokens: draft.maxOutputTokens,
      noImageSupport: draft.noImageSupport,
    });
    if (previous !== undefined) this.tests.delete(modelRevision(previous));
  }

  private requireUniqueName(name: string, rawIndex: number | undefined, rows: readonly SavedModel[]): void {
    if (!name || rows.some((row) => row.rawIndex !== rawIndex && (row.displayName ?? row.model) === name)) {
      throw new ModelManagerError('请使用不重复的模型别名，Droid 需要通过名称识别模型。');
    }
  }
}

export function modelManagerFailure(error: unknown): string {
  if (error instanceof ModelManagerError) return error.message.slice(0, 2048);
  if (error instanceof ModelDiscoveryError) {
    if (error.status === 404)
      return 'This endpoint has no model-list API. Check the Base URL or add a Model ID manually.';
    if (error.status !== undefined)
      return modelFailureMessage(new Error(String(error.status)));
    return error.kind === 'timed-out'
      ? 'The model-list request timed out.'
      : 'The provider did not return a supported model list. You can still add a Model ID manually.';
  }
  if (error instanceof Error && error.message === 'duplicate-provider-connection') {
    return 'A connection already uses this protocol and Base URL. Edit that connection instead.';
  }
  return modelFailureMessage(error);
}
